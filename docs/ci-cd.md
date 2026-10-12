# Main releases to TestFlight

Railway already deploys the backend automatically on commits to main through its
existing repository connection. That configuration remains unchanged.

`.github/workflows/recollect-release.yml` handles only the app: main push → checks
→ version stamp → Expo OTA or native TestFlight release → tag and notifications.
It does not deploy Railway services, poll their status, check API health, or require
Railway tokens/service IDs. App release runs are serialized.

## Branch names choose the release

Merge a pull request into `main` using one of these source branch names:

| Source branch | Delivery | Version example |
| --- | --- | --- |
| `enhancement/*` | OTA to the current compatible TestFlight binary | `2.0.0` → `2.1.0` → `2.2.0` |
| `feature/*` | Fresh native build and TestFlight submission | `2.2.0` → `3.0.0` |

The workflow resolves the merged PR from the exact main commit through GitHub's
API, including squash/rebase merges; commit messages and deleted branch refs are
not needed. Direct pushes and other branch prefixes stop with an actionable error.
For these, manually dispatch on main with `release_type=ota` or `native`.

The version starts from `2.0.0`. After successful delivery, CI creates an annotated
`recollect/v<version>` Git tag on that main commit. Its JSON records the release
version, native version, delivery type, branch and commit. The latest successful
tag determines the next version. Failed runs do not consume a version; reruns of
an already successful commit skip delivery. Superseded commits cannot overwrite a
newer release. Do not edit/delete these release tags.

A native release always builds and submits, even if the code could use OTA. An
OTA requires a matching TestFlight native fingerprint. If an enhancement changes
native dependencies, permissions, widgets or SDKs, it fails explicitly; use a
`feature/*` branch or dispatch a native release. It never silently publishes an
incompatible OTA or switches the intended version bump.

## Identifying the version on your phone

Each main release shows its semantic version (for example `2.1.0`) and is also
stamped as `r<workflow run>.<attempt>-<short commit>`, for example `r14.1-80ce215`.
Retrying a failed release produces `r14.2-80ce215` with the same semantic version;
completed deliveries are skipped.
The label appears in the GitHub run summary, EAS build/update messages, TestFlight
release notes, Home, the sign-in screen, and **You → App version**. A failed run
does not make its label available on your phone; check the release job's result.

The App version panel shows the app version, the installed binary's build number,
the running release's commit and Expo update ID, and whether the code came from
the built-in bundle or OTA. The build number increments only for a new native
build. An OTA keeps that number and changes the release label after it is applied.
The first line shows the running JavaScript release version. The Native line shows
the binary's marketing version and build number. For example, release `2.2.0` can
run on native `2.0.0` build 2. A major release changes the native marketing version
as well, such as native `3.0.0` build 3. TestFlight's version changes only with a
native release.

In an installed release build, the app checks for compatible updates when you
return to it and every minute during an active session. Automatic checks share
one request with manual checks and back off while offline. Once downloaded, a
banner offers **Restart** and **Later** on any screen. Restart is always explicit;
save edits first. Choosing Later keeps the running version until a later restart.

**You → App version → Check for updates** also checks and downloads a compatible OTA. **Restart to apply update** starts the downloaded code. Until
restart, the displayed release still identifies the currently running code.
A check with no compatible OTA does not prove there is no newer native build;
install that through TestFlight and compare its release notes. Development builds
display their development status and do not offer OTA checks.

CI overwrites the tracked `apps/mobile/src/release-info.json` before uploading
the source to EAS. This JSON is imported into the JavaScript bundle, independently
of native configuration. CI verifies that changing only the minor release
version/stamp preserves the iOS fingerprint, and that changing the native major version changes it.
`apps/mobile/native-version.json` contains the checked-in `2.0.0` baseline; CI
hydrates it from the release plan before EAS computes fingerprints or builds.
For local/manual builds after a major release, use the native version recorded
in the latest successful release tag. Local source
has an explicit `local` placeholder; a manually built unstamped release is shown
as **Unversioned release** rather than implying it came from main.

`apps/mobile/.eas/workflows/testflight-release.yml` compares the iOS native
fingerprint against a successful store build on channel `testflight`. The source
branch selects OTA or native as described above.
The first release needs a store build. The existing ad hoc
`preview` installation cannot serve as the TestFlight baseline.

OTA updates cover compatible JavaScript and assets. Native modules, SDK upgrades,
entitlements, widget code and native permissions need new binaries. With the
default Expo Updates behavior, updates download on launch and apply on a later
launch; OTA does not create a new TestFlight build number. Native builds must finish
Apple's processing. Keep API changes compatible with older installed runtimes.

## GitHub and Expo setup

Create a GitHub environment named `main` with these secrets:

| Secret | Purpose |
| --- | --- |
| `EXPO_TOKEN` | CI token for the personal `collectsoftware` Expo account |

Set the following variables in that same environment:

| Variable | Value |
| --- | --- |
| `API_URL` | Stable API HTTPS origin, without an `/api` suffix |
| `ASC_APP_ID` | Numeric Apple ID of this app in App Store Connect |

Missing Expo settings or a temporary API address stop app publication. CI adds the numeric Apple app ID to the uploaded submission
profile and sets the public API URL and `EXPO_PUBLIC_ENABLE_DEV_AUTH=false` in
Expo's `preview` environment. Database and AI credentials stay in Railway.

The app uses `@collectsoftware/recollect-ai`, project ID
`2d6f42f7-8c17-4f27-9c69-7ce868abdb74`. The `testflight` profile uses store
distribution, automatic build-number increments, the `testflight` channel, the
`preview` environment, SDK 57 and Node 24.21.0. Production remains a separate
channel. GitHub uploads the checked-out source using `eas workflow:run`; an Expo
GitHub integration is optional. Do not add a second direct EAS push trigger,
which would duplicate the app release workflow.

## Release notifications

Use one private Slack incoming webhook connected to the chosen workspace/channel.
Store its URL as the **repository secret** `SLACK_RELEASE_WEBHOOK`, so reporting
also works when checks fail before the main deployment job starts. Do not put the
URL in source, variables, release notes or chat. The webhook is channel-bound;
change the Slack app's connection if the destination changes.

The pipeline announces the release start after checks pass, then reports the final
result with version, source commit, GitHub run and Expo project links. A native
success says submitted to TestFlight; an OTA success says published. Failures in
checks, planning, delivery or tag recording are distinguished. An always-running
report job writes the result to GitHub's run summary as well. Missing Slack
configuration or a notification failure does not block deployment.

GitHub continues to wait for EAS to finish before recording a successful release
tag. This avoids announcing success when a queued build or Apple submission later
fails. The existing EAS TestFlight workflow handles both build and submission;
no one needs to download/upload the binary manually. The app's update prompt uses
Expo's native download state, so no backend notification service is required.

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
main with `release_type=native` to bump the major version, build and submit a fresh
binary. Failed app checks or Expo build/update/submission steps prevent release.

The commit SHA appears in Railway, EAS build and OTA messages. Use GitHub Actions and
EAS workflow logs to diagnose failed releases. OTA rollback
does not undo SQLite/PostgreSQL migrations or restore records.

## Validation

```sh
node --test scripts/test-release-pipeline.mjs scripts/test-release-metadata.mjs scripts/test-release-policy.mjs scripts/test-release-notifications.mjs
npm run typecheck
cd apps/mobile
npm exec --yes --package=node@24 --package=eas-cli@24.12.1 -- eas workflow:validate .eas/workflows/testflight-release.yml --non-interactive
```

References: [Expo release workflows](https://docs.expo.dev/eas/workflows/examples/deploy-to-production/),
[EAS Updates](https://docs.expo.dev/eas-update/how-it-works/).

The notification and update-prompt design is adapted from [Somethings’ release pipeline](https://blog.somethings.com/blog/release-pipeline), while preserving this app’s enhancement/minor and feature/major rules and single main-to-TestFlight flow.
