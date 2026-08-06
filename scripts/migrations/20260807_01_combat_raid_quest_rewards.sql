-- Combat / raid / quest reward updates.
-- Additive and rerunnable. Daily keys use the existing Asia/Manila reset cycle.

CREATE TABLE IF NOT EXISTS public.raid_reward_daily_totals (
    discord_id     varchar(20) NOT NULL REFERENCES public.users(discord_id) ON DELETE CASCADE,
    reward_date    date NOT NULL,
    silver_chests  integer NOT NULL DEFAULT 0,
    gold_chests    integer NOT NULL DEFAULT 0,
    belief_shards  integer NOT NULL DEFAULT 0,
    CONSTRAINT raid_reward_daily_totals_pkey PRIMARY KEY (discord_id, reward_date),
    CONSTRAINT raid_reward_daily_totals_silver_check CHECK (silver_chests >= 0 AND silver_chests <= 20),
    CONSTRAINT raid_reward_daily_totals_gold_check CHECK (gold_chests >= 0 AND gold_chests <= 10),
    CONSTRAINT raid_reward_daily_totals_shards_check CHECK (belief_shards >= 0 AND belief_shards <= 10000)
);

CREATE INDEX IF NOT EXISTS idx_raid_reward_daily_totals_date
    ON public.raid_reward_daily_totals (reward_date);

ALTER TABLE public.raid_reward_daily_totals ENABLE ROW LEVEL SECURITY;

-- Regular raid reward commits use active_battles.battle_id as their idempotency key.
-- The payload makes a post-commit retry return the original result without paying twice.
CREATE TABLE IF NOT EXISTS public.raid_reward_grants (
    reward_key   varchar(100) PRIMARY KEY,
    discord_id   varchar(20) NOT NULL REFERENCES public.users(discord_id) ON DELETE CASCADE,
    reward       jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_raid_reward_grants_discord_id
    ON public.raid_reward_grants (discord_id);

ALTER TABLE public.raid_reward_grants ENABLE ROW LEVEL SECURITY;

-- Durable delivery guard shared by normal, Sacred Relic, and Supreme Relic
-- summons. It is claimed and committed in the same transaction as the spend
-- and rewards, so duplicate Discord deliveries cannot pay twice.
CREATE TABLE IF NOT EXISTS public.summon_reward_grants (
    reward_key   varchar(100) PRIMARY KEY,
    discord_id   varchar(20) NOT NULL REFERENCES public.users(discord_id) ON DELETE CASCADE,
    source       varchar(30) NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT summon_reward_grants_source_check
      CHECK (source IN ('belief_shards', 'sacred_relic', 'supreme_relic'))
);

CREATE INDEX IF NOT EXISTS idx_summon_reward_grants_discord_id
    ON public.summon_reward_grants (discord_id);

ALTER TABLE public.summon_reward_grants ENABLE ROW LEVEL SECURITY;

-- One persisted guard per user and PHT daily quest cycle. The row is inserted and
-- Sacred Relic credited in the same quest transaction.
CREATE TABLE IF NOT EXISTS public.daily_quest_completion_rewards (
    discord_id   varchar(20) NOT NULL REFERENCES public.users(discord_id) ON DELETE CASCADE,
    quest_date   date NOT NULL,
    sacred_relics integer NOT NULL DEFAULT 1,
    claimed_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT daily_quest_completion_rewards_pkey PRIMARY KEY (discord_id, quest_date),
    CONSTRAINT daily_quest_completion_rewards_relic_check CHECK (sacred_relics = 1)
);

CREATE INDEX IF NOT EXISTS idx_daily_quest_completion_rewards_date
    ON public.daily_quest_completion_rewards (quest_date);

ALTER TABLE public.daily_quest_completion_rewards ENABLE ROW LEVEL SECURITY;
