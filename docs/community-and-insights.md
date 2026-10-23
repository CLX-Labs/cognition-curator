# Friends, shared decks, and recall insights

Friends is available from You and Progress. An account can create a one-use invite, share it using the phone's share sheet, or paste a received code into Friends. The existing `cognitioncurator://friends?invite=…` scheme pre-fills a code; accepting is always explicit. Invites expire after seven days. People without the app need TestFlight access first and can paste the code after installation; there is no deferred-install link service.

Deck → Share with friends creates an immutable snapshot for a chosen friend. The recipient previews the cards and chooses Add to my decks. This creates recipient-owned cards with fresh review schedules, delivered through the normal sync feed. Acceptance retries produce the same copy. Later author edits do not update the copy. Shared-deck records retain creator/source attribution and card mappings without changing existing strict deck/card sync contracts.

Publishing first synchronizes and verifies that no pending changes or conflicts remain, so a swallowed offline sync error cannot publish an older deck. If an accepted copy has not downloaded yet, the UI offers Sync to download rather than claiming it is locally available. A shared snapshot is limited to 1,000 cards with an explicit error for larger decks.

Both participants independently choose whether to share detailed recall for each accepted share. The switch defaults off and explains that enabling it exposes past and future recorded responses, answers, and timelines for those shared cards. A friend profile links to both individual-deck insights and an aggregate across the shared decks that friend has enabled. Private decks and unshared cards are never queried for this view. Personal insights remain available offline and include unsynced local reviews.

## Recall definitions

- Time windows are 7, 30, or 90 calendar days in the viewer's timezone, or all recorded history.
- `good` and `easy` count as remembered; `again` and historical `hard` count as unsure. These are self-reported recall ratings, not graded correctness.
- Repeated uncertainty means at least two unsure responses among the last three recorded responses in the selected window, with at least two responses available.
- Consistent recall means at least three trailing remembered responses within the window.
- Trends compare the selected window with the preceding equal-length calendar period. All-time uses the last 30 days versus the previous 30. Each period needs at least three responses; a change of at least ten percentage points is improving/declining, otherwise steady. Low evidence is explicitly labelled.
- Per-card history is chronological and bounded to the latest 100 events. Counts include all recorded events in scope; truncation is disclosed. Imported schedule checkpoints cannot reconstruct missing dated responses and do not become invented history.
- Practice and scheduled review responses both contribute. Duplicate event IDs/device sequences and future events are excluded by the shared analytics engine.

## Access and persistence

Migration `0003_community.sql` adds friendships, hashed single-use invites, snapshot shares, and source/copy card mappings. No legacy tables, scheduler contracts, or deployment settings change. Invite creation/acceptance is rate limited. Share creation deduplicates an operation UUID and payload hash. Share acceptance locks the friend/share and recipient sync owner, creates the whole copy, and publishes one sync revision atomically.

Shared insights require a current friendship, accepted active share, target participant, and that target's independent progress grant. Removal or revocation disables future access; already imported copies remain personal library content. A read holds the relevant locks through its scoped snapshot. New private edits, deck renames, unrelated cards added after sharing, and cards moved out of their shared deck cannot leak through insights. Cards edited or moved since sharing are excluded, even if later reverted; shared labels remain frozen to the published snapshot. A new share can explicitly publish an updated version.

Friend data is fetched on focus/manual refresh, with no polling loop. Responses and errors are gated by account, scope, and range so stale requests cannot replace another account's view. Shared recall is cleared on blur and is not persisted in the offline library. Turning off sharing prevents later reads; it cannot retract information someone already saw.

## API surface

- `GET /v1/community`
- `POST /v1/community/invites`, `POST /v1/community/invites/accept`
- `DELETE /v1/community/friends/:id`
- `POST /v1/community/shares`, `GET /v1/community/shares/:id`
- `POST /v1/community/shares/:id/accept`
- `PATCH /v1/community/shares/:id/progress`, `DELETE /v1/community/shares/:id`
- `GET /v1/insights?days=30&timezone=…&deckId=…&cardId=…`
- `GET /v1/community/shares/:id/insights/:userId?days=30&timezone=…&cardId=…`
- `GET /v1/community/friends/:id/insights?days=30&timezone=…&cardId=…`

The API automatically applies the additive migration in the existing Railway pre-deploy step. The `feature/community-insights` branch selects a major native TestFlight release under the existing release policy; no new native packages are required.
