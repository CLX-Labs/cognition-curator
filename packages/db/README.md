# PostgreSQL schema and migration

`src/schema.ts` declares the Drizzle model for schema authoring and typechecking; the `@recollect/db/schema` export is a development surface and requires development dependencies. Production API, worker and migrations use `pg` with tracked SQL and do not import Drizzle. Keeping Drizzle in development dependencies also excludes its unused optional Expo/SQLite peer graph from backend runtime images. `migrations/0001_recollect.sql` is the reviewed additive baseline and is the executable migration source. Do not use an implicit `drizzle push` against production. The migration runner records filenames and serializes migration application with a PostgreSQL advisory lock. Once a migration has been deployed, add a new migration; never edit the deployed file.

The schema retains stable UUIDs, explicit content/schedule checkpoints, immutable review events, operation and acceptance receipts, commit-ordered change groups, authentication session families, generation state/outbox, quotas and recovery manifests. Public Python tables remain untouched.

## Explicit commands

```bash
# Review the DATABASE_URL target and verify a recoverable backup first.
CONFIRM_DATABASE_MIGRATION=yes npm run db:migrate

# Only after old writers have been disabled and the schema/source data inspected:
CONFIRM_LEGACY_READ_ONLY=yes npm run db:import:legacy
```

The legacy importer performs SELECTs from `public.users`, `public.decks`, `public.flashcards` and optional legacy history tables. It copies internal UUIDs and preserves active/inactive state. It never links users by email and never exports/copies password hashes into recovery manifests. Unused old password credentials remain only in the legacy source until an explicit recovery/deletion plan handles them.

Known source intervals are converted from days to seconds without rounding, original due dates are retained, and a current checkpoint is captured. Checkpoints use JSONB numeric values: finite fractional intervals and historical ease factors above 3 are preserved. The shared import contract allows nonnegative intervals up to `Number.MAX_SAFE_INTEGER / 1000` seconds and ease factors of at least 1.3; it does not impose the new scheduler's ease ceiling on imported state. The next accepted review applies the current scheduler's ease bounds and bounded integer interval while retaining the original checkpoint for replay. The old algorithm's raw values and provenance remain in the import manifest; old history becomes archival evidence. A schema-invalid historical state stops the import for that owner rather than silently clamping or fabricating a repair.

An identical repeat is a no-op. Changed source data after a recorded migration or an occupied destination entity ID stops migration for explicit reconciliation. The operator must keep old writers gated throughout export/cutover. The importer runs one transaction per owner, so a failed owner can be investigated without overwriting already migrated accounts. It prints counts only, not private content or credentials.

## Ownership and cursors

Every content transaction must first call `lockOwner(tx, ownerId)`. `appendChanges` is valid only after that lock. All rows for one logical operation receive a single revision plus ordinal. Pull pagination limits complete revision groups, not individual rows. The immutable JSON payloads in the change feed are the state at that commit; callers must not substitute a fresh mutable table lookup.

This version retains change records and idempotency receipts indefinitely. Any future compaction must first define an acknowledged offline horizon, a snapshot bootstrap boundary and review/event identity retention. Keeping only the current card row is not sufficient for reliable retries.

## Rollback

Keep a prior compatible TypeScript build and leave new columns/tables in place. Never re-enable an old Python writer against the new review/schedule authority. If rollback crosses a protocol/schema boundary, use a tested adapter to retain/replay new operations or fix forward. A database backup is recovery material, not permission to discard writes accepted since that backup.
