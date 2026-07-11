-- Ascension progression introduced by f6f1b1c.
-- Safe to rerun: existing deity rows begin at zero Sigils and are not Ascended.
ALTER TABLE public.user_deities
  ADD COLUMN IF NOT EXISTS sigils SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ascended BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'user_deities_sigils_check'
       AND conrelid = 'public.user_deities'::regclass
  ) THEN
    ALTER TABLE public.user_deities
      ADD CONSTRAINT user_deities_sigils_check CHECK (sigils BETWEEN 0 AND 10);
  END IF;
END $$;
