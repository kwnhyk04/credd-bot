-- Monthsary event claim guards. These tables intentionally remain after code rollback.
BEGIN;

CREATE TABLE IF NOT EXISTS public.event_attendance (
  event_key text NOT NULL,
  user_id varchar(20) NOT NULL
    REFERENCES public.users(discord_id) ON DELETE CASCADE,
  event_day smallint NOT NULL CHECK (event_day BETWEEN 1 AND 7),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_key, user_id, event_day)
);

CREATE TABLE IF NOT EXISTS public.event_quest_claims (
  event_key text NOT NULL,
  user_id varchar(20) NOT NULL
    REFERENCES public.users(discord_id) ON DELETE CASCADE,
  event_day smallint NOT NULL CHECK (event_day BETWEEN 1 AND 7),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_key, user_id, event_day)
);

ALTER TABLE public.event_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_quest_claims ENABLE ROW LEVEL SECURITY;

COMMIT;
