-- Friendships and snapshot shares are separate from each account's private library.
CREATE TABLE recollect.friendships (
 user_a uuid NOT NULL REFERENCES recollect.users(id),
 user_b uuid NOT NULL REFERENCES recollect.users(id),
 connected_at timestamptz NOT NULL DEFAULT now(),
 active boolean NOT NULL DEFAULT true,
 PRIMARY KEY(user_a,user_b), CHECK(user_a < user_b)
);
CREATE INDEX friendships_recipient ON recollect.friendships(user_b) WHERE active;
CREATE TABLE recollect.friend_invites (
 id uuid PRIMARY KEY,
 owner_id uuid NOT NULL REFERENCES recollect.users(id),
 code_hash text NOT NULL UNIQUE,
 expires_at timestamptz NOT NULL,
 consumed_by uuid REFERENCES recollect.users(id),
 consumed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE recollect.deck_shares (
 id uuid PRIMARY KEY,
 sender_id uuid NOT NULL REFERENCES recollect.users(id),
 recipient_id uuid NOT NULL REFERENCES recollect.users(id),
 operation_id uuid NOT NULL,
 payload_hash text NOT NULL,
 source_deck_id uuid NOT NULL,
 snapshot jsonb NOT NULL,
 source_revision bigint NOT NULL,
 recipient_deck_id uuid,
 recipient_revision bigint,
 sender_shares_progress boolean NOT NULL DEFAULT false,
 recipient_shares_progress boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 accepted_at timestamptz,
 revoked_at timestamptz,
 UNIQUE(sender_id,operation_id), CHECK(sender_id <> recipient_id)
);
CREATE INDEX deck_shares_participants ON recollect.deck_shares(sender_id,recipient_id) WHERE revoked_at IS NULL;
CREATE TABLE recollect.shared_card_mappings (
 share_id uuid NOT NULL REFERENCES recollect.deck_shares(id) ON DELETE CASCADE,
 source_card_id uuid NOT NULL,
 recipient_card_id uuid NOT NULL,
 content_hash text NOT NULL,
 PRIMARY KEY(share_id,source_card_id), UNIQUE(share_id,recipient_card_id)
);
