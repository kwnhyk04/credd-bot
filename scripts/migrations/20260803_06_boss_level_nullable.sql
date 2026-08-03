-- Manual deployment position 4b of Monthsary Phase 2: level removal compatibility.
BEGIN;
ALTER TABLE public.boss_state ALTER COLUMN boss_level DROP NOT NULL;
ALTER TABLE public.active_battles ALTER COLUMN enemy_level DROP NOT NULL;
COMMIT;
