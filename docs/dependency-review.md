# Dependency security review

Reviewed on 2026-10-11 against the rebuild branch's lockfile, installed dependency sources, npm registry metadata, and the linked upstream advisories. This is a bounded review of the four advisories reported by npm, not a complete security audit or a production release approval.

## Current result

The full-workspace `npm audit --omit=dev --json` run reported **31 affected dependency nodes: 19 high and 12 moderate**, arising from **four distinct advisories**. npm propagates an advisory to packages that depend on the affected package; these counts do not mean 31 distinct vulnerabilities in application code. There is no claim that the mobile dependency audit is clean.

No dependency override, unreviewed cryptographic patch, Expo/RN downgrade, or audit suppression was applied as part of this review. The suggested Expo 44 / React Native 0.72 downgrades are incompatible with this SDK 57 implementation and its native integrations.

The important separation is between a dependency being present, its vulnerable API being reachable, and a fixed release being compatible with its callers. The API's authentication uses `jose` and Node/Web Crypto, not `node-forge`. The URL decoder below is used by the installed mobile router and should not be dismissed as a build-only finding.

## Findings and remedies

| Package in the reviewed lock | Actual path/use found                                                                                                      | Published remedy                                          | Disposition                                                                                                                                        |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node-forge@1.4.0`           | Expo CLI and `@expo/code-signing-certificates@0.0.6`; certificate parsing and local signing/certificate validation tooling | No fixed release listed; registry `latest` is still 1.4.0 | Keep visible as an upstream blocker. A reviewed backport is a separate engineering change, not a version override.                                 |
| `braces@3.0.3`               | `@expo/metro` → `metro-file-map` → `micromatch`; build/watch glob processing                                               | No fixed release listed; registry `latest` is still 3.0.3 | Keep visible; limit build tooling to trusted configuration and inputs while tracking an upstream fix.                                              |
| `decode-uri-component@0.2.2` | `expo-router@57.0.25` → `query-string@7.1.3`; mobile route/query parsing                                                   | 0.5.0 fixes the advisory, but is ESM-only                 | Prioritize a compatible Router 57 backport or reviewed CommonJS-compatible patch. Do not blindly override the decoder.                             |
| `uuid@7.0.3`                 | `@expo/config-plugins` → `xcode@3.0.1`; generated Xcode project IDs                                                        | 11.1.1 is a patched release with a CommonJS export        | A scoped `xcode` → `uuid@11.1.1` override is a plausible compatible remedy, subject to clean-install and prebuild checks. It was not applied here. |

### node-forge: priority assessment

[GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv) concerns incomplete validation of nested RSA PKCS#1 v1.5 signature structures and describes forgery with low-exponent RSA keys. It marks versions through 1.4.0 affected and lists no patched release. [Upstream PR #1152](https://github.com/digitalbazaar/forge/pull/1152) remains open at review time. Installing another 1.4.0 copy or forcing an old Expo release does not constitute remediation.

Installed-source evidence narrows the current exposure:

- `@expo/cli/build/src/run/ios/codeSigning/Security.js` parses certificates obtained from the macOS `security` command. This inspected path does not call the affected signature-verification API.
- `@expo/code-signing-certificates/build/main.js` does call certificate/public-key verification in `validateSelfSignedCertificate` and `signBufferRSASHA256AndVerify`. These are certificate/signing workflows; they are not the application's Apple login verifier.
- Its key-generation helper uses Forge's default RSA generation settings. The installed `node-forge/lib/rsa.js` defaults the exponent to 65537. This narrows applicability of the described low-exponent attack for newly generated keys, but does not repair the parser or establish safety for every imported certificate/key.
- On-device iOS update signature verification is native: the installed `expo-updates/ios/EXUpdates/CodeSigning/CodeSigningConfiguration.swift` calls Apple's `SecKeyVerifySignature`. The Node package's presence in the npm tree is not evidence that the iOS client verifies update signatures with Forge.

Until a maintained patch is available, preserve the lock, keep signing inputs controlled, and do not treat Forge verification of arbitrary external certificates/signatures as a new trust boundary. If a backport is necessary before release, review the exact upstream change, pin its provenance, verify the applied file hashes, run both valid-signature and malformed-signature regressions, and keep npm's remaining finding visible. That work was not performed in this bounded review.

### URL decoder: runtime follow-up

[GHSA-vcc3-ghjq-m6fr](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr) identifies excessive decoding work for malformed percent-encoded input and recommends 0.5.0 or input-size limits. The installed Router calls `queryString.parse(query)` in `build/react-navigation/core/getStateFromPath.js`; `query-string/index.js` calls the result of `require('decode-uri-component')` directly as a function.

Registry metadata for 0.5.0 declares `type: "module"` and an ESM default entry, while the current consumer is CommonJS. Its safe-version number alone does not establish drop-in compatibility. npm's proposed Router 58.0.17 replacement crosses the SDK major version and requires a planned compatibility upgrade.

The focused release follow-up is a supported Router 57 backport or an integrity-pinned CommonJS adaptation of the upstream decoder fix, tested with malformed/oversized external URLs, valid Unicode and query strings, and the app's cold/warm review deep links. A guard that rejects unsafe input _before_ Router parsing is a possible temporary mitigation, but its execution order must be proven. No pre-parser guard or decoder patch is claimed in this report.

### uuid and braces

[GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) affects v3/v5/v6 APIs with caller-provided output buffers. The installed Xcode generator uses only `uuid.v4()` with no arguments, then formats the returned string into a project identifier. The affected operation was not found in that consumer. Registry metadata confirms 11.1.1 still offers `require` exports, making a scoped override a reasonable candidate. Validate generated target identities, entitlement assignments, embedding, and plugin idempotency after changing it.

[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) describes deeply nested brace-pattern recursion; 3.0.3 remains the current published version without a listed fix. The inspected `metro-file-map/src/watchers/common.js` uses micromatch for watcher globs. This is distinct from flashcard content, API authentication, or review scheduling. A maintained patch or upstream dependency change is still needed to clear the advisory.

## Backend artifact isolation

A workspace-filtered audit against the original shared installation still followed `@recollect/db` → Drizzle's optional `expo-sqlite` peer → Expo and reported mobile findings. That result is **not proof of runtime execution or of an actual container's contents**.

The backend implementer moved descriptor-only Drizzle to development dependencies, omitted the mobile workspace manifest from Docker's install inputs, and added a production prune after installation. The exact final manifest/install sequence was then exercised in a fresh temporary directory, rather than inferred from the shared working tree.

That fresh install contained the required `tsx` and `pg-boss` runtimes, and API, worker, and migration imports passed. Physical package checks found **no Expo, expo-sqlite, React Native, node-forge, braces, decode-uri-component, uuid, Drizzle, TypeScript, or Vitest** in the isolated runtime tree. This is concrete install-artifact evidence, not proof that a container was built, deployed, or subjected to a complete security review.

The isolated runtime install's `npm audit --omit=dev` completed with exit code 0 and **zero reported vulnerabilities across all severities**; its JSON result was independently checked. The full monorepo/mobile audit remains unresolved regardless of backend isolation. A first attempt that retained the mobile manifest installed these packages, which is why both the manifest boundary and production prune matter.

## Reproduction and narrow follow-ups

Commands used for the review include:

```sh
npm audit --omit=dev --json
npm ls node-forge braces decode-uri-component uuid --all
npm ls node-forge braces decode-uri-component uuid --all --omit=dev --workspace @recollect/api --workspace @recollect/worker
npm view node-forge version --json
npm view braces version --json
npm view decode-uri-component@0.5.0 version type exports main engines --json
npm view uuid@11.1.1 version type exports engines --json
```

Maintain the verified backend install boundary, address the decoder's runtime path, then validate the narrow UUID override. Recheck Forge/Braces upstream status before a mobile production release. Keep unresolved findings explicit; neither a successful prebuild nor passing application tests resolves these advisories.
