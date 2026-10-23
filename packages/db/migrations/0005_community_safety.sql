CREATE TABLE recollect.user_blocks (
 blocker_id uuid NOT NULL REFERENCES recollect.users(id) ON DELETE CASCADE,
 blocked_id uuid NOT NULL REFERENCES recollect.users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(blocker_id,blocked_id), CHECK(blocker_id <> blocked_id)
);
CREATE INDEX user_blocks_recipient ON recollect.user_blocks(blocked_id);
CREATE TABLE recollect.content_reports (
 id uuid PRIMARY KEY,
 reporter_id uuid NOT NULL REFERENCES recollect.users(id) ON DELETE CASCADE,
 target_user_id uuid NOT NULL REFERENCES recollect.users(id) ON DELETE CASCADE,
 share_id uuid,
 reason text NOT NULL CHECK(reason IN ('inappropriate','harassment','spam','other')),
 details text NOT NULL DEFAULT '',
 evidence jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 resolved_at timestamptz,
 CHECK(reporter_id <> target_user_id)
);
CREATE INDEX content_reports_pending ON recollect.content_reports(created_at) WHERE resolved_at IS NULL;
