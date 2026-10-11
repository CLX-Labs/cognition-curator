# TypeScript API

Fastify serves the `/v1` protocol using the additive `recollect` PostgreSQL schema. API startup never runs application migrations. Python remains in the repository as a legacy reference; no requests are forwarded to it.

## Run locally

From the repository root, configure `.env` using `.env.example`, start a disposable PostgreSQL database, and run:

```bash
CONFIRM_DATABASE_MIGRATION=yes npm run db:migrate
npm run dev:api
```

The API listens on `127.0.0.1:3001` by default in development and on `0.0.0.0` in production. Set `HOST` for physical-phone development. `DATABASE_URL`, a dedicated `ACCESS_TOKEN_SECRET` of at least 32 characters, and `APPLE_BUNDLE_ID` are required. The signing secret must be different from the old Python signing material. The development sign-in route exists only with `ENABLE_DEV_AUTH=true`; production startup rejects this flag.

## Implemented endpoints

| Endpoint                                        | Behavior                                                                                                                                          |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/auth/apple/challenge`                 | Generates a one-time, five-minute nonce challenge.                                                                                                |
| `POST /v1/auth/apple`                           | Verifies Apple's signature/JWKS, issuer, audience, required expiration and nonce; consumes the challenge transactionally.                         |
| `POST /v1/auth/refresh`                         | Rotates an opaque hashed token. Reuse revokes the entire family, including concurrent descendants.                                                |
| `POST /v1/auth/logout`                          | Revokes the authenticated session family.                                                                                                         |
| `POST /v1/auth/development`                     | Explicit development-only `{email,name?}` sign-in. Never present in production.                                                                   |
| `GET /v1/me`                                    | Current user.                                                                                                                                     |
| `GET /v1/sync/snapshot`                         | Account-scoped consistent content, reviews and cursor; `/v1/snapshot` is an alias.                                                                |
| `POST /v1/sync/push`                            | Validated, idempotent deck/card create/edit/delete and review commands.                                                                           |
| `GET /v1/sync/pull`                             | Commit-ordered immutable changes through a fixed watermark; pages contain complete revision groups.                                               |
| `GET /v1/decks`                                 | Owned active decks.                                                                                                                               |
| `GET /v1/decks/:id/cards`                       | Owned active cards in an active owned deck.                                                                                                       |
| `POST /v1/decks/commands`, `/v1/cards/commands` | Direct command aliases using exactly the sync transaction/receipt implementation.                                                                 |
| `GET /v1/progress?timezone=...`                 | Current counts, due count and daily accepted-review totals. Imported checkpoint totals remain identified separately from available event history. |
| `POST /v1/generations`                          | Quota reservation and durable job intent; returns 202.                                                                                            |
| `GET /v1/generations/:id`                       | Resumable generation state/candidates.                                                                                                            |
| `DELETE /v1/generations/:id`                    | Cancels pending/running work, fencing out late results.                                                                                           |
| `POST /v1/generations/:id/accept`               | Idempotent acceptance using candidate IDs as permanent card IDs.                                                                                  |
| `POST /v1/imports`                              | Explicitly confirmed, recently authenticated device recovery; preserves original evidence and conflicts.                                          |

All protected reads/writes derive ownership from the verified session. A submitted owner ID never grants access. Composite foreign keys link cards/reviews/jobs to their owner's content. Access JWT validation checks the current session, family revocation and account-active state on every request.

### Authentication migration

The new issuer/audience and separate secret reject legacy JWTs outright. A newly verified Apple subject may reuse `public.users.id` through `public.users.apple_id`; email and private-relay addresses are never account-linking keys. Inactive legacy accounts are rejected. Session-family row locks serialize rotation, reuse detection and logout.

The mobile client sends `SHA-256(challenge.nonce)` to Apple's nonce field. The backend compares the verified token claim to the stored hash. A consumed or expired challenge cannot establish a new session.

### Sync invariants

Each operation locks its owner's sync-head row before examining receipts or domain state. Accepted effects and immutable change payloads commit in the same transaction as their receipt and revision. A PostgreSQL sequence allocated before commit is deliberately not used as the cursor.

Operation IDs and review event IDs are independently deduplicated with payload hashes. Reusing either identity with changed content is rejected. Device sequences are unique per owner and device. A lost acknowledgement can be replayed without counting another review. The client must compare canonical revisions before applying a replayed receipt; an acknowledgement may contain an older state.

Edits require the exact base version. Conflicts retain the remote canonical value and do not mutate it. Deleting a deck emits its tombstone and child-card tombstones in one revision; card review history remains intact. Moving a card between decks is explicitly rejected until a history policy exists.

Review state is recomputed from the retained checkpoint and accepted post-checkpoint events using the shared deterministic scheduler. Event ordering is reviewed time, device ID, device sequence, then event ID. Reviews more than five minutes in the future or before a retained checkpoint are rejected for recovery. The server does not invent timestamps for legacy records. There is currently no feed or receipt compaction, so existing cursors remain replayable; introduce a snapshot-expiry protocol before adding retention.

### Generation

The API writes a job row and quota reservation in one transaction. The job row is also a durable dispatch outbox. The worker may deliver a job more than once, but fences ensure only a current live attempt publishes candidates. Requests reserve their card count once against the UTC daily quota. Failed/canceled work retains that quota charge for the day to bound retries and abuse; this is a request allowance, not dollar billing. Provider attempts are capped at three. Provider timeouts can incur multiple vendor charges; exactly-once external execution is not claimed.

### Recovery

`importRequestSchema` is the shared wire contract. The signed-in owner must explicitly confirm the recovery material. A nonnull selected source account must match that owner, and the initial authentication must be less than 15 minutes old (a refresh alone does not satisfy this requirement). The import retains its manifest/hash, original raw records and unresolved conflicts. Imported schedule checkpoints are seeded once; archived legacy reviews are never executed as new commands.

Import preserves finite fractional interval seconds, the original due date and historical ease factors above 3. JSONB storage adds no integer conversion or ease ceiling. The first new accepted review applies the current scheduler's bounds; its replay still starts from the unchanged imported checkpoint. Values outside the shared compatibility contract require explicit recovery rather than silent repair.

Existing v1 deck/card identities are never overwritten. Conflicting records remain in the recovery manifest and response for explicit reconciliation. Ambiguous old device data must not be silently uploaded under the current account. The route has an 8 MiB request ceiling; large exports require bounded batches while retaining the original local backup. A conflict response is not evidence that all original data is reconciled.

## Verification

```bash
npm run typecheck
npm run test:embedded -- apps/api/test packages/ai/test
TEST_DATABASE_URL=postgresql://... npm test -- apps/api/test apps/worker/test
```

Integration suites **own and reset the disposable test schema**. Never point `TEST_DATABASE_URL` at development data that must survive or at production. Embedded tests exercise PostgreSQL SQL through PGlite; real PostgreSQL CI additionally exercises independent connections and the actual pg-boss lifecycle.

## Release gates

This is a working v1 backend, not authorization to switch the deployed app. Existing `/api/*` paths explicitly return `426 upgrade_required`: there are no compatibility adapters that allow old and new schedulers to write the same account. Before cutover, ship and prove the recovery-capable upgrade, freeze old writers, verify backups and the live schema, and rehearse migration/rollback preserving all newly accepted operations. Do not restore an old database snapshot over new reviews.

Apple device sign-in and signed upgrade migration still require actual device credentials/testing. Password-account recovery/import, Apple token revocation and complete account erasure, real subscription entitlements, and manual reconciliation of conflicting legacy identities are release requirements where those features are needed; no placeholders claim they already work. Public deployment should remain gated until those requirements and the real-device tests pass.
