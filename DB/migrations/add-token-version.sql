-- Bump this on password change to invalidate existing JWTs.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
