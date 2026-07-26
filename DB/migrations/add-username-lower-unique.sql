-- Case-insensitive username uniqueness (run once on Supabase).
-- Requires no conflicting usernames that differ only by case.

CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_uidx
  ON public.users (LOWER(username));
