-- Deliberately no FK to users: the minimal receipt/tombstone survives erasure.
CREATE TABLE recollect.account_deletion_requests (
 id uuid PRIMARY KEY,
 owner_id uuid NOT NULL UNIQUE,
 operation_id uuid NOT NULL,
 apple_subject_hash text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed')),
 requested_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz,
 estimated_completion_days integer,
 apple_token_ciphertext text,
 apple_token_kind text CHECK(apple_token_kind IN ('authorization_code','refresh_token')),
 apple_code_created_at timestamptz,
 apple_revoked_at timestamptz,
 error_code text,
 attempts integer NOT NULL DEFAULT 0,
 last_attempt_at timestamptz
);
CREATE INDEX account_deletion_subject ON recollect.account_deletion_requests(apple_subject_hash);
