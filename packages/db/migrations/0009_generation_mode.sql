-- Snapshot enforcement on each request. Legacy jobs remain free when rollout is enabled,
-- while an enabled request retains its hold/capture rules if the rollout is later paused.
ALTER TABLE recollect.generation_jobs
 ADD COLUMN mode text NOT NULL DEFAULT 'cards' CHECK(mode IN ('cards','answer')),
 ADD COLUMN token_required boolean NOT NULL DEFAULT false;

CREATE TABLE recollect.generation_cancellations (
 owner_id uuid NOT NULL REFERENCES recollect.users(id) ON DELETE CASCADE,
 operation_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(owner_id,operation_id)
);
