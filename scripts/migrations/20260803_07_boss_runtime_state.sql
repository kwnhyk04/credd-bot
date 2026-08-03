-- Manual deployment position 4c of Monthsary Phase 2: durable calamity runtime state.
BEGIN;

ALTER TABLE public.boss_state
  ADD COLUMN IF NOT EXISTS last_attack_at timestamptz DEFAULT NULL;
ALTER TABLE public.boss_state
  ADD COLUMN IF NOT EXISTS passive_state jsonb DEFAULT '{}'::jsonb;

UPDATE public.boss_state
   SET last_attack_at = COALESCE(last_attack_at, spawn_at)
 WHERE last_attack_at IS NULL;

COMMIT;
