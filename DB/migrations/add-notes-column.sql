-- Export endpoint selects ugl.notes
ALTER TABLE public.user_game_lists
  ADD COLUMN IF NOT EXISTS notes TEXT;
