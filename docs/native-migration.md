# Native data recovery and widget continuity

This branch generates the new iOS project through Expo CNG. Native source is limited to the legacy reader and the retained WidgetKit extension. No source files in the original Swift app have been changed by this migration implementation.

## Interfaces used by the Expo app

`apps/mobile/modules/legacy-storage/index.ts` exports:

- `inspectLegacyStore()` returns `found`, `absent`, `needs_recovery`, or `native_unavailable`. Finding a file does not certify its schema or owner. Absence never marks a migration complete.
- `exportLegacyStore()` returns a versioned recovery manifest with logical records or a `needs_recovery` result. It never uploads data, modifies the original store, authenticates a person, or claims that an import completed.
- `LegacyExport` contains the original deck/card/review/operation IDs and relationships, ISO UTC dates, **review intervals explicitly in minutes**, silence state, metadata, selected preferences, and all legacy queue states. The old queue's entity ID does not necessarily equal the saved review ID. Even entries marked synced are retained as reconciliation evidence.

Credentials are deliberately excluded. `currentUserId`, `cachedUserAccount.id`, and IDs extracted from `storedUsers` are returned only as `ownerHints` with `trusted: false`. Names, emails, saved passwords, JWTs, JWT expiration, and demo purchase grants are not exported from defaults. Device owner hints and a valid old JWT are not proof of ownership, particularly because the old Apple verifier was defective.

`apps/mobile/modules/recollect-widget/index.ts` exports:

- `setWidgetOwner(verifiedInternalUserId)` at authenticated session restoration/login. It clears previous content and sets the permitted owner.
- `publishWidget(snapshot)` after reading the current owner's SQLite state. The native writer rejects another owner's snapshot, including late async writes arriving after sign-out.
- `publishWidget(null)` immediately on sign-out. It revokes the active widget owner and clears both new and old unscoped keys.
- `isWidgetAvailable()` identifies whether this native integration exists in the installed build. Missing native modules on Expo Go/web/Android cannot prove iOS recovery or widget functionality.

## How recovery protects the original store

1. Resolve `ModelConfiguration.url` with the original automatic configuration, and also inspect the sandbox configuration and the original App Group's Application Support directory. The App Group can control SwiftData's default location. Do not assume a Documents path.
2. Require an existing regular file. Multiple candidate stores are an explicit recovery condition, not a reason to pick one silently. Symlink candidates are rejected. Discovery never constructs a `ModelContainer`.
3. Open SQLite with `SQLITE_OPEN_READONLY` and use SQLite's online backup API. This captures committed WAL content consistently; copying only the `.store` file would miss WAL changes. The original store is never checkpointed, migrated, saved, or deleted by the reader.
4. Retain a protected backup under the new app's `Application Support/RecollectLegacyRecovery/` directory. Open only a **separate working copy**. Both logical export and backup receive iOS complete file protection.
5. Check Core Data store metadata for the known entity set, then create a container on the working copy with `allowsSave: false` and `cloudKitDatabase: .none`. Autosave is disabled. Read errors, unsupported schemas, failed integrity checks, duplicate identities, or unresolved object references produce `needs_recovery`, never an empty successful export.
6. Verify the working database and preserved backup hashes did not change during reading, and reject nonempty WAL/journal sidecars that could contain writes absent from the main-file hash. Preserve all raw backups on failure. No original store or backup is automatically removed on success either.
7. Write a JSON manifest with a content hash, stable export identity, source provenance, counts, logical relationships, schema revision, snapshot hash, and local recovery file URIs. An import batch UUID must be persisted separately against the export ID; the export ID itself is a SHA256 string.

Unknown-schema, relationship, changed-snapshot and invalid-export failures are cached by reader revision plus the source/WAL fingerprint. Repeated calls on the same unsupported source return the preserved recovery result instead of producing an automatic retry loop or repeated backups. A changed source or a new compatible reader invalidates that cache. Readability failures such as a locked device can be retried after unlocking.

The SQLite backup is generic and preserves an unsupported database for later recovery. The logical SwiftData reader currently targets the five-model schema checked in at `a8ff38320b01d93438efe44694f72168a56ada7b`. It does **not** claim support for every earlier Core Data/SwiftData schema or an uninspected deployed binary. Do not guess at private `Z...` tables to work around a schema mismatch.

### Original model identity

`ios/LegacyModels/` contains byte-for-byte copies of `Deck`, `Flashcard`, `ReviewSession`, `SyncOperation`, `User`, and `CodableHelpers` from that revision. `legacy-models.sha256.json` pins the copies. The pod's `module_name` and Expo's `apple.swiftModuleName` both remain `cognition_curator`, matching the original app module and original native tests. Renaming only classes while changing their Swift module would not establish migration compatibility.

Keep this archived schema unchanged. Add another explicitly supported reader if an older shipped schema differs. Matching source identity is a compatibility measure, not a substitute for opening an actual older installed store in a device upgrade test.

## Ownership and import are separate from extraction

The original store is shared across sign-ins and has no owner column on content or queue records. A recovered manifest therefore stays quarantined until a freshly verified account and explicit recovery decision establish which content can be imported. Confirm server ownership where available; keep ambiguous local-only records separate. Never replay the old queue under whichever account is currently logged in.

AI-created cards can have unrelated local and server UUIDs. Preserve local identities and history, record an explicit mapping only when evidence supports it, and retain ambiguous copies. Equal question/answer text alone is insufficient for deduplication.

Import the current card schedule as a checkpoint. Archive earlier reviews without scheduling them a second time. Pending legacy operations and backend history cannot always be matched exactly, because the old payload omitted stable review IDs and original review times. Do not invent that mapping or replay the full archive as new events.

Fresh Apple authentication is required for the server recovery operation. An expired or compromised legacy session can be replaced without destroying the quarantined local archive. The API must derive ownership from its verified session, not an exported owner hint.

## Skipped app updates

This reader is embedded in the first Expo binary so that a user can upgrade directly from the original Swift app. It does not depend on having installed a transitional export build. A transitional Swift export release can still reduce risk, but is not included in this branch and must not become the only recovery path.

Retain the reader for the supported upgrade window. Removing it needs evidence about oldest installed versions and a recovery path for users who skipped intermediate builds. Never tell a user to reinstall to resolve migration trouble: that can remove the original on-device source.

## Generated widget target

`apps/mobile/plugins/withRecollectWidget.cjs` copies committed Swift sources into the generated iOS project and creates an app-extension target with:

| Identity            | Preserved value                                             |
| ------------------- | ----------------------------------------------------------- |
| Main bundle         | `collect.software.cognition-curator`                        |
| Extension bundle    | `collect.software.cognition-curator.CognitionCuratorWidget` |
| App Group           | `group.collect.software.cognition-curator`                  |
| Home widget kind    | `CognitionCuratorWidget`                                    |
| Control Center kind | `CognitionCuratorWidgetControl`                             |
| URL scheme          | `cognitioncurator`                                          |
| Minimum OS          | iOS 18.4, matching the old app's current minimum            |

Home Screen small/medium widgets retain open-to-review behavior. The Control Center button opens the same review route. Both read an owner-scoped, atomically encoded snapshot. They perform no network requests and do not apply reviews in a widget process. The due count is a snapshot from the app, not a guarantee of continuous background recalculation. The platform decides when requested refreshes appear; an already rendered timeline cannot be remotely erased synchronously.

The app supplies the next due card when one exists. With nothing due, it supplies
a random saved card, including cards scheduled for later or in paused decks. That
fallback stays selected across unchanged refreshes and is replaced if removed;
a newly due card takes priority. The due count remains accurate at zero during
this fallback, and tapping opens the selected card directly. A truly empty library
or a signed-out account has no personal card to display. Logout and account
switches still clear the previous owner's content. Preview text is bounded before
crossing the native bridge so long multilingual cards cannot exceed its payload
limit. These selection changes use the existing snapshot format and support OTA.

The plugin declares the extension and App Group in EAS app-extension metadata, adds source/resource and embed phases, and assigns entitlement files in both Debug and Release. The generated target is `CognitionCuratorWidget`; installed continuity depends on the preserved bundle/kind rather than the old Xcode target's display name. The plugin refuses a different main bundle identity instead of accidentally attaching the old group's data to a new application.

The source uses a small retained Swift WidgetKit target instead of making installed-widget survival depend on switching widget frameworks at the same time as changing storage. A future Expo Widgets replacement can be evaluated after continuity is proven. Native targets, modules, entitlements, and these widget Swift sources require a new binary; a JS OTA update alone cannot install them.

## Checks and release gates

Linux/container checks performed while implementing this branch:

- Archived-model hashes and original module name verified.
- Expo iOS prebuild completed without installing pods or invoking a paid cloud build.
- The emitted project contains the widget source/resource/embed phases, original bundle IDs, App Group, iOS minimum and entitlement paths in both configurations.
- Reapplying the project plugin produces an identical project.
- Expo autolinking discovers both local modules and imports the legacy module as `cognition_curator`.

Native source cannot be compiled in the current Linux environment. These macOS checks are supplied for CI:

```sh
node apps/mobile/modules/legacy-storage/verify-models.cjs
swift test --package-path apps/mobile/modules/legacy-storage
xcrun swiftc -typecheck -parse-as-library \
  -sdk "$(xcrun --sdk iphonesimulator --show-sdk-path)" \
  -target arm64-apple-ios18.4-simulator \
  apps/mobile/modules/recollect-widget/ios/WidgetSnapshot.swift \
  apps/mobile/modules/recollect-widget/widget/CognitionCuratorWidget.swift
```

The native tests exercise missing-store failure, a WAL-inclusive SQLite backup without source changes, preservation/caching of unsupported-schema backups, and a logical export preserving IDs/schedule/failed operations without exposing credentials. They use a temporary fixture store. They do not substitute for a real original-app upgrade or compile the Expo module wrappers.

The release gates remain:

1. Install an actual old signed build, create manual/AI cards, change silence/name, review offline, leave pending and failed operations, then upgrade directly to Expo. Verify all IDs, raw backup, checkpoints, archive counts, duplicate provenance, repeated-import behavior and supported old schemas.
2. Use real Apple authentication and account switching. Verify no SQLite data, old queue operation, recovery assignment or widget snapshot crosses accounts. Exercise offline launch and an expired session.
3. Force-quit around reviews, outbox commits and acknowledgements. Retry delivery and review on two devices offline. Verify one accepted event per identity and convergence under the declared scheduler policy.
4. Build the full iOS app and its native wrappers, inspect signed entitlements, and test an already installed Home Screen widget/Control Center button plus cold/warm card deep links. Prebuild success is not compilation, signing, an App Store upload, or proof of physical-device behavior.

Official API references: [Expo local modules](https://docs.expo.dev/modules/get-started/), [Expo module configuration](https://docs.expo.dev/modules/module-config/), [Expo app extensions](https://docs.expo.dev/build-reference/app-extensions/), [SwiftData model configuration](https://developer.apple.com/documentation/swiftdata/modelconfiguration), [SwiftData automatic App Group container](https://developer.apple.com/documentation/swiftdata/modelconfiguration/groupcontainer-swift.struct/automatic), [SQLite online backup API](https://sqlite.org/backup.html), [WidgetKit control updates](https://developer.apple.com/documentation/widgetkit/updating-controls-locally-and-remotely).
