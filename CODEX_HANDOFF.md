# Codex handoff: run and validate Recollect on your Mac

## Your task

You are Codex running locally on the user's MacBook. Get this branch running against a disposable local backend, compile the complete Expo iOS app, install it in a dedicated simulator, exercise the real app, and fix problems you reproduce. Work through the steps; do not stop after reading this document, proposing a plan, passing unit tests, or exporting JavaScript.

The user's priorities are TypeScript, Expo, minimal native maintenance, and AI handling the development work. Use command-line builds and generated native configuration. Opening the simulator is fine; routine work should not require opening the Xcode editor.

Continue independent work when a credential or native capability is unavailable. Ask only for the specific missing access, system permission, or action that actually blocks the next step. Honor the local Codex session's permissions. This task covers local validation and fixes, not a production deployment or App Store submission.

## Starting point and evidence

| Item                           | Value                                                                                                |
| ------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Repository                     | `https://github.com/CLX-Labs/cognition-curator.git`                                                  |
| Working branch                 | `feat/typescript-expo-rebuild`                                                                       |
| Verified implementation commit | `c453554184f98c027ccf0ee277fe8ed1d43e7c11`                                                           |
| Baseline CI                    | [Successful run 38174285299](https://github.com/CLX-Labs/cognition-curator/actions/runs/38174285299) |
| Runtime                        | Node 24, npm 11; root npm workspaces                                                                 |
| Mobile                         | Expo 57.0.27, React Native 0.86.3, React 19.2.3                                                      |

Use the current branch head, which also includes this handoff. Preserve later changes and inspect the diff from the implementation commit if the branch has advanced.

The baseline passed **83 JavaScript/TypeScript tests on PostgreSQL 16**, all workspace typechecks, **4 macOS Swift recovery tests**, widget typechecking, the iOS Hermes export, Expo dependency compatibility, prebuild, and native configuration checks. The embedded database route passed 82 tests and intentionally skipped the actual pg-boss delivery test. A fresh server-only dependency install passed its runtime imports and reported zero npm vulnerabilities.

Those checks ran in a remote workspace and GitHub Actions. **The full Expo app and its module wrappers have not yet been built or launched on this Mac, and no signed old-app upgrade has been proven.** Do not relabel the prior CI results as local observations.

Read `README.md`, `docs/architecture.md`, `docs/native-migration.md`, and `docs/dependency-review.md`. Read applicable local `AGENTS.md` instructions if present. The later Swift/Python sections of `CLAUDE.md` describe the archived implementation; the root TypeScript workspace is the active app.

## 1. Establish an isolated local workspace

Inspect the current directory, git status, branch, and available tools before changing anything. Use the existing clone if appropriate. If absent, clone the repository into the user's normal projects directory and check out the working branch. Preserve uncommitted work; use a separate worktree if the existing checkout is busy. Do not reset, clean, stash, or overwrite the user's work automatically.

Run available discovery commands and record their results:

```sh
sw_vers
uname -m
node --version
npm --version
xcode-select -p
xcodebuild -version
xcrun --find simctl
xcrun --sdk iphonesimulator --show-sdk-version
xcrun swift --version
command -v pod
docker context show
docker version
```

Use the user's existing Node version manager to select Node 24. With an existing nvm installation, use `nvm install 24` and `nvm use 24`. Keep the lockfile; do not upgrade the SDK or run a blanket dependency fix to make installation pass.

Full Xcode and an installed iOS runtime are needed for a local simulator build. If several Xcodes are installed, use a task-local `DEVELOPER_DIR` pointing to the discovered installation instead of changing the machine-wide selection. Report missing toolchain components precisely and continue the backend checks. Check the local Docker context before creating containers; this task must not use a remote production Docker daemon.

From the selected checkout:

```sh
export RECOLLECT_REPO_ROOT="$(git rev-parse --show-toplevel)"
export RECOLLECT_RUN_DIR="$(mktemp -d "${TMPDIR:-/tmp}/recollect-codex.XXXXXX")"
NODE_ENV=development npm ci --include=dev
npm run setup
npm run typecheck
ANTHROPIC_API_KEY='' ANTHROPIC_MODEL='' npm run test:embedded
```

Store logs/screenshots in `RECOLLECT_RUN_DIR`. Record that path. Preserve command exit codes when logging; use `set -o pipefail` before piping a build or test to `tee`.

`npm run setup` keeps existing `.env` files. **An existing file or inherited shell environment may point to a real service.** Do not print its contents or trust its target. The explicit local values below must be applied to each process. Codex tool calls may use separate shells: persist task settings privately or pass them explicitly rather than assuming exports carry over. The embedded test runner owns port 54329; resolve a conflict without killing an unrelated service.

## 2. Start a fresh PostgreSQL instance and the API

The checked-in Compose file binds port 5432, which may already be in use. For this exercise, use a new local container with a distinct name and a free port. The example uses 55432; change `RECOLLECT_PG_PORT` if occupied. Do not continue against an existing server after a port-binding failure.

```sh
export RECOLLECT_PG_CONTAINER="recollect-codex-$(date +%Y%m%d%H%M%S)"
export RECOLLECT_PG_PORT=55432
export RECOLLECT_API_PORT=3101
export RECOLLECT_METRO_PORT=8081

docker run -d --name "$RECOLLECT_PG_CONTAINER" \
  --label recollect.task=codex-validation \
  -p "127.0.0.1:${RECOLLECT_PG_PORT}:5432" \
  -e POSTGRES_USER=recollect -e POSTGRES_PASSWORD=recollect \
  -e POSTGRES_DB=recollect_codex_local postgres:16-alpine
```

Verify that this exact new container is running and PostgreSQL is ready. Retry readiness briefly if initialization is still in progress:

```sh
docker exec "$RECOLLECT_PG_CONTAINER" pg_isready -U recollect -d recollect_codex_local
docker exec "$RECOLLECT_PG_CONTAINER" createdb -U recollect recollect_codex_test
```

The sample password is only for this fresh, loopback-bound test instance. Establish these task settings, keeping the generated secret out of output and committed files:

```sh
export NODE_ENV=development
export DATABASE_URL="postgresql://recollect:recollect@127.0.0.1:${RECOLLECT_PG_PORT}/recollect_codex_local"
export RECOLLECT_TEST_DATABASE_URL="postgresql://recollect:recollect@127.0.0.1:${RECOLLECT_PG_PORT}/recollect_codex_test"
export ACCESS_TOKEN_SECRET="$(node -e "process.stdout.write(require('node:crypto').randomBytes(48).toString('base64url'))")"
export HOST=127.0.0.1
export PORT="$RECOLLECT_API_PORT"
export APPLE_BUNDLE_ID=collect.software.cognition-curator
export ENABLE_DEV_AUTH=true
export DAILY_GENERATION_CARDS=10
export ANTHROPIC_API_KEY=''
export ANTHROPIC_MODEL=''
export CONFIRM_DATABASE_MIGRATION=no
export CONFIRM_QUEUE_SETUP=no
export CONFIRM_LEGACY_READ_ONLY=no
unset TEST_DATABASE_URL RECOLLECT_EMBEDDED_TEST

CONFIRM_DATABASE_MIGRATION=yes npm run db:migrate
CONFIRM_QUEUE_SETUP=yes npm run db:queue:setup
npm run dev:api
```

Keep the API in a managed terminal/process and record its PID and log. Preserve the same signing secret across test restarts. If the chosen API port is occupied, choose a free one and update the mobile address too. Do not run `db:import:legacy` against the user's existing database for this smoke test.

In a separate terminal with the task variables available:

```sh
curl --fail --silent --show-error "http://127.0.0.1:${RECOLLECT_API_PORT}/health"

NODE_ENV=test \
  DATABASE_URL="$RECOLLECT_TEST_DATABASE_URL" \
  TEST_DATABASE_URL="$RECOLLECT_TEST_DATABASE_URL" \
  RECOLLECT_EMBEDDED_TEST=false \
  ANTHROPIC_API_KEY='' ANTHROPIC_MODEL='' npm test
```

Before that test command, verify its URL names **the new container's local port and `recollect_codex_test`**. Integration suites drop schemas and some `public` fixture tables. Not every suite enforces the `_test` suffix itself. The interactive app database and test database must be different. `npm test` without a test URL skips integration suites and is not complete backend verification.

Expected health is `{ "status": "ok", "service": "recollect-api" }`. Use `POST /v1/auth/development` with a synthetic address such as `codex-local@example.test` for local authentication. Keep returned access/refresh tokens in memory or private temporary files, never logs or commits. Check `/v1/sync/snapshot` and `/v1/progress?timezone=UTC` using that session. Legacy `/api/*` returning `426 upgrade_required` is intentional.

### AI worker scope

The ordinary worker entry point uses the real Anthropic provider. Development authentication does not make generation free or mocked. Keep it stopped for the initial exercise. The full PostgreSQL suite already tests actual pg-boss delivery with an injected provider and makes no paid request.

With the worker stopped, exercise a one-card generation request, observe `queued`, then cancel it and observe `canceled`. If a test API key and model have been supplied for this validation, configure the worker for this same local database and run one real generation through candidate editing and acceptance. Otherwise report provider generation as blocked while completing the other flows. Do not invent successful cards or silently use credentials from an unrelated environment.

## 3. Generate and compile the complete iOS app

### Check the Xcode version first

The current SDK 57 app does not enable scene support. **If this Mac builds with Xcode 27/iOS 27, apply `ios.enableSceneSupport: true` to the existing `expo-build-properties` entry in `apps/mobile/app.config.ts` before generating native files.** The pinned Expo/build-properties versions contain the feature. Keep `deploymentTarget: '18.4'`. An already installed compatible Xcode 26 is another route for initial testing.

For the SDK 57 opt-in, verify the generated scene manifest names `EXExpoAppSceneDelegate` and the app delegate conforms to `ExpoReactNativeFactoryProvider`; do not expect a separate `SceneDelegate.swift`. This changes startup and URL delivery, so test cold and warm links. See [Expo's scene lifecycle guidance](https://github.com/expo/fyi/blob/main/ios-scene-lifecycle.md#staying-on-sdk-57-with-xcode-27). Make any required fix in source configuration, not only the generated project.

### Use a dedicated simulator

Inspect installed runtimes and device types:

```sh
xcrun simctl list runtimes --json
xcrun simctl list devicetypes --json
xcrun simctl list devices available --json
```

Set `RECOLLECT_RUNTIME` and `RECOLLECT_DEVICE_TYPE` to actual available identifiers for a compatible iPhone and iOS 18.4 or newer. Then create a new simulator and retain its UDID:

```sh
export RECOLLECT_SIM_UDID="$(xcrun simctl create \
  "Recollect Codex $(date +%Y%m%d%H%M%S)" \
  "$RECOLLECT_DEVICE_TYPE" "$RECOLLECT_RUNTIME")"
xcrun simctl bootstatus "$RECOLLECT_SIM_UDID" -b
```

Use this exact UDID for every action. Do not use the ambiguous `booted` destination, erase existing simulators, uninstall an existing Recollect app, or select a connected iPhone automatically. Open the installed simulator UI when needed: Xcode 26 uses `Simulator`; Xcode 27 uses `DeviceHub`. The Xcode editor can remain closed.

### Native generation and build

Use the task's explicit public configuration so an existing mobile `.env` cannot select another API:

```sh
export EXPO_NO_DOTENV=1
export EXPO_PUBLIC_API_URL="http://127.0.0.1:${RECOLLECT_API_PORT}"
export EXPO_PUBLIC_ENABLE_DEV_AUTH=true

node apps/mobile/modules/legacy-storage/verify-models.cjs
swift test --package-path apps/mobile/modules/legacy-storage
cd apps/mobile
npx expo install --check
npm run export:ios
npx expo prebuild --platform ios --no-install
cd ios
pod install
cd ../../..
node scripts/check-native-config.mjs
xcodebuild -list -json -workspace apps/mobile/ios/RecollectAI.xcworkspace
```

Use the existing CocoaPods installation or the user's managed Ruby/Homebrew setup if it needs repair. Run `pod install`, not a broad `pod update`. After source/plugin changes, regenerate the native project. Use `prebuild --clean` only after confirming the ignored generated directory contains no user-authored changes that need preserving in a config plugin first.

These are the expected generated names; check them rather than targeting the archived Swift project:

| Item                           | Value                                                       |
| ------------------------------ | ----------------------------------------------------------- |
| Workspace                      | `apps/mobile/ios/RecollectAI.xcworkspace`                   |
| Main scheme / target / product | `RecollectAI` / `RecollectAI` / `RecollectAI.app`           |
| Widget target / product        | `CognitionCuratorWidget` / `CognitionCuratorWidget.appex`   |
| Main bundle                    | `collect.software.cognition-curator`                        |
| Widget bundle                  | `collect.software.cognition-curator.CognitionCuratorWidget` |
| Apple team                     | `KF8643NB33`                                                |
| App Group                      | `group.collect.software.cognition-curator`                  |

Compile the full app, including its Expo module wrappers and extension:

```sh
set -o pipefail
xcodebuild build \
  -workspace apps/mobile/ios/RecollectAI.xcworkspace \
  -scheme RecollectAI -configuration Debug -sdk iphonesimulator \
  -destination "platform=iOS Simulator,id=$RECOLLECT_SIM_UDID" \
  -derivedDataPath "$RECOLLECT_RUN_DIR/DerivedData" \
  2>&1 | tee "$RECOLLECT_RUN_DIR/ios-build.log"
```

If simulator signing is the blocker, try an explicitly recorded unsigned build with `CODE_SIGNING_ALLOWED=NO`. That provides compilation and limited launch evidence; it does not verify real Apple sign-in or signed App Group access. Do not remove entitlements or change bundle/team identities to make the build pass. `expo run:ios` is an alternative, but this app's Apple sign-in entitlement can invoke provisioning setup even for a simulator.

Confirm the build compiled the `CognitionLegacyStorage` and `RecollectWidget` pods and that the resulting app contains `PlugIns/CognitionCuratorWidget.appex`. The generated scheme currently references a `RecollectAITests` target that is not present; do not assume `xcodebuild test` is the native test gate. Use the standalone Swift fixtures plus this full application build.

## 4. Launch and exercise the app

Start Metro in a separate managed terminal with the same explicit Expo variables from section 3:

```sh
cd "$RECOLLECT_REPO_ROOT/apps/mobile"
npx expo start --dev-client --localhost --port "$RECOLLECT_METRO_PORT"
```

Install only on the reserved simulator, launch, and load the development bundle:

```sh
xcrun simctl install "$RECOLLECT_SIM_UDID" \
  "$RECOLLECT_RUN_DIR/DerivedData/Build/Products/Debug-iphonesimulator/RecollectAI.app"
xcrun simctl launch "$RECOLLECT_SIM_UDID" collect.software.cognition-curator
xcrun simctl openurl "$RECOLLECT_SIM_UDID" \
  "exp+recollect-ai://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A${RECOLLECT_METRO_PORT}"
xcrun simctl io "$RECOLLECT_SIM_UDID" screenshot "$RECOLLECT_RUN_DIR/first-launch.png"
```

Inspect the rendered app and runtime logs. A successful `simctl launch` does not prove that React Native rendered. Expo Go cannot validate the custom reader/widget modules.

Use the simulator interaction tools actually available in this Codex session. An installed UI test runner such as Maestro is another option; inspect its help before selecting the exact device. Add narrowly useful accessibility labels/test IDs if needed. Screenshots alone are not proof that a workflow was exercised. If interaction is blocked, complete everything else and state the exact remaining manual steps.

| Check                  | Required observation                                                                                                                                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Development login      | Sign in with a synthetic account against this local API; home and empty library render.                                                                                                                                                     |
| Deck/card lifecycle    | Create a deck and two manual cards; edit, pause/resume, and delete test content; inspect the server snapshot and UI.                                                                                                                        |
| Review                 | Reveal and rate a card; due time and progress update, with one recorded server event. Practice does not schedule another review.                                                                                                            |
| Offline persistence    | Stop only this task's API, keeping Metro running. Edit a card and review offline, terminate/relaunch this simulator app, and verify saved content and pending work remain. Restart the same API and verify convergence with no extra event. |
| Conflict handling      | Use another synthetic client/session for the same owner to edit a card while its first client has an offline edit. Verify both versions remain available and choosing the server retains a recovery copy.                                   |
| Account isolation      | Switch to a second synthetic account. Verify the first account's cards/outbox are absent. Switch back and verify its work remains. Test sign-out with optional widget failures.                                                             |
| AI workflow            | Observe queued/canceled behavior without a worker. With supplied test provider credentials, verify generation, draft edits, acceptance, and retry without duplicate cards. Distinguish those two results.                                   |
| Fresh install recovery | Profile should report that no old store is present on this fresh simulator. `native_unavailable` indicates a missing integration; entitlement failures in an unsigned build require signed follow-up.                                       |
| Export                 | Produce and inspect a test-data export; it includes cards, reviews, pending work, and recovery evidence, without auth secrets.                                                                                                              |
| Deep links             | Open the routes below while the app is running and after terminating it. Existing card links must load the correct hydrated card, not an empty queue.                                                                                       |

Supported routes include:

```text
cognitioncurator://review
cognitioncurator://review/<existing-card-UUID>
cognitioncurator://review?cardId=<existing-card-UUID>
cognitioncurator://review?deckId=<existing-deck-UUID>
cognitioncurator://review?practice=true
```

Use `xcrun simctl openurl "$RECOLLECT_SIM_UDID" "<actual URL>"`. For cold starts, terminate that exact app first. Test Home Screen/Control Center widgets where the signing and simulator environment support them, and record limitations separately.

Use app exports, authenticated snapshots, and test database queries to corroborate important state transitions. The SQLite filename is `recollect-v2.db`; locate it only inside the dedicated app's container if inspecting it. Preserve SQLite/WAL consistency and use read-only queries or the backup API instead of copying an active main database file alone.

## 5. Fixes and remaining release work

Prioritize reproduced installation, native compilation, launch, storage, auth, and sync failures. Keep fixes in `apps/mobile`, its modules/config plugin, or the relevant TypeScript package. Generated `apps/mobile/ios` and `android` are ignored build products. Preserve the six archived Swift model/helper hashes; add a separate reader for another schema instead of changing those models.

Read `docs/dependency-review.md` before changing packages. Mobile has four distinct upstream advisories propagated through its dependency tree. The URL decoder is a runtime concern; its published fix changes module compatibility. Expo/React Native downgrades and blanket `npm audit fix --force` are not a tested solution. Keep unresolved findings explicit and make any remediation a focused, validated change.

Real Apple login, physical-device protection, installed-widget continuity, and an actual old-app upgrade remain distinct gates. Use a designated test device or separate upgrade simulator with a real old build and representative data. Preserve a recoverable backup before an in-place upgrade. Never use the user's only old installation as an expendable fixture or advise reinstalling to fix recovery. Compare IDs, due dates, raw backup, archived history, pending/failed operations, ownership confirmation, and repeated-import behavior. A fresh simulator and Swift fixtures cannot prove those results.

The app is iOS-first. Production account deletion, billing, notifications, full combined-deck semantics, and Android production sign-in remain product work. EAS profiles and the manual cloud-build workflow are present, but the Expo project, signing, and staging API still need configuration before that route can be used. Keep that separate from finishing the local Mac run.

## 6. Deliver a concrete validation result

Create or update `docs/mac-validation.md` with:

- Mac/CPU, Node/npm, Xcode/SDK, simulator runtime/UDID, checkout commit, and signing mode.
- A results table marking each gate **passed**, **failed**, or **blocked**, with commands and observed evidence. Include test counts, full native build, actual app launch, UI flows, native module availability, and provider/auth/upgrade boundaries separately.
- Reproduced issues, fixes, and the focused checks rerun. Do not weaken assertions or label an unexecuted manual check as passed.
- The local API/Metro addresses, container name, managed process IDs, synthetic test accounts, log/screenshot paths, and how to restart or stop only those resources. Redact secrets, tokens, and personal data.
- Exact remaining blockers and the smallest user action needed for each.

Leave the app running for the user if practical and state where it is open. Do not use broad process kills, global Docker cleanup, simulator resets, or automatic volume deletion. Keep credentials, local environments, database copies, screenshots containing private data, generated native projects, and DerivedData out of git.

Run the relevant checks after fixes, inspect the diff, then commit and push the handoff's validation report and fixes on the feature branch. If existing local work required a separate branch, report it explicitly. Fetch before pushing, preserve newer remote commits, and do not force-push. Finish with the commit, what actually ran on the Mac, what the user can open, and any remaining blockers.

### Official references

- [Expo local debug builds](https://docs.expo.dev/guides/local-app-development/)
- [Expo simulator setup and current simulator UI](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo SDK 57 scene lifecycle opt-in](https://github.com/expo/fyi/blob/main/ios-scene-lifecycle.md#staying-on-sdk-57-with-xcode-27)
- [Maestro quickstart, if using that runner](https://docs.maestro.dev/get-started/quickstart)
