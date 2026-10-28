# Recollect App Store release draft

This is a preparation document, not proof that an app has been approved, submitted, or released. Preserve the existing App Store artwork and icon. Check current App Store Connect metadata before replacing any assets.

## Known identifiers and public pages

- App: Recollect AI; bundle ID `collect.software.cognition-curator`.
- Owner-confirmed public publisher: Collect Software; monitored support email: `collectsoftwarev2@gmail.com`.
- Apple team ID: `KF8643NB33`; Apple app ID confirmed in App Store Connect: `6749138102`.
- Marketing URL: `https://recollect-ai.netlify.app/`.
- Support URL: `https://recollect-ai.netlify.app/support/`.
- Privacy URL: `https://recollect-ai.netlify.app/privacy/`.
- Community guidelines URL: `https://recollect-ai.netlify.app/community-guidelines/`.
- Friend invitations: `https://recollect-ai.netlify.app/friends?invite=…`.
- Download destination is intentionally `null` in `apps/landing/site-config.js` until a public App Store or TestFlight URL is verified.

## Submission preparation status — October 28, 2026

- App Store Connect currently has an iOS version **7.0.0** in **Prepare for Submission**, with product copy, review notes, and the owner-provided private review contact saved. This is a draft, not a submitted or approved release.
- The latest completed store/TestFlight binary is **6.0.0 (7)**, EAS build `b65e3fd7-a51f-479f-93ef-f6e3b8c53d38`, built on October 24 from `bad082c46725bc8f2993b2adaaf7c34ffb5b296c`. Its embedded bundle predates the current review improvements.
- Current main is `1c1812c43a31df4e58385a0b8a6e5c6ea9483d01`, delivered as OTA **6.7.0** for native version **6.0.0**. An installed OTA does not change the embedded bundle in the binary selected for App Review.
- A fresh **7.0.0** native release is planned. The first cloud attempt exhausted the account's free iOS build allowance; it did not deliver a new binary. The release pipeline must complete its build and upload before that build can be selected for review. Match the processed candidate to the draft version; do not select the older binary by accident.
- Capture actual current-app iPhone and iPad screenshots at accepted device resolutions. The screenshot upload, App Privacy declarations, and required App Review contact fields are still pending.
- Submission has not been confirmed. Record the selected build and App Store Connect submission status only after those actions succeed.

The simulator EAS profile retains its development-client behavior. The local Xcode 16.3 toolchain cannot compile the Expo SDK 57 Swift 6.2 requirements. The manual `recollect-ios-simulator.yml` workflow builds with EAS `--local` on a GitHub-hosted macOS 26 runner using Xcode 26.2, then uploads the verified simulator app as a short-lived artifact for native screenshot capture. It does not use an EAS cloud build slot.

Native releases also use EAS `--local` on that runner, with the existing managed signing credentials, `testflight` profile, preview environment, TestFlight OTA channel, and Apple team. Before submitting the exact IPA path, the pipeline checks its signed app identity, version, distribution profile, and embedded update runtime. A successful waited upload records compatibility proof in the annotated release tag; later OTA releases can use that proof when there is no EAS cloud build record. An upload is not proof of Apple processing, review submission, approval, or public availability.

## Remaining release verification

The latest verified public website deployment is Netlify `6ae10686a6d66236429082f9`, published October 27, 2026 from the editorial website changes merged in `9eb469b`. Netlify lists `recollect-support` and `recollect-waitlist` as active forms with detection enabled. No support message was submitted as a test. This document is not part of the published static directory.

- Confirm receipt when an actual support message is submitted. A native POST fallback and success page are provided; form detection alone does not prove delivery to a person's inbox.
- Verify deletion in the production service: confirm Apple revocation credentials and processing configuration, test fresh Apple confirmation, distinguish accepted/pending from completed, and inspect a real request’s final status. A request must stay pending until Apple revocation and owned-data erasure complete.
- Verify the completed consent, report/block, deletion-recovery, and local-cleanup flows in the submitted binary. Code and policy descriptions below do not substitute for a device check.
- Follow [the moderation runbook](community-moderation.md) to review the private report queue. No automatic report notification or review SLA is configured or promised.
- Confirm the operator’s actual retention, backup, and privacy-request processes. The draft policy avoids fixed deletion, retention, location, or AI-training promises. Do not replace unknowns with invented guarantees.
- Verify the live API is healthy and production Apple sign-in works. Test manual card creation, AI generation, offline review, sync, sharing consent, report/block, and deletion on a real supported iOS device before submission.
- Inspect the current version/build in App Store Connect rather than relying on the repository’s local version placeholders; CI writes release metadata during delivery.

## Suggested product-page copy

Name (30 characters maximum):

> Recollect AI

Subtitle (30 characters maximum):

> Make curiosity stay

Promotional text (170 characters maximum):

> Follow a curiosity. Turn it into flashcards. Practice a little, share with a friend, and see what’s starting to stick.

Description draft:

> A home for what catches your mind.
>
> A new language. A big idea. That thing you fell into at 2 a.m. Recollect turns your curiosities into flashcards you can make your own and come back to.
>
> MAKE A DECK
> Start with a subject and get a small set of AI-generated suggestions. Review them, edit the details, and keep the useful ones. Write your own cards or ask AI to draft an answer to a question.
>
> PRACTICE A LITTLE
> Tap to reveal a card. Swipe right when you remember and left when you’re not sure. Recollect uses your ratings to shape the next review. Your saved cards and practice work offline; connect to generate and synchronize.
>
> LEARN TOGETHER
> Invite a friend and share a deck. Detailed recall history is a separate sharing choice, so you decide when a friend can see your progress.
>
> SEE WHAT’S STICKING
> Explore your review history, recent patterns, and cards that keep needing attention. Recall insights reflect the ratings you give yourself.
>
> Made for the curious. For the good bits worth keeping.
>
> Recollect uses Sign in with Apple. An internet connection is needed for sign-in, AI generation, synchronization, and sharing. AI suggestions can be inaccurate; review them before saving or sharing.

Keywords draft (100 bytes maximum; recheck ASC validation):

> flashcards,spaced repetition,study,learning,recall,vocabulary,practice,decks,memory

Copyright: `2026 Collect Software`, using the publisher name the owner confirmed.

What’s New draft for the release that includes the verified final implementation:

> A fresh look for your learning, easier deck creation, and smoother card practice. Invite friends, share decks, and explore detailed recall history with separate progress-sharing controls. Manage AI sharing permission, report or block a connection, and request account deletion from You.

Use this copy only for the binary or compatible update that includes these controls. Select that build in App Store Connect before submitting the version.

## Implemented behavior described by the public pages

- **AI:** explicit Anthropic permission is stored per signed-in owner and device before new generation or a retry. You can revoke it in You. Prompts include the selected topic/question and, for existing-deck expansion, up to 40 card questions. Requests already sent cannot be recalled.
- **Account deletion:** You provides an export option, typed `DELETE` confirmation, and fresh Apple verification. An accepted receipt disables access and starts owner-scoped local-library/profile-cache/widget cleanup. Unconfirmed transport outcomes keep a durable recovery gate. Pending server deletion is distinct from complete erasure and waits for Apple revocation plus owned-record removal. Estimated days appear only when the operator configures them.
- **Deletion limits:** recipients’ independent accepted copies can remain. Saved exports and original unbound native recovery stores are outside the current signed-in library cleanup. A minimal account-deletion receipt with hashed Apple identity and request/status references remains to prevent resurrection and recognize retries. Public pages do not promise erasure of all provider backups or a fixed retention period.
- **Community safety:** reporting and blocking appear on the friend page; reports are private operator-queue records. Blocking revokes friendship, shares, and progress access. Unblocking does not restore permissions. Conservative server text checks apply to some material before public sharing; they are not comprehensive moderation or image classification.

## Screenshots and existing assets

The original icon remains byte-for-byte identical at these paths:

- `apps/mobile/assets/icon.png`
- `apps/landing/assets/app-icon.png`
- `cognition.curator/cognition.curator/Assets.xcassets/AppIcon.appiconset/asset (1).png`

Each is 1024 × 1024, SHA-256 `ff2e4ddc979b77df3d4147045afddc2b6d7b9206c15fc08701391b02943b07e3`.

No App Store screenshot set or metadata package is checked into this repository. Previous Codex design proofs are browser-sized JPEGs, even where named `.png`, at 390 × 844 or 375 × 667. They are not proof of native-device behavior and are not ready for App Store upload. Preserve any existing approved App Store artwork and reuse appropriate existing screenshots when they still show the submitted app accurately.

Apple’s current [screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications) require at least one supported iPhone screenshot and an iPad 13-inch screenshot when the app supports iPad. The Expo config currently sets `supportsTablet: true`.

- Accepted current iPhone portrait examples: 1179 × 2556 or 1206 × 2622. Confirm the exact device slot offered by App Store Connect before capture.
- Accepted iPad 13-inch portrait examples: 2064 × 2752 or 2048 × 2732.
- JPEG or PNG, no alpha/transparency, 1–10 screenshots per supported device slot/localization.
- Capture the actual app at the accepted resolution. Do not stretch a small web preview and present it as native proof.

Suggested subjects: Today/library, a deck with concise cards and Add/Generate actions, a review card, personal progress, and shared-deck controls. Use demo learning content and fictional profiles; avoid real emails, private deck contents, and private invite codes.

## App Review notes draft

> Recollect is an iPhone/iPad learning app using Sign in with Apple. Reviewers can sign in with their own Apple account; production email/password or development sign-in is not exposed.
>
> Basic flow: create a deck, add a card manually or choose Generate, review the suggested cards before accepting, then practice from Today or the deck. Tap a review card to reveal it; right swipe means remembered and left swipe means not sure. Ratings affect the next review and are self-reported rather than scored answers.
>
> Friends is available from You. Invitations require explicit acceptance. Sharing a deck gives the recipient a copy. Detailed progress sharing is a separate opt-in for each participant. Open a friend’s page to report or block them; blocked people can be managed in Friends. Reports are stored in a private operator queue.
>
> In You, AI sharing permission can be granted or revoked. Before a new generation or retry, the app checks permission for that account and device to send the question/topic and any included existing-card context to Anthropic. Previously sent requests cannot be recalled.
>
> Account deletion is in You → Delete account. It offers an export first, asks the user to type DELETE, and requires fresh Sign in with Apple confirmation. The app displays whether the accepted deletion request is pending or complete and provides a recovery/status flow for connection interruptions. Local account data and widget content are cleared after acceptance; permanent server deletion waits for Apple revocation and owned-record erasure. Independent recipient deck copies and previously saved exports remain separate.
>
> Internet access is required for Apple sign-in, generation, synchronization, and sharing. Saved cards and reviews work offline. AI generation uses Anthropic through the Recollect API.

Provide the verified review contact name, phone, and email in the private App Review fields. Confirm how Apple wants to review the Apple-only sign-in flow; do not fabricate a demo username/password or enable production development authentication for reviewers.

## App Privacy preparation

Do not select “Data Not Collected.” The account backend stores account identifiers, email/name, optional profile photo, learning content, review history, synchronization records, and community permissions. AI generation sends user-provided prompts and, where applicable, existing card questions to Anthropic. Netlify processes website form submissions; server and delivery systems handle diagnostics.

Select App Store Connect data categories and purposes only after comparing the completed code and provider configuration against Apple’s definitions. Do not infer “tracking” solely from ordinary service diagnostics, and do not claim zero collection because the mobile dependency list has no advertising SDK.

Official references:

- [Required platform version information, support contact, and review notes](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information/)
- [App privacy declarations and privacy policy URL](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy)
- [Account deletion requirements, including Sign in with Apple](https://developer.apple.com/support/offering-account-deletion-in-your-app/)
- [Screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications)
