# Recollect AI / Cognition Curator

The TypeScript rebuild of Recollect: an Expo app with offline SQLite storage, a Fastify API, a durable AI worker, and PostgreSQL. The app and server share one versioned scheduler and runtime-validated API contracts.

The original Swift app in `cognition.curator/` and Python server in `server/` remain available for recovery and comparison. The new runtime does not depend on Python. Creating this branch does not migrate a deployed database or replace the live application.

## Start locally

For Codex running on your Mac, follow [CODEX_HANDOFF.md](CODEX_HANDOFF.md) to build, launch, and validate the complete app with a disposable backend and dedicated simulator.

Install Node 24 and npm 11. PostgreSQL 16 is supplied by the optional Docker Compose service.

```sh
npm ci
npm run setup
docker compose up -d
CONFIRM_DATABASE_MIGRATION=yes npm run db:migrate
CONFIRM_QUEUE_SETUP=yes npm run db:queue:setup
npm run dev:api
```

`npm run setup` creates local environment files only if absent and generates a random API signing secret without printing it. The API listens at `http://127.0.0.1:3001`; `/health` checks its database connection. Existing environment files remain intact.

In separate terminals:

```sh
# Set ANTHROPIC_API_KEY and ANTHROPIC_MODEL in the root .env first.
npm run dev:worker

# Start Metro for an installed Expo development build.
npm run dev:mobile
```

For a physical phone, set `HOST=0.0.0.0` in the local API configuration and `EXPO_PUBLIC_API_URL=http://YOUR_COMPUTER_LAN_IP:3001` in `apps/mobile/.env`. Use loopback for a simulator. Cloud builds require an HTTPS API URL.

For isolated development, explicitly enable `ENABLE_DEV_AUTH=true` on the API and `EXPO_PUBLIC_ENABLE_DEV_AUTH=true` in the app. Production API startup rejects development authentication, and release JS excludes its button. Never enable it against a database containing real accounts. Apple sign-in uses the original application identity.

The worker requires an explicitly configured available Anthropic model. Missing credentials, provider failures, and invalid output produce visible failures; there are no manufactured fallback cards.

## Workspaces

| Directory             | Responsibility                                                                |
| --------------------- | ----------------------------------------------------------------------------- |
| `apps/mobile`         | Expo Router screens, SecureStore sessions, SQLite records/outbox, recovery UI |
| `apps/api`            | Fastify auth, sync/content commands, generation, imports and progress         |
| `apps/worker`         | pg-boss dispatch, bounded attempts, fencing and durable recovery              |
| `packages/contracts`  | Zod wire schemas and types; string ratings, UUIDs and ISO dates               |
| `packages/scheduler`  | Pure deterministic `sm2-v1` scheduler for server and device                   |
| `packages/db`         | PostgreSQL, Drizzle schema, tracked migrations and legacy import              |
| `packages/ai`         | Validated Anthropic Messages adapter and test-provider interface              |
| `apps/mobile/modules` | Archived SwiftData reader and retained widget integration                     |
| `apps/mobile/plugins` | Reproducible native target configuration for Expo CNG                         |

The API and worker use the `recollect` PostgreSQL schema. pg-boss owns `recollect_boss`. Normal new-stack reads and writes do not alter the legacy `public` tables.

## Application flows

- Apple sign-in with a single-use server nonce, verified identity tokens, rotating refresh sessions and family revocation.
- Home, decks, manual cards, silence/delete, spaced repetition review, practice, and progress from actual records.
- Separate Practice and Create tabs: generate 5–10 cards from a subject or deck title into a new or existing deck, review drafts, and save your selection. Manual card creation also offers a reviewed AI answer draft.
- Atomic offline edits and review events with a durable outbox, stable retry identities, and restart recovery.
- Canonical schedules, commit-ordered sync revisions, tombstones, account partitioning, and explicit conflicts with retained recovery copies.
- Durable AI jobs, editable candidate drafts, idempotent acceptance, bounded retries, and per-account quotas.
- Protected export of the supported old SwiftData schema, explicit ownership confirmation, archival history and schedule-checkpoint import.
- Original Home Screen and Control Center widget identities generated from committed source.

The old subscriptions simulated purchases. This branch does not expose a fake paid entitlement. Verified billing, notifications, production account deletion across legacy archives, Android Apple OAuth, and complete superset membership remain separate product work. Compatibility with older uninspected shipped native schemas remains a release investigation.

## Verify changes

```sh
npm run typecheck
npm test

# Includes database tests against a new ephemeral PostgreSQL WASM process.
# Ignores DATABASE_URL; no Docker or real account is needed.
npm run test:embedded

# Real PostgreSQL: use a disposable database whose name ends in _test.
TEST_DATABASE_URL=postgresql://recollect:recollect@127.0.0.1:5432/recollect_test npm test

npm run export:ios --workspace @recollect/mobile
cd apps/mobile
npx expo prebuild --platform ios --no-install
cd ../..
node scripts/check-native-config.mjs
```

Database tests reset the `recollect` schema in the designated test database. Never use a live database. PGlite runs PostgreSQL SQL locally with multiplexed connections; CI also uses a real PostgreSQL 16 service for transaction/concurrency coverage.

GitHub Actions runs TypeScript, database/SQLite tests, Expo bundle/prebuild checks, archived-model integrity, macOS SwiftData recovery tests and widget typechecking. Native fixture tests and project generation do not replace a signed build or an actual installed-app upgrade test.

## Build iOS without opening Xcode

For automatic staging API/worker deployments and TestFlight/OTA releases on pushes to
`main`, see [CI/CD setup](docs/ci-cd.md). The pipeline needs one-time Railway, GitHub
and Apple configuration before it can run.

The configuration preserves bundle `collect.software.cognition-curator`, team `KF8643NB33`, App Group `group.collect.software.cognition-curator`, widget extension `collect.software.cognition-curator.CognitionCuratorWidget`, scheme `cognitioncurator`, and minimum iOS 18.4.

Link the project to the correct Expo account once and configure signing through EAS. Set `EXPO_PUBLIC_EAS_PROJECT_ID` and `EXPO_PUBLIC_API_URL` in the matching EAS environment. Account access and App Store agreements still require their account owner.

```sh
cd apps/mobile
npx --yes eas-cli@24.12.1 project:init
npx --yes eas-cli@24.12.1 build --platform ios --profile simulator
npx --yes eas-cli@24.12.1 build --platform ios --profile development
npx --yes eas-cli@24.12.1 build --platform ios --profile preview
```

The manual **Recollect iOS cloud build** GitHub workflow uses an `ios-build` environment containing secret `EXPO_TOKEN` and variables `EXPO_PUBLIC_EAS_PROJECT_ID` and `EXPO_PUBLIC_API_URL`. Signing must be configured before its noninteractive run. Set matching EAS environment values so the remote build uses the intended public API address and project identity.

App Review submission is separate. Native modules, entitlements, widget source and dependencies require a new binary. JS updates must match the configured fingerprint runtime and EAS channel. Generated `apps/mobile/ios` and `android` directories stay out of git; change source modules and config plugins instead.

## Deploy and migrate deliberately

Use the root `Dockerfile` and `railway.toml` for a new staging API service. Configure a second service from the same image with `npm run start --workspace @recollect/worker`; it does not expose the API health endpoint. Run application migration and queue setup explicitly before starting services. Neither API nor worker startup automatically migrates application tables.

Existing Swift clients must not be redirected yet: legacy `/api/*` routes return `426 upgrade_required` to prevent conflicting schedule/counter writers. A recovery-capable upgrade and deliberate cutover are required.

The legacy server importer retains stable UUIDs and schedule checkpoints, and interprets old database intervals as **days**. Device recovery interprets Swift intervals as **minutes**. Finite fractional intervals, long intervals, high legacy ease values and existing due dates stay intact at import; the next rating adopts the new scheduler bounds. Earlier reviews are archived rather than applied again.

```sh
# Use a reviewed database copy first, after a tested backup and schema setup.
CONFIRM_LEGACY_READ_ONLY=yes npm run db:import:legacy
```

Changed source snapshots and identity collisions stop import rather than overwrite new work. Gate legacy writers during the final copy. Retain old local stores and manifests. Restoring an old database over newly accepted reviews is not a safe rollback.

Read [architecture and rollout](docs/architecture.md), [native recovery and widget continuity](docs/native-migration.md), the [dependency review](docs/dependency-review.md), and the backend-specific READMEs before cutover. Production inspection, signed-device upgrade evidence and resolution of the documented mobile dependency findings remain release requirements.
