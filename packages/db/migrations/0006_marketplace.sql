-- Public marketplace snapshots never expose a publisher's live private library.
CREATE TABLE recollect.marketplace_listings (
 id uuid PRIMARY KEY,
 owner_id uuid NOT NULL REFERENCES recollect.users(id) ON DELETE CASCADE,
 source_deck_id uuid NOT NULL,
 version integer NOT NULL CHECK(version > 0),
 snapshot jsonb NOT NULL,
 is_published boolean NOT NULL DEFAULT true,
 show_download_count boolean NOT NULL DEFAULT false,
 show_usage_stats boolean NOT NULL DEFAULT false,
 published_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,source_deck_id)
);
CREATE INDEX marketplace_catalog ON recollect.marketplace_listings(published_at DESC,id DESC) WHERE is_published;
CREATE TABLE recollect.marketplace_versions (
 listing_id uuid NOT NULL REFERENCES recollect.marketplace_listings(id) ON DELETE CASCADE,
 version integer NOT NULL,
 snapshot jsonb NOT NULL,
 source_revision bigint NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(listing_id,version)
);
CREATE TABLE recollect.marketplace_publish_operations (
 owner_id uuid NOT NULL REFERENCES recollect.users(id) ON DELETE CASCADE,
 operation_id uuid NOT NULL,
 listing_id uuid NOT NULL REFERENCES recollect.marketplace_listings(id) ON DELETE CASCADE,
 version integer NOT NULL,
 payload_hash text NOT NULL,
 rights_policy_version integer NOT NULL DEFAULT 1,
 accepted_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(owner_id,operation_id)
);
-- Unique receipts are technical retry/provenance records, not permission to expose identities.
-- They deliberately survive a recipient deleting their independent copy.
CREATE TABLE recollect.marketplace_downloads (
 id uuid PRIMARY KEY,
 listing_id uuid NOT NULL REFERENCES recollect.marketplace_listings(id) ON DELETE CASCADE,
 recipient_id uuid NOT NULL REFERENCES recollect.users(id) ON DELETE CASCADE,
 recipient_deck_id uuid NOT NULL,
 version integer NOT NULL,
 recipient_revision bigint NOT NULL,
 consent_since timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(recipient_id,listing_id)
);
CREATE INDEX marketplace_download_listing ON recollect.marketplace_downloads(listing_id);
CREATE TABLE recollect.marketplace_card_mappings (
 download_id uuid NOT NULL REFERENCES recollect.marketplace_downloads(id) ON DELETE CASCADE,
 source_card_id uuid NOT NULL,
 recipient_card_id uuid NOT NULL,
 content_hash text NOT NULL,
 content jsonb NOT NULL,
 PRIMARY KEY(download_id,source_card_id),
 UNIQUE(download_id,recipient_card_id)
);
CREATE TABLE recollect.marketplace_reports (
 id uuid PRIMARY KEY,
 listing_id uuid NOT NULL REFERENCES recollect.marketplace_listings(id) ON DELETE CASCADE,
 reporter_id uuid NOT NULL REFERENCES recollect.users(id) ON DELETE CASCADE,
 target_user_id uuid NOT NULL REFERENCES recollect.users(id) ON DELETE CASCADE,
 version integer NOT NULL,
 reason text NOT NULL CHECK(reason IN ('inappropriate','harassment','spam','other')),
 details text NOT NULL DEFAULT '',
 evidence jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 resolved_at timestamptz
);
