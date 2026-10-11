-- Additive schema only. Run explicitly against a reviewed staging/production target.
CREATE SCHEMA IF NOT EXISTS recollect;
CREATE TABLE IF NOT EXISTS recollect.schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE recollect.users (
 id uuid PRIMARY KEY, apple_id text UNIQUE, email text, name text NOT NULL,
 is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE recollect.auth_challenges (
 id uuid PRIMARY KEY, nonce_hash text NOT NULL, expires_at timestamptz NOT NULL, consumed_at timestamptz
);
CREATE TABLE recollect.session_families (id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES recollect.users(id), revoked_at timestamptz, authenticated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE recollect.sessions (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES recollect.users(id), family_id uuid NOT NULL REFERENCES recollect.session_families(id),
 token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, used_at timestamptz,
 revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_family ON recollect.sessions(family_id);
CREATE TABLE recollect.rate_buckets (scope text NOT NULL, bucket bigint NOT NULL, count integer NOT NULL, PRIMARY KEY(scope,bucket));
CREATE TABLE recollect.sync_heads (owner_id uuid PRIMARY KEY REFERENCES recollect.users(id), revision bigint NOT NULL DEFAULT 0);
CREATE TABLE recollect.decks (
 owner_id uuid NOT NULL REFERENCES recollect.users(id), id uuid NOT NULL,
 data jsonb NOT NULL, PRIMARY KEY(owner_id,id), UNIQUE(id)
);
CREATE TABLE recollect.cards (
 owner_id uuid NOT NULL, id uuid NOT NULL, deck_id uuid NOT NULL,
 data jsonb NOT NULL, checkpoint jsonb NOT NULL, checkpoint_at timestamptz NOT NULL,
 PRIMARY KEY(owner_id,id), UNIQUE(id), FOREIGN KEY(owner_id,deck_id) REFERENCES recollect.decks(owner_id,id)
);
CREATE INDEX cards_owner_deck ON recollect.cards(owner_id,deck_id);
CREATE TABLE recollect.review_events (
 owner_id uuid NOT NULL, id uuid NOT NULL, card_id uuid NOT NULL, device_id text NOT NULL,
 device_sequence bigint NOT NULL, reviewed_at timestamptz NOT NULL, payload_hash text NOT NULL,
 data jsonb NOT NULL, received_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(owner_id,id),
 UNIQUE(owner_id,device_id,device_sequence), FOREIGN KEY(owner_id,card_id) REFERENCES recollect.cards(owner_id,id)
);
CREATE INDEX review_replay ON recollect.review_events(owner_id,card_id,reviewed_at);
CREATE TABLE recollect.operation_receipts (
 owner_id uuid NOT NULL REFERENCES recollect.users(id), operation_id uuid NOT NULL, payload_hash text NOT NULL,
 result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(owner_id,operation_id)
);
CREATE TABLE recollect.changes (
 owner_id uuid NOT NULL REFERENCES recollect.users(id), revision bigint NOT NULL, ordinal integer NOT NULL,
 entity text NOT NULL CHECK(entity IN ('deck','card','review')), data jsonb NOT NULL,
 PRIMARY KEY(owner_id,revision,ordinal)
);
CREATE TABLE recollect.generation_jobs (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL, deck_id uuid NOT NULL,
 operation_id uuid NOT NULL, payload_hash text NOT NULL, prompt text NOT NULL,
 card_count integer NOT NULL CHECK(card_count BETWEEN 1 AND 30),
 status text NOT NULL CHECK(status IN ('queued','running','succeeded','failed','canceled')),
 attempt integer NOT NULL DEFAULT 0, fence uuid, lease_until timestamptz,
 candidates jsonb NOT NULL DEFAULT '[]', accepted_candidate_ids jsonb NOT NULL DEFAULT '[]',
 error jsonb, usage jsonb, dispatched_at timestamptz, available_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,operation_id), FOREIGN KEY(owner_id,deck_id) REFERENCES recollect.decks(owner_id,id)
);
CREATE INDEX generation_dispatch ON recollect.generation_jobs(status,dispatched_at);
CREATE TABLE recollect.quota_buckets (
 owner_id uuid NOT NULL REFERENCES recollect.users(id), quota_date date NOT NULL, reserved integer NOT NULL DEFAULT 0,
 PRIMARY KEY(owner_id,quota_date)
);
CREATE TABLE recollect.acceptance_receipts (
 owner_id uuid NOT NULL, operation_id uuid NOT NULL, payload_hash text NOT NULL, result jsonb NOT NULL,
 PRIMARY KEY(owner_id,operation_id)
);
CREATE TABLE recollect.import_batches (
 owner_id uuid NOT NULL REFERENCES recollect.users(id), batch_id uuid NOT NULL, payload_hash text NOT NULL,
 source text NOT NULL, manifest jsonb NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(owner_id,batch_id)
);
CREATE TABLE recollect.legacy_archives (
 owner_id uuid NOT NULL REFERENCES recollect.users(id), source_type text NOT NULL, source_id text NOT NULL,
 data jsonb NOT NULL, PRIMARY KEY(owner_id,source_type,source_id)
);
