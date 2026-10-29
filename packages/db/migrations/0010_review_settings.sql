-- Private per-account categories and review preferences. Categories organize
-- owned decks without changing deck identities or their review histories.
CREATE TABLE recollect.review_settings (
 owner_id uuid PRIMARY KEY REFERENCES recollect.users(id) ON DELETE CASCADE,
 data jsonb NOT NULL CHECK (jsonb_typeof(data)='object')
);

ALTER TABLE recollect.changes DROP CONSTRAINT changes_entity_check;
ALTER TABLE recollect.changes ADD CONSTRAINT changes_entity_check
 CHECK (entity IN ('deck','card','review','reviewSettings'));
