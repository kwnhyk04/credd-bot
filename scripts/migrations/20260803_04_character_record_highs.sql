-- Manual deployment position 4 of Monthsary Phase 2: character record highs.
-- The backfills reconstruct the largest contiguous win run from immutable logs.
BEGIN;

ALTER TABLE public.user_character
  ADD COLUMN IF NOT EXISTS highest_raid_streak integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS highest_rank_streak integer NOT NULL DEFAULT 0;

ALTER TABLE public.user_character
  ALTER COLUMN highest_raid_streak SET DEFAULT 0,
  ALTER COLUMN highest_rank_streak SET DEFAULT 0;

UPDATE public.user_character
   SET highest_raid_streak = COALESCE(highest_raid_streak, 0),
       highest_rank_streak = COALESCE(highest_rank_streak, 0)
 WHERE highest_raid_streak IS NULL
    OR highest_rank_streak IS NULL;

ALTER TABLE public.user_character
  ALTER COLUMN highest_raid_streak SET NOT NULL,
  ALTER COLUMN highest_rank_streak SET NOT NULL;

DO $character_record_highs_constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_character_highest_raid_streak_check'
       AND conrelid = 'public.user_character'::regclass
  ) THEN
    ALTER TABLE public.user_character
      ADD CONSTRAINT user_character_highest_raid_streak_check
      CHECK (highest_raid_streak >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_character_highest_rank_streak_check'
       AND conrelid = 'public.user_character'::regclass
  ) THEN
    ALTER TABLE public.user_character
      ADD CONSTRAINT user_character_highest_rank_streak_check
      CHECK (highest_rank_streak >= 0);
  END IF;
END;
$character_record_highs_constraints$;

WITH ordered AS (
  SELECT discord_id, result,
         ROW_NUMBER() OVER (
           PARTITION BY discord_id
           ORDER BY "timestamp", id
         ) AS all_row,
         ROW_NUMBER() OVER (
           PARTITION BY discord_id, result
           ORDER BY "timestamp", id
         ) AS result_row
    FROM public.raid_logs
   WHERE battle_type = 'raid'
), win_runs AS (
  SELECT discord_id, COUNT(*)::integer AS run_length
    FROM ordered
   WHERE result = 'win'
   GROUP BY discord_id, all_row - result_row
), maxima AS (
  SELECT discord_id, MAX(run_length)::integer AS highest_raid_streak
    FROM win_runs
   GROUP BY discord_id
)
UPDATE public.user_character c
   SET highest_raid_streak = maxima.highest_raid_streak
  FROM maxima
 WHERE c.discord_id = maxima.discord_id;

WITH ordered AS (
  SELECT player_id, result,
         ROW_NUMBER() OVER (
           PARTITION BY player_id
           ORDER BY "timestamp", id
         ) AS all_row,
         ROW_NUMBER() OVER (
           PARTITION BY player_id, result
           ORDER BY "timestamp", id
         ) AS result_row
    FROM public.ranked_logs
), win_runs AS (
  SELECT player_id, COUNT(*)::integer AS run_length
    FROM ordered
   WHERE result = 'win'
   GROUP BY player_id, all_row - result_row
), maxima AS (
  SELECT player_id, MAX(run_length)::integer AS highest_rank_streak
    FROM win_runs
   GROUP BY player_id
)
UPDATE public.user_character c
   SET highest_rank_streak = maxima.highest_rank_streak
  FROM maxima
 WHERE c.discord_id = maxima.player_id;

COMMIT;
