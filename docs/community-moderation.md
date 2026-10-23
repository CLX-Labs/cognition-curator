# Community report review

Collect Software operates Recollect. The public support address is `collectsoftwarev2@gmail.com`; the website also provides `https://recollect-ai.netlify.app/support/`. App reports go to a private database queue. There is no public report-reading endpoint, moderator dashboard, automatic email notification, or configured response SLA.

## Queue and access

Migration `packages/db/migrations/0005_community_safety.sql` creates `recollect.content_reports` in the same PostgreSQL database as the Recollect API. Only an authorized operator with appropriate database access should read it. Keep report details and evidence out of public issues, analytics, shared screenshots, and routine deployment logs.

The authenticated application endpoint `POST /v1/community/reports` accepts a known connection’s user ID, optional participant-scoped share ID, reason (`inappropriate`, `harassment`, `spam`, or `other`), and optional details. It returns only the report ID and creation time. Where a share is identified, the server records the authorized share snapshot as evidence. Reporting does not block the user or change their content automatically.

Queue fields are `id`, `reporter_id`, `target_user_id`, `share_id`, `reason`, `details`, `evidence`, `created_at`, and `resolved_at`. `evidence` is a private JSON snapshot, not executable instructions. Reports may be removed when an associated account is erased; this queue is not a permanent legal archive.

## Review workflow

1. Open the verified production database through the existing authorized operator connection. List unresolved reports with a bounded query:

   ```sql
   SELECT id, created_at, reason, reporter_id, target_user_id, share_id
   FROM recollect.content_reports
   WHERE resolved_at IS NULL
   ORDER BY created_at, id
   LIMIT 50;
   ```

2. Inspect only the selected report’s detail and evidence. Pass its UUID as a bound parameter; do not paste untrusted report text into SQL:

   ```sql
   SELECT id, created_at, reporter_id, target_user_id, share_id,
          reason, details, evidence
   FROM recollect.content_reports
   WHERE id = $1::uuid AND resolved_at IS NULL;
   ```

3. Compare the evidence with the [public community guidelines](https://recollect-ai.netlify.app/community-guidelines/). A report is an allegation: confirm who shared the identified material and what the evidence actually shows. Read only account or sharing records needed to assess this concern; do not browse the reporter’s or target’s private libraries.

4. Decide and record any necessary operational action in the team’s private support record. Existing in-app blocking removes the connection and revokes shared access; independent imported copies are not recalled. Resolving a report does not itself block an account, remove content, send a notification, or establish that a violation occurred. Any service-side restriction requires a deliberate operator action using the actual available service controls.

5. Once review and any required action are finished, mark the selected report resolved:

   ```sql
   UPDATE recollect.content_reports
   SET resolved_at = now()
   WHERE id = $1::uuid AND resolved_at IS NULL
   RETURNING id, resolved_at;
   ```

   Keep the returned timestamp as the confirmation. If no row is returned, check whether it was already resolved or removed; do not mark an unrelated report.

## Support follow-up

Users can contact `collectsoftwarev2@gmail.com` or submit the support form for help and identify their report or deletion request reference. Netlify submissions are reviewed in the existing `recollect-ai` project under Forms → `recollect-support`. The form does not automatically attach an app account or report record; verify the requester’s relationship before disclosing private account information. Do not disclose another person’s report details or private content in a reply.

This runbook does not create automatic notifications or promise a response deadline. Regular queue review is an operator responsibility. Requests involving immediate danger should be directed to appropriate emergency services; the app’s report queue is not an emergency service.
