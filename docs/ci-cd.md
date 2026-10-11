# Main releases to staging and TestFlight

`.github/workflows/recollect-release.yml` runs on pushes to `main`. It runs the
existing checks, deploys the API and AI worker, waits for the exact deployment IDs
to become healthy, checks `/health`, then starts the Expo release workflow.
Release runs are serialized so a new push does not interrupt a database migration.

`apps/mobile/.eas/workflows/testflight-release.yml` compares the iOS native
fingerprint against a successful store build on channel `testflight`. Compatible
changes publish an OTA update; a new native runtime triggers a store build and
TestFlight submission. The first release needs a store build. The existing ad hoc
`preview` installation cannot serve as the TestFlight baseline.

OTA updates cover compatible JavaScript and assets. Native modules, SDK upgrades,
entitlements, widget code and native permissions need new binaries. With the
default Expo Updates behavior, updates download on launch and apply on a later
launch; OTA does not create a new TestFlight build number. Native builds must finish
Apple's processing. Keep API changes compatible with older installed runtimes.

## Railway setup

Create an isolated staging environment with fresh PostgreSQL, an API service and
a separate AI worker. Use the repository root as both services' build context and
the root `Dockerfile`. Configure the following in Railway service settings:

| Setting | API | Worker |
| --- | --- | --- |
| Start command | `npm run start --workspace @recollect/api` | `npm run start --workspace @recollect/worker` |
| Pre-deploy commands, in order | `npm run db:migrate`, then `npm run db:queue:setup` | None |
| Healthcheck | `/health`, timeout 300 seconds | None; no HTTP server |
| Restart policy | On failure | On failure |
| Public domain | Stable HTTPS origin | None |
| Independent GitHub autodeploy | Disabled | Disabled |

Railway's per-service `railway.toml` configuration is deprecated and unavailable
to new services. Use service settings or its current Infrastructure as Code
interface for this new environment. The old checked-in configuration remains a
reference for legacy deployments.

Both services use a private Railway `DATABASE_URL` reference to the new PostgreSQL
service and `NODE_ENV=production`. The API needs `HOST=0.0.0.0`,
`APPLE_BUNDLE_ID=collect.software.cognition-curator`, `ENABLE_DEV_AUTH=false` and a
new `ACCESS_TOKEN_SECRET` of at least 32 characters. After reviewing the fresh
staging database, set `CONFIRM_DATABASE_MIGRATION=yes` and `CONFIRM_QUEUE_SETUP=yes`
on the API for the pre-deploy steps. Ordinary startup never migrates the database.
The worker needs `ANTHROPIC_API_KEY` and an explicitly selected available
`ANTHROPIC_MODEL`; without these it cannot start, and the app release stops.

Do not change the legacy Python service, import legacy data or reuse its database
as part of this setup. API and worker upload the same checked-out source. An old
healthy deployment cannot satisfy the gate: the pipeline polls the IDs returned
by the two uploads.

## GitHub and Expo setup

Create a GitHub environment named `staging` with these secrets:

| Secret | Purpose |
| --- | --- |
| `RAILWAY_TOKEN` | Project token scoped to the new staging environment |
| `EXPO_TOKEN` | CI token for the personal `collectsoftware` Expo account |

Set the following variables in that same environment:

| Variable | Value |
| --- | --- |
| `RAILWAY_PROJECT_ID` | Staging project's ID |
| `RAILWAY_ENVIRONMENT_ID` | Target environment's ID |
| `RAILWAY_API_SERVICE_ID` | API service's ID |
| `RAILWAY_WORKER_SERVICE_ID` | Separate worker service's ID |
| `STAGING_API_URL` | Stable API HTTPS origin, without an `/api` suffix |
| `ASC_APP_ID` | Numeric Apple ID of this app in App Store Connect |

Missing targets, duplicate API/worker IDs and temporary tunnel addresses fail
before deployment. CI adds the numeric Apple app ID to the uploaded submission
profile and sets the public API URL and `EXPO_PUBLIC_ENABLE_DEV_AUTH=false` in
Expo's `preview` environment. Database and AI credentials stay in Railway.

The app uses `@collectsoftware/recollect-ai`, project ID
`2d6f42f7-8c17-4f27-9c69-7ce868abdb74`. The `testflight` profile uses store
distribution, automatic build-number increments, the `testflight` channel, the
`preview` environment, SDK 57 and Node 24.21.0. Production remains a separate
channel. GitHub uploads the checked-out source using `eas workflow:run`; an Expo
GitHub integration is optional. Do not add a second direct EAS push trigger,
which would bypass the API deployment gate.

## Apple setup and activation

Configure store credentials for both the app and widget extension:

```sh
cd apps/mobile
npm exec --yes --package=node@24 --package=eas-cli@24.12.1 -- eas credentials:configure-build --platform ios --profile testflight
```

Configure EAS's App Store Connect API key for unattended submissions and verify
`ASC_APP_ID`. Keep signing and Apple API credentials in EAS under personal Apple
team `KF8643NB33`. Complete Apple account agreements privately. Add yourself to an
internal TestFlight group with automatic distribution enabled. TestFlight does
not require iPhone UDID registration; App Store promotion is a separate step.

Once these connections are complete, merge the current TypeScript app and release
workflow into `main`. Configure required checks and branch protection. Feature
branches and PRs run checks; main runs deployment and app release.

If a native submission fails, retry the submission in EAS before the next OTA
release. A matching EAS binary alone does not prove TestFlight submission or
installation. Alternatively, manually dispatch the GitHub release workflow on
main with `force_native=true` to build and submit a fresh binary. Tests, migrations,
deployment failures and incorrect health responses prevent app release.

The commit SHA appears in Railway, EAS build and OTA messages. Use GitHub Actions,
Railway deployments and EAS workflow logs to diagnose failed releases. OTA rollback
does not undo SQLite/PostgreSQL migrations or restore records.

## Validation

```sh
node --test scripts/test-release-pipeline.mjs
npm run typecheck
cd apps/mobile
npm exec --yes --package=node@24 --package=eas-cli@24.12.1 -- eas workflow:validate .eas/workflows/testflight-release.yml --non-interactive
```

References: [Expo release workflows](https://docs.expo.dev/eas/workflows/examples/deploy-to-production/),
[EAS Updates](https://docs.expo.dev/eas-update/how-it-works/),
[Railway CLI deployments](https://docs.railway.com/cli/deploying), and
[Railway Infrastructure as Code](https://docs.railway.com/infrastructure-as-code).
