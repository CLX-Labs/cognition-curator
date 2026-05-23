-- Add Stytch user ID column to the users table.
-- Nullable so existing rows (Flask apple_id users) are preserved without data loss.
-- Users will have stytch_user_id populated on first login via Stytch.

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS stytch_user_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS ix_users_stytch_user_id
    ON public.users (stytch_user_id)
    WHERE stytch_user_id IS NOT NULL;
