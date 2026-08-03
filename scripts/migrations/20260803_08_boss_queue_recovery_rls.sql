-- Manual deployment position 8 of Monthsary Phase 2: queue claim recovery and RLS repair.
-- Safe for databases where 20260803_03 already ran before these guarantees were recorded.
BEGIN;

ALTER TABLE public.boss_spawn_queue
  ADD COLUMN IF NOT EXISTS claim_started_at timestamptz;

ALTER TABLE public.boss_spawn_queue ENABLE ROW LEVEL SECURITY;

COMMIT;
