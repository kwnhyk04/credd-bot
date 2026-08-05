-- Add durable idempotency keys for bulk essence modals and completed duels.
-- Existing quest rows and pvp log rows are preserved unchanged.
BEGIN;

ALTER TABLE public.pvp_logs
  ADD COLUMN IF NOT EXISTS duel_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS pvp_logs_duel_id_key
  ON public.pvp_logs (duel_id);

CREATE TABLE IF NOT EXISTS public.essence_exchange_submissions (
    submission_id character varying(64) PRIMARY KEY,
    discord_id   character varying(20) NOT NULL,
    created_at   timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS essence_exchange_submissions_created_at_idx
  ON public.essence_exchange_submissions (created_at);

ALTER TABLE public.essence_exchange_submissions ENABLE ROW LEVEL SECURITY;

COMMIT;
