-- Server-owned generation credits. Free grants expire at the next UTC month;
-- purchased and Marketplace grants never expire. Account deletion erases these
-- private records through the owner FK, without changing another user's grant.
CREATE TABLE recollect.token_subscription_owners (
 original_transaction_id text PRIMARY KEY,
 owner_id uuid NOT NULL REFERENCES recollect.users(id) ON DELETE CASCADE,
 UNIQUE(owner_id,original_transaction_id)
);
CREATE TABLE recollect.token_purchases (
 transaction_id text PRIMARY KEY,
 owner_id uuid NOT NULL REFERENCES recollect.users(id) ON DELETE CASCADE,
 original_transaction_id text NOT NULL,
 product_id text NOT NULL,
 environment text NOT NULL,
 purchased_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL,
 signed_at timestamptz NOT NULL,
 revoked_at timestamptz,
 -- Signed notification time orders refund/reversal state independently from
 -- transaction metadata. A non-null clock with no revocation is a reversal
 -- tombstone, so old refunded transaction/notification replays cannot undo it.
 refund_event_at timestamptz,
 FOREIGN KEY(owner_id,original_transaction_id)
   REFERENCES recollect.token_subscription_owners(owner_id,original_transaction_id) ON DELETE CASCADE,
 CHECK(expires_at > purchased_at)
);
CREATE INDEX token_purchases_owner_expiry ON recollect.token_purchases(owner_id,expires_at DESC);
CREATE TABLE recollect.token_grants (
 id uuid PRIMARY KEY,
 owner_id uuid NOT NULL REFERENCES recollect.users(id) ON DELETE CASCADE,
 source text NOT NULL CHECK(source IN ('free','paid','earned')),
 grant_key text NOT NULL UNIQUE,
 amount integer NOT NULL CHECK(amount > 0),
 consumed integer NOT NULL DEFAULT 0 CHECK(consumed >= 0 AND consumed <= amount),
 expires_at timestamptz,
 revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,id),
 CHECK(source='free' OR expires_at IS NULL)
);
CREATE INDEX token_grants_owner ON recollect.token_grants(owner_id);
ALTER TABLE recollect.generation_jobs ADD CONSTRAINT generation_jobs_owner_id_id_key UNIQUE(owner_id,id);
CREATE TABLE recollect.token_generation_holds (
 job_id uuid PRIMARY KEY,
 owner_id uuid NOT NULL REFERENCES recollect.users(id) ON DELETE CASCADE,
 grant_id uuid NOT NULL,
 state text NOT NULL CHECK(state IN ('reserved','captured','released')),
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(owner_id,job_id) REFERENCES recollect.generation_jobs(owner_id,id) ON DELETE CASCADE,
 FOREIGN KEY(owner_id,grant_id) REFERENCES recollect.token_grants(owner_id,id) ON DELETE CASCADE
);
CREATE INDEX token_holds_grant ON recollect.token_generation_holds(grant_id) WHERE state='reserved';
-- Deliberately no listing/download FK: removing and republishing a listing, or
-- deleting an independent downloaded copy, must never mint another reward.
CREATE TABLE recollect.token_marketplace_rewards (
 publisher_id uuid NOT NULL REFERENCES recollect.users(id) ON DELETE CASCADE,
 recipient_id uuid NOT NULL REFERENCES recollect.users(id) ON DELETE CASCADE,
 source_deck_id uuid NOT NULL,
 listing_id uuid NOT NULL,
 download_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(publisher_id,recipient_id,source_deck_id),
 CHECK(publisher_id <> recipient_id)
);
