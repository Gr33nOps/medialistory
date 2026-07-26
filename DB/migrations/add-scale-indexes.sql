-- Indexes for common lookup paths (safe to re-run).

CREATE INDEX IF NOT EXISTS idx_user_follows_follower
  ON public.user_follows (follower_id);

CREATE INDEX IF NOT EXISTS idx_user_follows_following
  ON public.user_follows (following_id);

CREATE INDEX IF NOT EXISTS idx_games_igdb_id
  ON public.games (igdb_id);

CREATE INDEX IF NOT EXISTS idx_ugl_user_status
  ON public.user_game_lists (user_id, status);

CREATE INDEX IF NOT EXISTS idx_custom_lists_user_slug
  ON public.custom_lists (user_id, slug);

CREATE INDEX IF NOT EXISTS idx_users_username_lower
  ON public.users (LOWER(username));

CREATE INDEX IF NOT EXISTS idx_mod_activity_created
  ON public.moderator_activity (created_at DESC);
