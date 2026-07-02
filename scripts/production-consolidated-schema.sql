-- Credd production consolidated schema
-- Generated from the configured PostgreSQL database schema.
-- Includes public tables, sequences, constraints, and non-constraint indexes.
-- Does not include row data, seed data, destructive migrations, or runtime commands.
-- Review before running on production.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Sequences
CREATE SEQUENCE IF NOT EXISTS public."active_battles_battle_id_seq";
CREATE SEQUENCE IF NOT EXISTS public."armor_roster_armor_roster_id_seq";
CREATE SEQUENCE IF NOT EXISTS public."boss_attack_log_id_seq";
CREATE SEQUENCE IF NOT EXISTS public."casino_logs_id_seq";
CREATE SEQUENCE IF NOT EXISTS public."cosmetic_catalog_cosmetic_id_seq";
CREATE SEQUENCE IF NOT EXISTS public."daily_quests_id_seq";
CREATE SEQUENCE IF NOT EXISTS public."deity_roster_deity_id_seq";
CREATE SEQUENCE IF NOT EXISTS public."dev_logs_id_seq";
CREATE SEQUENCE IF NOT EXISTS public."game_logs_id_seq";
CREATE SEQUENCE IF NOT EXISTS public."mob_roster_mob_id_seq";
CREATE SEQUENCE IF NOT EXISTS public."pvp_logs_id_seq";
CREATE SEQUENCE IF NOT EXISTS public."raid_logs_id_seq";
CREATE SEQUENCE IF NOT EXISTS public."ranked_logs_id_seq";
CREATE SEQUENCE IF NOT EXISTS public."rune_roster_rune_id_seq";
CREATE SEQUENCE IF NOT EXISTS public."seasons_season_id_seq";
CREATE SEQUENCE IF NOT EXISTS public."supporter_founder_number_seq";
CREATE SEQUENCE IF NOT EXISTS public."supporter_grants_id_seq";
CREATE SEQUENCE IF NOT EXISTS public."supporter_token_ledger_entry_id_seq";
CREATE SEQUENCE IF NOT EXISTS public."title_catalog_title_id_seq";
CREATE SEQUENCE IF NOT EXISTS public."user_deities_user_deity_id_seq";
CREATE SEQUENCE IF NOT EXISTS public."wager_logs_id_seq";
CREATE SEQUENCE IF NOT EXISTS public."weapon_roster_weapon_roster_id_seq";
CREATE SEQUENCE IF NOT EXISTS public."weekly_quests_id_seq";

-- Tables
CREATE TABLE IF NOT EXISTS public."active_battles" (
    "battle_id" integer DEFAULT nextval('active_battles_battle_id_seq'::regclass) NOT NULL,
    "discord_id" character varying(20) NOT NULL,
    "channel_id" character varying(20) NOT NULL,
    "message_id" character varying(20) NOT NULL,
    "battle_type" character varying(10) NOT NULL,
    "mob_id" integer NOT NULL,
    "enemy_level" smallint NOT NULL,
    "player_hp" integer NOT NULL,
    "player_max_hp" integer NOT NULL,
    "enemy_hp" integer NOT NULL,
    "enemy_max_hp" integer NOT NULL,
    "current_turn" smallint DEFAULT 1 NOT NULL,
    "player_goes_first" boolean NOT NULL,
    "active_debuffs" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "battle_log" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "overcharge_pct" smallint DEFAULT 0 NOT NULL,
    "bleed_stacks" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "started_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."active_casino_sessions" (
    "session_id" uuid NOT NULL,
    "discord_id" character varying(20) NOT NULL,
    "game" character varying(20) NOT NULL,
    "status" character varying(20) NOT NULL,
    "bet_amount" bigint NOT NULL,
    "balance_before" bigint NOT NULL,
    "balance_after_debit" bigint NOT NULL,
    "payout" bigint,
    "balance_after" bigint,
    "channel_id" character varying(20),
    "message_id" character varying(20),
    "state_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "metadata" jsonb,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL
);

CREATE TABLE IF NOT EXISTS public."active_duel_participants" (
    "discord_id" character varying(20) NOT NULL,
    "duel_id" uuid NOT NULL,
    "lock_token" uuid NOT NULL,
    "role" character varying(12) NOT NULL,
    "expires_at" timestamp with time zone NOT NULL
);

CREATE TABLE IF NOT EXISTS public."active_duels" (
    "duel_id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "lock_token" uuid NOT NULL,
    "challenger_id" character varying(20) NOT NULL,
    "opponent_id" character varying(20) NOT NULL,
    "duel_type" character varying(10) NOT NULL,
    "stake" bigint,
    "status" character varying(12) NOT NULL,
    "guild_id" character varying(20),
    "channel_id" character varying(20),
    "message_id" character varying(20),
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "accepted_at" timestamp with time zone,
    "expires_at" timestamp with time zone NOT NULL
);

CREATE TABLE IF NOT EXISTS public."active_ranked_fights" (
    "discord_id" text NOT NULL,
    "lock_token" text NOT NULL,
    "started_at" timestamp with time zone DEFAULT now() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL
);

CREATE TABLE IF NOT EXISTS public."armor_roster" (
    "armor_roster_id" integer DEFAULT nextval('armor_roster_armor_roster_id_seq'::regclass) NOT NULL,
    "name" character varying(100) NOT NULL,
    "type" character varying(10) NOT NULL,
    "tier" character varying(10) NOT NULL,
    "mythology" character varying(20) NOT NULL,
    "passive_key" character varying(50) NOT NULL,
    "passive_name" character varying(100) NOT NULL,
    "passive_description" text NOT NULL,
    "lore" text,
    "image_filename" character varying(100),
    "is_available" boolean DEFAULT true NOT NULL
);

CREATE TABLE IF NOT EXISTS public."auto_raids" (
    "discord_id" character varying(20) NOT NULL,
    "started_at" timestamp with time zone DEFAULT now() NOT NULL,
    "ends_at" timestamp with time zone NOT NULL,
    "combat_level" smallint NOT NULL
);

CREATE TABLE IF NOT EXISTS public."boss_attack_log" (
    "id" integer DEFAULT nextval('boss_attack_log_id_seq'::regclass) NOT NULL,
    "boss_spawn_id" uuid NOT NULL,
    "guild_id" character varying(20) NOT NULL,
    "discord_id" character varying(20) NOT NULL,
    "mob_id" integer NOT NULL,
    "total_damage" bigint DEFAULT 0 NOT NULL,
    "attacked_at" timestamp with time zone DEFAULT now() NOT NULL,
    "last_daily_reset" date NOT NULL
);

CREATE TABLE IF NOT EXISTS public."boss_state" (
    "guild_id" character varying(20) NOT NULL,
    "spawn_id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "mob_id" integer NOT NULL,
    "boss_level" smallint NOT NULL,
    "max_hp" bigint NOT NULL,
    "current_hp" bigint NOT NULL,
    "scaled_atk" integer NOT NULL,
    "scaled_def" integer NOT NULL,
    "spawn_at" timestamp with time zone NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "status" character varying(10) DEFAULT 'active'::character varying NOT NULL
);

CREATE TABLE IF NOT EXISTS public."casino_logs" (
    "id" bigint DEFAULT nextval('casino_logs_id_seq'::regclass) NOT NULL,
    "discord_id" character varying(20) NOT NULL,
    "game" character varying(20) NOT NULL,
    "bet_amount" bigint NOT NULL,
    "result" character varying(5) NOT NULL,
    "payout" bigint NOT NULL,
    "balance_before" bigint NOT NULL,
    "balance_after" bigint NOT NULL,
    "metadata" jsonb,
    "timestamp" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."cosmetic_catalog" (
    "cosmetic_id" integer DEFAULT nextval('cosmetic_catalog_cosmetic_id_seq'::regclass) NOT NULL,
    "cosmetic_key" character varying(80) NOT NULL,
    "category" character varying(16) NOT NULL,
    "tier" character varying(16) NOT NULL,
    "display_name" character varying(80) NOT NULL,
    "token_cost" integer DEFAULT 0 NOT NULL,
    "is_base" boolean DEFAULT false NOT NULL,
    "has_top_label" boolean DEFAULT false NOT NULL,
    "display_filename" character varying(120),
    "render_filename" character varying(120),
    "victory_filename" character varying(120),
    "defeated_filename" character varying(120),
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "skin_code" character varying(8)
);

CREATE TABLE IF NOT EXISTS public."daily_quests" (
    "id" integer DEFAULT nextval('daily_quests_id_seq'::regclass) NOT NULL,
    "discord_id" character varying(20) NOT NULL,
    "quest_type" character varying(30) NOT NULL,
    "target_count" smallint NOT NULL,
    "current_count" smallint DEFAULT 0 NOT NULL,
    "reward_credux" integer NOT NULL,
    "reward_belief_shards" smallint NOT NULL,
    "completed" boolean DEFAULT false NOT NULL,
    "quest_date" date NOT NULL
);

CREATE TABLE IF NOT EXISTS public."deity_roster" (
    "deity_id" integer DEFAULT nextval('deity_roster_deity_id_seq'::regclass) NOT NULL,
    "name" character varying(100) NOT NULL,
    "mythology" character varying(20) NOT NULL,
    "tier" character varying(10) NOT NULL,
    "base_hp" integer NOT NULL,
    "base_atk" integer NOT NULL,
    "base_def" integer NOT NULL,
    "blessing_key" character varying(50) NOT NULL,
    "blessing_name" character varying(100) NOT NULL,
    "blessing_description" text NOT NULL,
    "lore" text,
    "image_filename" character varying(100),
    "is_available" boolean DEFAULT true NOT NULL,
    "blessing_scaling" character varying(10) DEFAULT 'scalable'::character varying NOT NULL
);

CREATE TABLE IF NOT EXISTS public."dev_logs" (
    "id" bigint DEFAULT nextval('dev_logs_id_seq'::regclass) NOT NULL,
    "dev_id" character varying(20) NOT NULL,
    "action_type" character varying(30) NOT NULL,
    "target_discord_id" character varying(20) NOT NULL,
    "amount_or_detail" character varying(200),
    "pre_reset_snapshot" jsonb,
    "timestamp" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."equipped_skins" (
    "discord_id" character varying(20) NOT NULL,
    "category" character varying(16) NOT NULL,
    "cosmetic_id" integer,
    "override_path" character varying(200),
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."essence_bag_def" (
    "bag_key" character varying(20) NOT NULL,
    "open_command" character varying(10) NOT NULL,
    "essence_tier" character varying(10) NOT NULL,
    "essence_cost" integer NOT NULL,
    "credux_cost" bigint NOT NULL,
    "rune_pool" jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS public."game_logs" (
    "id" bigint DEFAULT nextval('game_logs_id_seq'::regclass) NOT NULL,
    "discord_id" character varying(20) NOT NULL,
    "action" character varying(30) NOT NULL,
    "item_type" character varying(30),
    "previous_credux" bigint,
    "updated_credux" bigint,
    "previous_belief_shards" integer,
    "updated_belief_shards" integer,
    "previous_chest_count" integer,
    "updated_chest_count" integer,
    "previous_relic_count" integer,
    "updated_relic_count" integer,
    "previous_essence_count" integer,
    "updated_essence_count" integer,
    "timestamp" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."mob_roster" (
    "mob_id" integer DEFAULT nextval('mob_roster_mob_id_seq'::regclass) NOT NULL,
    "name" character varying(100) NOT NULL,
    "mythology" character varying(20) NOT NULL,
    "mob_type" character varying(10) NOT NULL,
    "base_hp" integer NOT NULL,
    "base_atk" integer NOT NULL,
    "base_def" integer NOT NULL,
    "base_crit" numeric(4,1) NOT NULL,
    "hp_per_level" integer DEFAULT 0 NOT NULL,
    "atk_per_level" integer DEFAULT 0 NOT NULL,
    "def_per_level" integer DEFAULT 0 NOT NULL,
    "skill_key" character varying(50) NOT NULL,
    "skill_name" character varying(100) NOT NULL,
    "skill_description" text NOT NULL,
    "immunity_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "special_flags" jsonb DEFAULT '{}'::jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS public."pity_counters" (
    "discord_id" character varying(20) NOT NULL,
    "pity_count" smallint DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS public."pvp_logs" (
    "id" bigint DEFAULT nextval('pvp_logs_id_seq'::regclass) NOT NULL,
    "challenger_id" character varying(20) NOT NULL,
    "opponent_id" character varying(20) NOT NULL,
    "winner_id" character varying(20) NOT NULL,
    "challenger_damage" integer NOT NULL,
    "opponent_damage" integer NOT NULL,
    "timestamp" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."pvp_shop_purchases" (
    "discord_id" character varying(20) NOT NULL,
    "season_id" integer NOT NULL,
    "item_key" character varying(30) NOT NULL,
    "qty" integer DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS public."raid_logs" (
    "id" bigint DEFAULT nextval('raid_logs_id_seq'::regclass) NOT NULL,
    "discord_id" character varying(20) NOT NULL,
    "battle_type" character varying(10) NOT NULL,
    "enemy_name" character varying(100) NOT NULL,
    "enemy_tier" character varying(10) NOT NULL,
    "result" character varying(5) NOT NULL,
    "exp_earned" integer DEFAULT 0 NOT NULL,
    "updated_exp" bigint NOT NULL,
    "belief_shards_dropped" smallint DEFAULT 0 NOT NULL,
    "updated_belief_shards" integer NOT NULL,
    "credux_earned" integer DEFAULT 0 NOT NULL,
    "updated_credux" bigint NOT NULL,
    "chest_dropped" character varying(30),
    "timestamp" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."ranked_logs" (
    "id" bigint DEFAULT nextval('ranked_logs_id_seq'::regclass) NOT NULL,
    "player_id" character varying(20) NOT NULL,
    "opponent_id" character varying(20) NOT NULL,
    "result" character varying(4) NOT NULL,
    "rating_before" integer NOT NULL,
    "rating_after" integer NOT NULL,
    "timestamp" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."ranked_reward" (
    "bracket" character varying(10) NOT NULL,
    "weekly_credux" bigint DEFAULT 0 NOT NULL,
    "weekly_payload" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "season_end_payload" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "weekly_valor" integer DEFAULT 0 NOT NULL,
    "season_valor" integer DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS public."rune_roster" (
    "rune_id" integer DEFAULT nextval('rune_roster_rune_id_seq'::regclass) NOT NULL,
    "name" character varying(50) NOT NULL,
    "lane" character varying(10) NOT NULL,
    "effect_key" character varying(50) NOT NULL,
    "tier" character varying(10) NOT NULL,
    "value" numeric(6,2) NOT NULL,
    "description" text NOT NULL,
    "is_available" boolean DEFAULT true NOT NULL
);

CREATE TABLE IF NOT EXISTS public."seasons" (
    "season_id" integer DEFAULT nextval('seasons_season_id_seq'::regclass) NOT NULL,
    "name" character varying(50) NOT NULL,
    "theme" character varying(50),
    "starts_at" timestamp with time zone NOT NULL,
    "ends_at" timestamp with time zone NOT NULL,
    "featured_deity_id" integer,
    "is_active" boolean DEFAULT false NOT NULL
);

CREATE TABLE IF NOT EXISTS public."server_config" (
    "guild_id" character varying(20) NOT NULL,
    "prefix" character varying(5) DEFAULT 'crd'::character varying NOT NULL,
    "announcement_channel_id" character varying(20),
    "boss_announcement_channel_id" character varying(20),
    "bot_channel_id" character varying(20),
    "configured_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."socket_unlock_cost" (
    "tier" character varying(10) NOT NULL,
    "slot_index" smallint NOT NULL,
    "essence_tier" character varying(10) NOT NULL,
    "essence_cost" integer NOT NULL,
    "credux_cost" bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS public."stripe_events" (
    "event_id" character varying(64) NOT NULL,
    "type" character varying(48) NOT NULL,
    "processed_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."supporter_grants" (
    "id" bigint DEFAULT nextval('supporter_grants_id_seq'::regclass) NOT NULL,
    "discord_id" character varying(20) NOT NULL,
    "action" character varying(12) NOT NULL,
    "tier" character varying(20),
    "months" smallint,
    "paypal_ref" character varying(100),
    "granted_by" character varying(20) NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."supporter_token_ledger" (
    "entry_id" bigint DEFAULT nextval('supporter_token_ledger_entry_id_seq'::regclass) NOT NULL,
    "discord_id" character varying(20) NOT NULL,
    "delta" integer NOT NULL,
    "reason" character varying(32) NOT NULL,
    "ref" character varying(64),
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."supporters" (
    "discord_id" character varying(20) NOT NULL,
    "tier" character varying(16) NOT NULL,
    "status" character varying(16) DEFAULT 'active'::character varying NOT NULL,
    "current_period_end" timestamp with time zone,
    "founder_number" integer,
    "founder_purchased_at" timestamp with time zone,
    "cancel_at_period_end" boolean DEFAULT false NOT NULL,
    "token_balance" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "founding_supporter" boolean DEFAULT false NOT NULL,
    "granted_by" character varying(20),
    "subscribed_at" timestamp with time zone DEFAULT now() NOT NULL,
    "expires_at" timestamp with time zone
);

CREATE TABLE IF NOT EXISTS public."title_catalog" (
    "title_id" integer DEFAULT nextval('title_catalog_title_id_seq'::regclass) NOT NULL,
    "code" character varying(40) NOT NULL,
    "display" character varying(60) NOT NULL,
    "source" character varying(20) NOT NULL,
    "is_repeatable" boolean DEFAULT true NOT NULL,
    "how_to" character varying(160),
    "image_filename" character varying(100)
);

CREATE TABLE IF NOT EXISTS public."user_armors" (
    "discord_id" character varying(20) NOT NULL,
    "armor_id" character varying(8) NOT NULL,
    "armor_roster_id" integer NOT NULL,
    "curr_hp" integer NOT NULL,
    "curr_def" integer NOT NULL,
    "enhancement" smallint DEFAULT 1 NOT NULL,
    "base_hp" integer NOT NULL,
    "base_def" integer NOT NULL,
    "native_sockets" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "opposite_sockets" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "is_locked" boolean DEFAULT false NOT NULL,
    "obtained_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."user_character" (
    "discord_id" character varying(20) NOT NULL,
    "class" character varying(20) NOT NULL,
    "combat_level" smallint DEFAULT 1 NOT NULL,
    "combat_exp" bigint DEFAULT 0 NOT NULL,
    "equipped_weapon_id" character varying(8),
    "active_deity_id" integer,
    "raids_won" integer DEFAULT 0 NOT NULL,
    "raids_lost" integer DEFAULT 0 NOT NULL,
    "pvp_wins" integer DEFAULT 0 NOT NULL,
    "pvp_losses" integer DEFAULT 0 NOT NULL,
    "believer_level" integer DEFAULT 1 NOT NULL,
    "believer_exp" bigint DEFAULT 0 NOT NULL,
    "reputation_exp_today" integer DEFAULT 0 NOT NULL,
    "reputation_exp_reset_date" date,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "equipped_armor_id" character varying(8),
    "active_deity_id_2" integer,
    "active_deity_id_3" integer,
    "pvp_rating" integer DEFAULT 1000 NOT NULL,
    "boss_kills" integer DEFAULT 0 NOT NULL,
    "equipped_title_id" integer,
    "active_echo_deity_id" integer,
    "pvp_peak" integer DEFAULT 1000 NOT NULL,
    "last_weekly_claim_week" integer,
    "pvp_demotion_shield" boolean DEFAULT true NOT NULL,
    "boss_top_damage" bigint DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS public."user_cosmetics" (
    "discord_id" character varying(20) NOT NULL,
    "cosmetic_id" integer NOT NULL,
    "source" character varying(16) NOT NULL,
    "acquired_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."user_deities" (
    "user_deity_id" integer DEFAULT nextval('user_deities_user_deity_id_seq'::regclass) NOT NULL,
    "discord_id" character varying(20) NOT NULL,
    "deity_id" integer NOT NULL,
    "curr_atk" integer NOT NULL,
    "curr_hp" integer NOT NULL,
    "curr_def" integer NOT NULL,
    "enhancement" smallint DEFAULT 1 NOT NULL,
    "obtained_at" timestamp with time zone DEFAULT now() NOT NULL,
    "last_pull_date" date NOT NULL
);

CREATE TABLE IF NOT EXISTS public."user_guild_activity" (
    "discord_id" character varying(20) NOT NULL,
    "guild_id" character varying(20) NOT NULL,
    "last_active" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."user_runes" (
    "rune_uid" character varying(8) NOT NULL,
    "discord_id" character varying(20) NOT NULL,
    "rune_id" integer NOT NULL,
    "socketed_into" character varying(8),
    "is_locked" boolean DEFAULT false NOT NULL,
    "obtained_at" timestamp with time zone DEFAULT now() NOT NULL,
    "rolled_value" numeric
);

CREATE TABLE IF NOT EXISTS public."user_titles" (
    "discord_id" character varying(20) NOT NULL,
    "title_id" integer NOT NULL,
    "earned_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."user_weapons" (
    "discord_id" character varying(20) NOT NULL,
    "weapon_id" character varying(8) NOT NULL,
    "weapon_roster_id" integer NOT NULL,
    "curr_atk" integer NOT NULL,
    "enhancement" smallint DEFAULT 1 NOT NULL,
    "base_atk" integer NOT NULL,
    "crit" numeric(4,1) NOT NULL,
    "bonus_dmg_pct" numeric(5,2),
    "is_locked" boolean DEFAULT false NOT NULL,
    "obtained_at" timestamp with time zone DEFAULT now() NOT NULL,
    "native_sockets" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "opposite_sockets" jsonb DEFAULT '[]'::jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS public."users" (
    "discord_id" character varying(20) NOT NULL,
    "username" character varying(100) NOT NULL,
    "monthly_streak" smallint DEFAULT 0 NOT NULL,
    "overall_streak" integer DEFAULT 0 NOT NULL,
    "last_daily_claim_date" date,
    "last_bestow_received" date,
    "bestow_received_today" bigint DEFAULT 0 NOT NULL,
    "last_boss_attack_date" date,
    "is_banned" boolean DEFAULT false NOT NULL,
    "registered_at" timestamp with time zone DEFAULT now() NOT NULL,
    "quest_refreshes_today" smallint DEFAULT 0 NOT NULL,
    "last_quest_refresh_date" date
);

CREATE TABLE IF NOT EXISTS public."users_bag" (
    "discord_id" character varying(20) NOT NULL,
    "credux" bigint DEFAULT 0 NOT NULL,
    "belief_shards" integer DEFAULT 0 NOT NULL,
    "sacred_relics" integer DEFAULT 0 NOT NULL,
    "supreme_relics" integer DEFAULT 0 NOT NULL,
    "silver_chest" integer DEFAULT 0 NOT NULL,
    "gold_chest" integer DEFAULT 0 NOT NULL,
    "boss_treasure_chest" integer DEFAULT 0 NOT NULL,
    "boss_golden_chest" integer DEFAULT 0 NOT NULL,
    "supreme_chest" integer DEFAULT 0 NOT NULL,
    "epic_essence" integer DEFAULT 0 NOT NULL,
    "mythic_essence" integer DEFAULT 0 NOT NULL,
    "legendary_essence" integer DEFAULT 0 NOT NULL,
    "supreme_essence" integer DEFAULT 0 NOT NULL,
    "lifetime_credux_earned" bigint DEFAULT 0 NOT NULL,
    "lesser_rune_bag" integer DEFAULT 0 NOT NULL,
    "greater_rune_bag" integer DEFAULT 0 NOT NULL,
    "divine_rune_bag" integer DEFAULT 0 NOT NULL,
    "valor_medals" bigint DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS public."wager_logs" (
    "id" bigint DEFAULT nextval('wager_logs_id_seq'::regclass) NOT NULL,
    "challenger_id" character varying(20) NOT NULL,
    "opponent_id" character varying(20) NOT NULL,
    "winner_id" character varying(20) NOT NULL,
    "amount" bigint NOT NULL,
    "timestamp" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."weapon_roster" (
    "weapon_roster_id" integer DEFAULT nextval('weapon_roster_weapon_roster_id_seq'::regclass) NOT NULL,
    "name" character varying(100) NOT NULL,
    "type" character varying(10) NOT NULL,
    "tier" character varying(10) NOT NULL,
    "mythology" character varying(20) NOT NULL,
    "passive_key" character varying(50) NOT NULL,
    "passive_name" character varying(100) NOT NULL,
    "passive_description" text NOT NULL,
    "lore" text,
    "image_filename" character varying(100),
    "is_available" boolean DEFAULT true NOT NULL
);

CREATE TABLE IF NOT EXISTS public."weekly_grand" (
    "discord_id" character varying(20) NOT NULL,
    "quest_week" integer NOT NULL,
    "claimed" boolean DEFAULT false NOT NULL
);

CREATE TABLE IF NOT EXISTS public."weekly_quests" (
    "id" integer DEFAULT nextval('weekly_quests_id_seq'::regclass) NOT NULL,
    "discord_id" character varying(20) NOT NULL,
    "quest_type" character varying(30) NOT NULL,
    "target_count" integer NOT NULL,
    "current_count" integer DEFAULT 0 NOT NULL,
    "reward_credux" integer NOT NULL,
    "reward_valor" integer NOT NULL,
    "completed" boolean DEFAULT false NOT NULL,
    "quest_week" integer NOT NULL
);

-- Sequence ownership
ALTER SEQUENCE public."active_battles_battle_id_seq" OWNED BY public."active_battles"."battle_id";
ALTER SEQUENCE public."armor_roster_armor_roster_id_seq" OWNED BY public."armor_roster"."armor_roster_id";
ALTER SEQUENCE public."boss_attack_log_id_seq" OWNED BY public."boss_attack_log"."id";
ALTER SEQUENCE public."casino_logs_id_seq" OWNED BY public."casino_logs"."id";
ALTER SEQUENCE public."cosmetic_catalog_cosmetic_id_seq" OWNED BY public."cosmetic_catalog"."cosmetic_id";
ALTER SEQUENCE public."daily_quests_id_seq" OWNED BY public."daily_quests"."id";
ALTER SEQUENCE public."deity_roster_deity_id_seq" OWNED BY public."deity_roster"."deity_id";
ALTER SEQUENCE public."dev_logs_id_seq" OWNED BY public."dev_logs"."id";
ALTER SEQUENCE public."game_logs_id_seq" OWNED BY public."game_logs"."id";
ALTER SEQUENCE public."mob_roster_mob_id_seq" OWNED BY public."mob_roster"."mob_id";
ALTER SEQUENCE public."pvp_logs_id_seq" OWNED BY public."pvp_logs"."id";
ALTER SEQUENCE public."raid_logs_id_seq" OWNED BY public."raid_logs"."id";
ALTER SEQUENCE public."ranked_logs_id_seq" OWNED BY public."ranked_logs"."id";
ALTER SEQUENCE public."rune_roster_rune_id_seq" OWNED BY public."rune_roster"."rune_id";
ALTER SEQUENCE public."seasons_season_id_seq" OWNED BY public."seasons"."season_id";
ALTER SEQUENCE public."supporter_grants_id_seq" OWNED BY public."supporter_grants"."id";
ALTER SEQUENCE public."supporter_token_ledger_entry_id_seq" OWNED BY public."supporter_token_ledger"."entry_id";
ALTER SEQUENCE public."title_catalog_title_id_seq" OWNED BY public."title_catalog"."title_id";
ALTER SEQUENCE public."user_deities_user_deity_id_seq" OWNED BY public."user_deities"."user_deity_id";
ALTER SEQUENCE public."wager_logs_id_seq" OWNED BY public."wager_logs"."id";
ALTER SEQUENCE public."weapon_roster_weapon_roster_id_seq" OWNED BY public."weapon_roster"."weapon_roster_id";
ALTER SEQUENCE public."weekly_quests_id_seq" OWNED BY public."weekly_quests"."id";

-- Constraints
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'active_battles_pkey'
       AND conrelid = 'public.active_battles'::regclass
  ) THEN
    ALTER TABLE public."active_battles" ADD CONSTRAINT "active_battles_pkey" PRIMARY KEY (battle_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'active_battles_discord_id_key'
       AND conrelid = 'public.active_battles'::regclass
  ) THEN
    ALTER TABLE public."active_battles" ADD CONSTRAINT "active_battles_discord_id_key" UNIQUE (discord_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'active_battles_battle_type_check'
       AND conrelid = 'public.active_battles'::regclass
  ) THEN
    ALTER TABLE public."active_battles" ADD CONSTRAINT "active_battles_battle_type_check" CHECK (battle_type::text = ANY (ARRAY['raid'::character varying, 'boss'::character varying]::text[]));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'active_battles_discord_id_fkey'
       AND conrelid = 'public.active_battles'::regclass
  ) THEN
    ALTER TABLE public."active_battles" ADD CONSTRAINT "active_battles_discord_id_fkey" FOREIGN KEY (discord_id) REFERENCES users(discord_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'active_battles_mob_id_fkey'
       AND conrelid = 'public.active_battles'::regclass
  ) THEN
    ALTER TABLE public."active_battles" ADD CONSTRAINT "active_battles_mob_id_fkey" FOREIGN KEY (mob_id) REFERENCES mob_roster(mob_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'active_casino_sessions_pkey'
       AND conrelid = 'public.active_casino_sessions'::regclass
  ) THEN
    ALTER TABLE public."active_casino_sessions" ADD CONSTRAINT "active_casino_sessions_pkey" PRIMARY KEY (session_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'active_casino_sessions_bet_amount_check'
       AND conrelid = 'public.active_casino_sessions'::regclass
  ) THEN
    ALTER TABLE public."active_casino_sessions" ADD CONSTRAINT "active_casino_sessions_bet_amount_check" CHECK (bet_amount > 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'active_casino_sessions_game_check'
       AND conrelid = 'public.active_casino_sessions'::regclass
  ) THEN
    ALTER TABLE public."active_casino_sessions" ADD CONSTRAINT "active_casino_sessions_game_check" CHECK (game::text = ANY (ARRAY['blackjack'::character varying, 'crash'::character varying]::text[]));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'active_casino_sessions_status_check'
       AND conrelid = 'public.active_casino_sessions'::regclass
  ) THEN
    ALTER TABLE public."active_casino_sessions" ADD CONSTRAINT "active_casino_sessions_status_check" CHECK (status::text = ANY (ARRAY['active'::character varying, 'resolving'::character varying, 'settled'::character varying, 'refunded'::character varying, 'expired'::character varying]::text[]));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'active_casino_sessions_discord_id_fkey'
       AND conrelid = 'public.active_casino_sessions'::regclass
  ) THEN
    ALTER TABLE public."active_casino_sessions" ADD CONSTRAINT "active_casino_sessions_discord_id_fkey" FOREIGN KEY (discord_id) REFERENCES users(discord_id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'active_duel_participants_pkey'
       AND conrelid = 'public.active_duel_participants'::regclass
  ) THEN
    ALTER TABLE public."active_duel_participants" ADD CONSTRAINT "active_duel_participants_pkey" PRIMARY KEY (discord_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'active_duel_participants_role_check'
       AND conrelid = 'public.active_duel_participants'::regclass
  ) THEN
    ALTER TABLE public."active_duel_participants" ADD CONSTRAINT "active_duel_participants_role_check" CHECK (role::text = ANY (ARRAY['challenger'::character varying, 'opponent'::character varying]::text[]));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'active_duel_participants_duel_id_fkey'
       AND conrelid = 'public.active_duel_participants'::regclass
  ) THEN
    ALTER TABLE public."active_duel_participants" ADD CONSTRAINT "active_duel_participants_duel_id_fkey" FOREIGN KEY (duel_id) REFERENCES active_duels(duel_id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'active_duels_pkey'
       AND conrelid = 'public.active_duels'::regclass
  ) THEN
    ALTER TABLE public."active_duels" ADD CONSTRAINT "active_duels_pkey" PRIMARY KEY (duel_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'active_duels_duel_type_check'
       AND conrelid = 'public.active_duels'::regclass
  ) THEN
    ALTER TABLE public."active_duels" ADD CONSTRAINT "active_duels_duel_type_check" CHECK (duel_type::text = ANY (ARRAY['casual'::character varying, 'wager'::character varying]::text[]));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'active_duels_status_check'
       AND conrelid = 'public.active_duels'::regclass
  ) THEN
    ALTER TABLE public."active_duels" ADD CONSTRAINT "active_duels_status_check" CHECK (status::text = ANY (ARRAY['pending'::character varying, 'running'::character varying, 'settling'::character varying]::text[]));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'active_ranked_fights_pkey'
       AND conrelid = 'public.active_ranked_fights'::regclass
  ) THEN
    ALTER TABLE public."active_ranked_fights" ADD CONSTRAINT "active_ranked_fights_pkey" PRIMARY KEY (discord_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'armor_roster_pkey'
       AND conrelid = 'public.armor_roster'::regclass
  ) THEN
    ALTER TABLE public."armor_roster" ADD CONSTRAINT "armor_roster_pkey" PRIMARY KEY (armor_roster_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'armor_roster_tier_check'
       AND conrelid = 'public.armor_roster'::regclass
  ) THEN
    ALTER TABLE public."armor_roster" ADD CONSTRAINT "armor_roster_tier_check" CHECK (tier::text = ANY (ARRAY['Common'::character varying, 'Rare'::character varying, 'Mythic'::character varying, 'Legendary'::character varying, 'Supreme'::character varying]::text[]));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'armor_roster_type_check'
       AND conrelid = 'public.armor_roster'::regclass
  ) THEN
    ALTER TABLE public."armor_roster" ADD CONSTRAINT "armor_roster_type_check" CHECK (type::text = ANY (ARRAY['Heavy'::character varying, 'Medium'::character varying, 'Light'::character varying]::text[]));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'auto_raids_pkey'
       AND conrelid = 'public.auto_raids'::regclass
  ) THEN
    ALTER TABLE public."auto_raids" ADD CONSTRAINT "auto_raids_pkey" PRIMARY KEY (discord_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'boss_attack_log_pkey'
       AND conrelid = 'public.boss_attack_log'::regclass
  ) THEN
    ALTER TABLE public."boss_attack_log" ADD CONSTRAINT "boss_attack_log_pkey" PRIMARY KEY (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'boss_attack_log_boss_spawn_id_discord_id_key'
       AND conrelid = 'public.boss_attack_log'::regclass
  ) THEN
    ALTER TABLE public."boss_attack_log" ADD CONSTRAINT "boss_attack_log_boss_spawn_id_discord_id_key" UNIQUE (boss_spawn_id, discord_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'boss_attack_log_discord_id_fkey'
       AND conrelid = 'public.boss_attack_log'::regclass
  ) THEN
    ALTER TABLE public."boss_attack_log" ADD CONSTRAINT "boss_attack_log_discord_id_fkey" FOREIGN KEY (discord_id) REFERENCES users(discord_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'boss_state_pkey'
       AND conrelid = 'public.boss_state'::regclass
  ) THEN
    ALTER TABLE public."boss_state" ADD CONSTRAINT "boss_state_pkey" PRIMARY KEY (guild_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'boss_state_status_check'
       AND conrelid = 'public.boss_state'::regclass
  ) THEN
    ALTER TABLE public."boss_state" ADD CONSTRAINT "boss_state_status_check" CHECK (status::text = ANY (ARRAY['active'::character varying, 'dead'::character varying, 'escaped'::character varying]::text[]));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'boss_state_mob_id_fkey'
       AND conrelid = 'public.boss_state'::regclass
  ) THEN
    ALTER TABLE public."boss_state" ADD CONSTRAINT "boss_state_mob_id_fkey" FOREIGN KEY (mob_id) REFERENCES mob_roster(mob_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'casino_logs_pkey'
       AND conrelid = 'public.casino_logs'::regclass
  ) THEN
    ALTER TABLE public."casino_logs" ADD CONSTRAINT "casino_logs_pkey" PRIMARY KEY (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'casino_logs_result_check'
       AND conrelid = 'public.casino_logs'::regclass
  ) THEN
    ALTER TABLE public."casino_logs" ADD CONSTRAINT "casino_logs_result_check" CHECK (result::text = ANY (ARRAY['win'::character varying, 'loss'::character varying]::text[]));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'cosmetic_catalog_pkey'
       AND conrelid = 'public.cosmetic_catalog'::regclass
  ) THEN
    ALTER TABLE public."cosmetic_catalog" ADD CONSTRAINT "cosmetic_catalog_pkey" PRIMARY KEY (cosmetic_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'cosmetic_catalog_cosmetic_key_key'
       AND conrelid = 'public.cosmetic_catalog'::regclass
  ) THEN
    ALTER TABLE public."cosmetic_catalog" ADD CONSTRAINT "cosmetic_catalog_cosmetic_key_key" UNIQUE (cosmetic_key);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'cosmetic_catalog_category_check'
       AND conrelid = 'public.cosmetic_catalog'::regclass
  ) THEN
    ALTER TABLE public."cosmetic_catalog" ADD CONSTRAINT "cosmetic_catalog_category_check" CHECK (category::text = ANY (ARRAY['profile'::character varying, 'battle'::character varying, 'battle_result'::character varying, 'summon'::character varying]::text[]));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'cosmetic_catalog_tier_check'
       AND conrelid = 'public.cosmetic_catalog'::regclass
  ) THEN
    ALTER TABLE public."cosmetic_catalog" ADD CONSTRAINT "cosmetic_catalog_tier_check" CHECK (tier::text = ANY (ARRAY['believer'::character varying, 'chosen'::character varying, 'eternal'::character varying]::text[]));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'cosmetic_catalog_token_cost_check'
       AND conrelid = 'public.cosmetic_catalog'::regclass
  ) THEN
    ALTER TABLE public."cosmetic_catalog" ADD CONSTRAINT "cosmetic_catalog_token_cost_check" CHECK (token_cost >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'daily_quests_pkey'
       AND conrelid = 'public.daily_quests'::regclass
  ) THEN
    ALTER TABLE public."daily_quests" ADD CONSTRAINT "daily_quests_pkey" PRIMARY KEY (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'daily_quests_discord_id_quest_type_quest_date_key'
       AND conrelid = 'public.daily_quests'::regclass
  ) THEN
    ALTER TABLE public."daily_quests" ADD CONSTRAINT "daily_quests_discord_id_quest_type_quest_date_key" UNIQUE (discord_id, quest_type, quest_date);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'daily_quests_discord_id_fkey'
       AND conrelid = 'public.daily_quests'::regclass
  ) THEN
    ALTER TABLE public."daily_quests" ADD CONSTRAINT "daily_quests_discord_id_fkey" FOREIGN KEY (discord_id) REFERENCES users(discord_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'deity_roster_pkey'
       AND conrelid = 'public.deity_roster'::regclass
  ) THEN
    ALTER TABLE public."deity_roster" ADD CONSTRAINT "deity_roster_pkey" PRIMARY KEY (deity_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'deity_roster_name_key'
       AND conrelid = 'public.deity_roster'::regclass
  ) THEN
    ALTER TABLE public."deity_roster" ADD CONSTRAINT "deity_roster_name_key" UNIQUE (name);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'deity_roster_blessing_scaling_check'
       AND conrelid = 'public.deity_roster'::regclass
  ) THEN
    ALTER TABLE public."deity_roster" ADD CONSTRAINT "deity_roster_blessing_scaling_check" CHECK (blessing_scaling::text = ANY (ARRAY['scalable'::character varying, 'binary'::character varying]::text[]));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'deity_roster_tier_check'
       AND conrelid = 'public.deity_roster'::regclass
  ) THEN
    ALTER TABLE public."deity_roster" ADD CONSTRAINT "deity_roster_tier_check" CHECK (tier::text = ANY (ARRAY['Epic'::character varying, 'Mythic'::character varying, 'Legendary'::character varying, 'Supreme'::character varying]::text[]));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'dev_logs_pkey'
       AND conrelid = 'public.dev_logs'::regclass
  ) THEN
    ALTER TABLE public."dev_logs" ADD CONSTRAINT "dev_logs_pkey" PRIMARY KEY (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'equipped_skins_pkey'
       AND conrelid = 'public.equipped_skins'::regclass
  ) THEN
    ALTER TABLE public."equipped_skins" ADD CONSTRAINT "equipped_skins_pkey" PRIMARY KEY (discord_id, category);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'equipped_skins_category_check'
       AND conrelid = 'public.equipped_skins'::regclass
  ) THEN
    ALTER TABLE public."equipped_skins" ADD CONSTRAINT "equipped_skins_category_check" CHECK (category::text = ANY (ARRAY['profile'::character varying, 'battle'::character varying, 'battle_result'::character varying, 'summon'::character varying]::text[]));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'equipped_skins_cosmetic_id_fkey'
       AND conrelid = 'public.equipped_skins'::regclass
  ) THEN
    ALTER TABLE public."equipped_skins" ADD CONSTRAINT "equipped_skins_cosmetic_id_fkey" FOREIGN KEY (cosmetic_id) REFERENCES cosmetic_catalog(cosmetic_id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'equipped_skins_discord_id_fkey'
       AND conrelid = 'public.equipped_skins'::regclass
  ) THEN
    ALTER TABLE public."equipped_skins" ADD CONSTRAINT "equipped_skins_discord_id_fkey" FOREIGN KEY (discord_id) REFERENCES users(discord_id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'essence_bag_def_pkey'
       AND conrelid = 'public.essence_bag_def'::regclass
  ) THEN
    ALTER TABLE public."essence_bag_def" ADD CONSTRAINT "essence_bag_def_pkey" PRIMARY KEY (bag_key);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'game_logs_pkey'
       AND conrelid = 'public.game_logs'::regclass
  ) THEN
    ALTER TABLE public."game_logs" ADD CONSTRAINT "game_logs_pkey" PRIMARY KEY (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'mob_roster_pkey'
       AND conrelid = 'public.mob_roster'::regclass
  ) THEN
    ALTER TABLE public."mob_roster" ADD CONSTRAINT "mob_roster_pkey" PRIMARY KEY (mob_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'mob_roster_mob_type_check'
       AND conrelid = 'public.mob_roster'::regclass
  ) THEN
    ALTER TABLE public."mob_roster" ADD CONSTRAINT "mob_roster_mob_type_check" CHECK (mob_type::text = ANY (ARRAY['regular'::character varying, 'elite'::character varying, 'boss'::character varying]::text[]));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'pity_counters_pkey'
       AND conrelid = 'public.pity_counters'::regclass
  ) THEN
    ALTER TABLE public."pity_counters" ADD CONSTRAINT "pity_counters_pkey" PRIMARY KEY (discord_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'pity_counters_discord_id_fkey'
       AND conrelid = 'public.pity_counters'::regclass
  ) THEN
    ALTER TABLE public."pity_counters" ADD CONSTRAINT "pity_counters_discord_id_fkey" FOREIGN KEY (discord_id) REFERENCES users(discord_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'pvp_logs_pkey'
       AND conrelid = 'public.pvp_logs'::regclass
  ) THEN
    ALTER TABLE public."pvp_logs" ADD CONSTRAINT "pvp_logs_pkey" PRIMARY KEY (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'pvp_shop_purchases_pkey'
       AND conrelid = 'public.pvp_shop_purchases'::regclass
  ) THEN
    ALTER TABLE public."pvp_shop_purchases" ADD CONSTRAINT "pvp_shop_purchases_pkey" PRIMARY KEY (discord_id, season_id, item_key);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'pvp_shop_purchases_discord_id_fkey'
       AND conrelid = 'public.pvp_shop_purchases'::regclass
  ) THEN
    ALTER TABLE public."pvp_shop_purchases" ADD CONSTRAINT "pvp_shop_purchases_discord_id_fkey" FOREIGN KEY (discord_id) REFERENCES users(discord_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'raid_logs_pkey'
       AND conrelid = 'public.raid_logs'::regclass
  ) THEN
    ALTER TABLE public."raid_logs" ADD CONSTRAINT "raid_logs_pkey" PRIMARY KEY (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'raid_logs_enemy_tier_check'
       AND conrelid = 'public.raid_logs'::regclass
  ) THEN
    ALTER TABLE public."raid_logs" ADD CONSTRAINT "raid_logs_enemy_tier_check" CHECK (enemy_tier::text = ANY (ARRAY['regular'::character varying, 'elite'::character varying, 'boss'::character varying]::text[]));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'raid_logs_result_check'
       AND conrelid = 'public.raid_logs'::regclass
  ) THEN
    ALTER TABLE public."raid_logs" ADD CONSTRAINT "raid_logs_result_check" CHECK (result::text = ANY (ARRAY['win'::character varying, 'loss'::character varying]::text[]));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ranked_logs_pkey'
       AND conrelid = 'public.ranked_logs'::regclass
  ) THEN
    ALTER TABLE public."ranked_logs" ADD CONSTRAINT "ranked_logs_pkey" PRIMARY KEY (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ranked_logs_result_check'
       AND conrelid = 'public.ranked_logs'::regclass
  ) THEN
    ALTER TABLE public."ranked_logs" ADD CONSTRAINT "ranked_logs_result_check" CHECK (result::text = ANY (ARRAY['win'::character varying, 'loss'::character varying]::text[]));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ranked_logs_player_id_fkey'
       AND conrelid = 'public.ranked_logs'::regclass
  ) THEN
    ALTER TABLE public."ranked_logs" ADD CONSTRAINT "ranked_logs_player_id_fkey" FOREIGN KEY (player_id) REFERENCES users(discord_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ranked_reward_pkey'
       AND conrelid = 'public.ranked_reward'::regclass
  ) THEN
    ALTER TABLE public."ranked_reward" ADD CONSTRAINT "ranked_reward_pkey" PRIMARY KEY (bracket);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ranked_reward_bracket_check'
       AND conrelid = 'public.ranked_reward'::regclass
  ) THEN
    ALTER TABLE public."ranked_reward" ADD CONSTRAINT "ranked_reward_bracket_check" CHECK (bracket::text = ANY (ARRAY['Mortal'::character varying, 'Champion'::character varying, 'Demigod'::character varying, 'Ascendant'::character varying, 'Divine'::character varying]::text[]));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'rune_roster_pkey'
       AND conrelid = 'public.rune_roster'::regclass
  ) THEN
    ALTER TABLE public."rune_roster" ADD CONSTRAINT "rune_roster_pkey" PRIMARY KEY (rune_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'rune_roster_lane_check'
       AND conrelid = 'public.rune_roster'::regclass
  ) THEN
    ALTER TABLE public."rune_roster" ADD CONSTRAINT "rune_roster_lane_check" CHECK (lane::text = ANY (ARRAY['offense'::character varying, 'defense'::character varying]::text[]));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'rune_roster_tier_check'
       AND conrelid = 'public.rune_roster'::regclass
  ) THEN
    ALTER TABLE public."rune_roster" ADD CONSTRAINT "rune_roster_tier_check" CHECK (tier::text = ANY (ARRAY['Common'::character varying, 'Rare'::character varying, 'Mythic'::character varying, 'Legendary'::character varying, 'Supreme'::character varying]::text[]));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'seasons_pkey'
       AND conrelid = 'public.seasons'::regclass
  ) THEN
    ALTER TABLE public."seasons" ADD CONSTRAINT "seasons_pkey" PRIMARY KEY (season_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'seasons_featured_deity_id_fkey'
       AND conrelid = 'public.seasons'::regclass
  ) THEN
    ALTER TABLE public."seasons" ADD CONSTRAINT "seasons_featured_deity_id_fkey" FOREIGN KEY (featured_deity_id) REFERENCES deity_roster(deity_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'server_config_pkey'
       AND conrelid = 'public.server_config'::regclass
  ) THEN
    ALTER TABLE public."server_config" ADD CONSTRAINT "server_config_pkey" PRIMARY KEY (guild_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'socket_unlock_cost_pkey'
       AND conrelid = 'public.socket_unlock_cost'::regclass
  ) THEN
    ALTER TABLE public."socket_unlock_cost" ADD CONSTRAINT "socket_unlock_cost_pkey" PRIMARY KEY (tier, slot_index);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'socket_unlock_cost_tier_check'
       AND conrelid = 'public.socket_unlock_cost'::regclass
  ) THEN
    ALTER TABLE public."socket_unlock_cost" ADD CONSTRAINT "socket_unlock_cost_tier_check" CHECK (tier::text = ANY (ARRAY['Mythic'::character varying, 'Legendary'::character varying, 'Supreme'::character varying]::text[]));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'stripe_events_pkey'
       AND conrelid = 'public.stripe_events'::regclass
  ) THEN
    ALTER TABLE public."stripe_events" ADD CONSTRAINT "stripe_events_pkey" PRIMARY KEY (event_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'supporter_grants_pkey'
       AND conrelid = 'public.supporter_grants'::regclass
  ) THEN
    ALTER TABLE public."supporter_grants" ADD CONSTRAINT "supporter_grants_pkey" PRIMARY KEY (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'supporter_grants_action_check'
       AND conrelid = 'public.supporter_grants'::regclass
  ) THEN
    ALTER TABLE public."supporter_grants" ADD CONSTRAINT "supporter_grants_action_check" CHECK (action::text = ANY (ARRAY['grant'::character varying, 'extend'::character varying, 'revoke'::character varying]::text[]));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'supporter_token_ledger_pkey'
       AND conrelid = 'public.supporter_token_ledger'::regclass
  ) THEN
    ALTER TABLE public."supporter_token_ledger" ADD CONSTRAINT "supporter_token_ledger_pkey" PRIMARY KEY (entry_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'supporter_token_ledger_discord_id_fkey'
       AND conrelid = 'public.supporter_token_ledger'::regclass
  ) THEN
    ALTER TABLE public."supporter_token_ledger" ADD CONSTRAINT "supporter_token_ledger_discord_id_fkey" FOREIGN KEY (discord_id) REFERENCES users(discord_id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'supporters_pkey'
       AND conrelid = 'public.supporters'::regclass
  ) THEN
    ALTER TABLE public."supporters" ADD CONSTRAINT "supporters_pkey" PRIMARY KEY (discord_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'supporters_founder_number_key'
       AND conrelid = 'public.supporters'::regclass
  ) THEN
    ALTER TABLE public."supporters" ADD CONSTRAINT "supporters_founder_number_key" UNIQUE (founder_number);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'supporters_founder_number_check'
       AND conrelid = 'public.supporters'::regclass
  ) THEN
    ALTER TABLE public."supporters" ADD CONSTRAINT "supporters_founder_number_check" CHECK (founder_number >= 1 AND founder_number <= 50);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'supporters_status_check'
       AND conrelid = 'public.supporters'::regclass
  ) THEN
    ALTER TABLE public."supporters" ADD CONSTRAINT "supporters_status_check" CHECK (status::text = ANY (ARRAY['active'::character varying, 'past_due'::character varying, 'canceled'::character varying, 'expired'::character varying]::text[]));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'supporters_tier_check'
       AND conrelid = 'public.supporters'::regclass
  ) THEN
    ALTER TABLE public."supporters" ADD CONSTRAINT "supporters_tier_check" CHECK (tier::text = ANY (ARRAY['believer'::character varying, 'chosen_believer'::character varying, 'eternal_believer'::character varying]::text[]));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'supporters_token_balance_check'
       AND conrelid = 'public.supporters'::regclass
  ) THEN
    ALTER TABLE public."supporters" ADD CONSTRAINT "supporters_token_balance_check" CHECK (token_balance >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'supporters_discord_id_fkey'
       AND conrelid = 'public.supporters'::regclass
  ) THEN
    ALTER TABLE public."supporters" ADD CONSTRAINT "supporters_discord_id_fkey" FOREIGN KEY (discord_id) REFERENCES users(discord_id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'title_catalog_pkey'
       AND conrelid = 'public.title_catalog'::regclass
  ) THEN
    ALTER TABLE public."title_catalog" ADD CONSTRAINT "title_catalog_pkey" PRIMARY KEY (title_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'title_catalog_code_key'
       AND conrelid = 'public.title_catalog'::regclass
  ) THEN
    ALTER TABLE public."title_catalog" ADD CONSTRAINT "title_catalog_code_key" UNIQUE (code);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'title_catalog_source_check'
       AND conrelid = 'public.title_catalog'::regclass
  ) THEN
    ALTER TABLE public."title_catalog" ADD CONSTRAINT "title_catalog_source_check" CHECK (source::text = ANY (ARRAY['believer'::character varying, 'rank_season'::character varying, 'boss_feat'::character varying, 'collection'::character varying, 'event'::character varying]::text[]));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_armors_pkey'
       AND conrelid = 'public.user_armors'::regclass
  ) THEN
    ALTER TABLE public."user_armors" ADD CONSTRAINT "user_armors_pkey" PRIMARY KEY (armor_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_armors_enhancement_check'
       AND conrelid = 'public.user_armors'::regclass
  ) THEN
    ALTER TABLE public."user_armors" ADD CONSTRAINT "user_armors_enhancement_check" CHECK (enhancement >= 1 AND enhancement <= 11);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_armors_armor_roster_id_fkey'
       AND conrelid = 'public.user_armors'::regclass
  ) THEN
    ALTER TABLE public."user_armors" ADD CONSTRAINT "user_armors_armor_roster_id_fkey" FOREIGN KEY (armor_roster_id) REFERENCES armor_roster(armor_roster_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_armors_discord_id_fkey'
       AND conrelid = 'public.user_armors'::regclass
  ) THEN
    ALTER TABLE public."user_armors" ADD CONSTRAINT "user_armors_discord_id_fkey" FOREIGN KEY (discord_id) REFERENCES users(discord_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_character_pkey'
       AND conrelid = 'public.user_character'::regclass
  ) THEN
    ALTER TABLE public."user_character" ADD CONSTRAINT "user_character_pkey" PRIMARY KEY (discord_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_character_class_check'
       AND conrelid = 'public.user_character'::regclass
  ) THEN
    ALTER TABLE public."user_character" ADD CONSTRAINT "user_character_class_check" CHECK (class::text = ANY (ARRAY['Swordsman'::character varying, 'Fighter'::character varying, 'Mage'::character varying, 'Knight'::character varying, 'Archer'::character varying]::text[]));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_character_combat_level_check'
       AND conrelid = 'public.user_character'::regclass
  ) THEN
    ALTER TABLE public."user_character" ADD CONSTRAINT "user_character_combat_level_check" CHECK (combat_level >= 1 AND combat_level <= 50);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_character_active_deity_id_2_fkey'
       AND conrelid = 'public.user_character'::regclass
  ) THEN
    ALTER TABLE public."user_character" ADD CONSTRAINT "user_character_active_deity_id_2_fkey" FOREIGN KEY (active_deity_id_2) REFERENCES user_deities(user_deity_id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_character_active_deity_id_3_fkey'
       AND conrelid = 'public.user_character'::regclass
  ) THEN
    ALTER TABLE public."user_character" ADD CONSTRAINT "user_character_active_deity_id_3_fkey" FOREIGN KEY (active_deity_id_3) REFERENCES user_deities(user_deity_id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_character_active_deity_id_fkey'
       AND conrelid = 'public.user_character'::regclass
  ) THEN
    ALTER TABLE public."user_character" ADD CONSTRAINT "user_character_active_deity_id_fkey" FOREIGN KEY (active_deity_id) REFERENCES user_deities(user_deity_id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_character_active_echo_deity_id_fkey'
       AND conrelid = 'public.user_character'::regclass
  ) THEN
    ALTER TABLE public."user_character" ADD CONSTRAINT "user_character_active_echo_deity_id_fkey" FOREIGN KEY (active_echo_deity_id) REFERENCES user_deities(user_deity_id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_character_discord_id_fkey'
       AND conrelid = 'public.user_character'::regclass
  ) THEN
    ALTER TABLE public."user_character" ADD CONSTRAINT "user_character_discord_id_fkey" FOREIGN KEY (discord_id) REFERENCES users(discord_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_character_equipped_armor_id_fkey'
       AND conrelid = 'public.user_character'::regclass
  ) THEN
    ALTER TABLE public."user_character" ADD CONSTRAINT "user_character_equipped_armor_id_fkey" FOREIGN KEY (equipped_armor_id) REFERENCES user_armors(armor_id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_character_equipped_title_id_fkey'
       AND conrelid = 'public.user_character'::regclass
  ) THEN
    ALTER TABLE public."user_character" ADD CONSTRAINT "user_character_equipped_title_id_fkey" FOREIGN KEY (equipped_title_id) REFERENCES title_catalog(title_id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_character_equipped_weapon_id_fkey'
       AND conrelid = 'public.user_character'::regclass
  ) THEN
    ALTER TABLE public."user_character" ADD CONSTRAINT "user_character_equipped_weapon_id_fkey" FOREIGN KEY (equipped_weapon_id) REFERENCES user_weapons(weapon_id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_cosmetics_pkey'
       AND conrelid = 'public.user_cosmetics'::regclass
  ) THEN
    ALTER TABLE public."user_cosmetics" ADD CONSTRAINT "user_cosmetics_pkey" PRIMARY KEY (discord_id, cosmetic_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_cosmetics_source_check'
       AND conrelid = 'public.user_cosmetics'::regclass
  ) THEN
    ALTER TABLE public."user_cosmetics" ADD CONSTRAINT "user_cosmetics_source_check" CHECK (source::text = ANY (ARRAY['base'::character varying, 'shop'::character varying, 'founder'::character varying, 'grant'::character varying]::text[]));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_cosmetics_cosmetic_id_fkey'
       AND conrelid = 'public.user_cosmetics'::regclass
  ) THEN
    ALTER TABLE public."user_cosmetics" ADD CONSTRAINT "user_cosmetics_cosmetic_id_fkey" FOREIGN KEY (cosmetic_id) REFERENCES cosmetic_catalog(cosmetic_id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_cosmetics_discord_id_fkey'
       AND conrelid = 'public.user_cosmetics'::regclass
  ) THEN
    ALTER TABLE public."user_cosmetics" ADD CONSTRAINT "user_cosmetics_discord_id_fkey" FOREIGN KEY (discord_id) REFERENCES users(discord_id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_deities_pkey'
       AND conrelid = 'public.user_deities'::regclass
  ) THEN
    ALTER TABLE public."user_deities" ADD CONSTRAINT "user_deities_pkey" PRIMARY KEY (user_deity_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_deities_discord_id_deity_id_key'
       AND conrelid = 'public.user_deities'::regclass
  ) THEN
    ALTER TABLE public."user_deities" ADD CONSTRAINT "user_deities_discord_id_deity_id_key" UNIQUE (discord_id, deity_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_deities_enhancement_check'
       AND conrelid = 'public.user_deities'::regclass
  ) THEN
    ALTER TABLE public."user_deities" ADD CONSTRAINT "user_deities_enhancement_check" CHECK (enhancement >= 1 AND enhancement <= 11);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_deities_deity_id_fkey'
       AND conrelid = 'public.user_deities'::regclass
  ) THEN
    ALTER TABLE public."user_deities" ADD CONSTRAINT "user_deities_deity_id_fkey" FOREIGN KEY (deity_id) REFERENCES deity_roster(deity_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_deities_discord_id_fkey'
       AND conrelid = 'public.user_deities'::regclass
  ) THEN
    ALTER TABLE public."user_deities" ADD CONSTRAINT "user_deities_discord_id_fkey" FOREIGN KEY (discord_id) REFERENCES users(discord_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_guild_activity_pkey'
       AND conrelid = 'public.user_guild_activity'::regclass
  ) THEN
    ALTER TABLE public."user_guild_activity" ADD CONSTRAINT "user_guild_activity_pkey" PRIMARY KEY (discord_id, guild_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_guild_activity_discord_id_fkey'
       AND conrelid = 'public.user_guild_activity'::regclass
  ) THEN
    ALTER TABLE public."user_guild_activity" ADD CONSTRAINT "user_guild_activity_discord_id_fkey" FOREIGN KEY (discord_id) REFERENCES users(discord_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_runes_pkey'
       AND conrelid = 'public.user_runes'::regclass
  ) THEN
    ALTER TABLE public."user_runes" ADD CONSTRAINT "user_runes_pkey" PRIMARY KEY (rune_uid);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_runes_discord_id_fkey'
       AND conrelid = 'public.user_runes'::regclass
  ) THEN
    ALTER TABLE public."user_runes" ADD CONSTRAINT "user_runes_discord_id_fkey" FOREIGN KEY (discord_id) REFERENCES users(discord_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_runes_rune_id_fkey'
       AND conrelid = 'public.user_runes'::regclass
  ) THEN
    ALTER TABLE public."user_runes" ADD CONSTRAINT "user_runes_rune_id_fkey" FOREIGN KEY (rune_id) REFERENCES rune_roster(rune_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_titles_pkey'
       AND conrelid = 'public.user_titles'::regclass
  ) THEN
    ALTER TABLE public."user_titles" ADD CONSTRAINT "user_titles_pkey" PRIMARY KEY (discord_id, title_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_titles_discord_id_fkey'
       AND conrelid = 'public.user_titles'::regclass
  ) THEN
    ALTER TABLE public."user_titles" ADD CONSTRAINT "user_titles_discord_id_fkey" FOREIGN KEY (discord_id) REFERENCES users(discord_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_titles_title_id_fkey'
       AND conrelid = 'public.user_titles'::regclass
  ) THEN
    ALTER TABLE public."user_titles" ADD CONSTRAINT "user_titles_title_id_fkey" FOREIGN KEY (title_id) REFERENCES title_catalog(title_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_weapons_pkey'
       AND conrelid = 'public.user_weapons'::regclass
  ) THEN
    ALTER TABLE public."user_weapons" ADD CONSTRAINT "user_weapons_pkey" PRIMARY KEY (weapon_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_weapons_enhancement_check'
       AND conrelid = 'public.user_weapons'::regclass
  ) THEN
    ALTER TABLE public."user_weapons" ADD CONSTRAINT "user_weapons_enhancement_check" CHECK (enhancement >= 1 AND enhancement <= 11);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_weapons_discord_id_fkey'
       AND conrelid = 'public.user_weapons'::regclass
  ) THEN
    ALTER TABLE public."user_weapons" ADD CONSTRAINT "user_weapons_discord_id_fkey" FOREIGN KEY (discord_id) REFERENCES users(discord_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_weapons_weapon_roster_id_fkey'
       AND conrelid = 'public.user_weapons'::regclass
  ) THEN
    ALTER TABLE public."user_weapons" ADD CONSTRAINT "user_weapons_weapon_roster_id_fkey" FOREIGN KEY (weapon_roster_id) REFERENCES weapon_roster(weapon_roster_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'users_pkey'
       AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public."users" ADD CONSTRAINT "users_pkey" PRIMARY KEY (discord_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'users_bag_pkey'
       AND conrelid = 'public.users_bag'::regclass
  ) THEN
    ALTER TABLE public."users_bag" ADD CONSTRAINT "users_bag_pkey" PRIMARY KEY (discord_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'users_bag_discord_id_fkey'
       AND conrelid = 'public.users_bag'::regclass
  ) THEN
    ALTER TABLE public."users_bag" ADD CONSTRAINT "users_bag_discord_id_fkey" FOREIGN KEY (discord_id) REFERENCES users(discord_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'wager_logs_pkey'
       AND conrelid = 'public.wager_logs'::regclass
  ) THEN
    ALTER TABLE public."wager_logs" ADD CONSTRAINT "wager_logs_pkey" PRIMARY KEY (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'weapon_roster_pkey'
       AND conrelid = 'public.weapon_roster'::regclass
  ) THEN
    ALTER TABLE public."weapon_roster" ADD CONSTRAINT "weapon_roster_pkey" PRIMARY KEY (weapon_roster_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'weapon_roster_tier_check'
       AND conrelid = 'public.weapon_roster'::regclass
  ) THEN
    ALTER TABLE public."weapon_roster" ADD CONSTRAINT "weapon_roster_tier_check" CHECK (tier::text = ANY (ARRAY['Common'::character varying, 'Rare'::character varying, 'Mythic'::character varying, 'Legendary'::character varying, 'Supreme'::character varying]::text[]));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'weapon_roster_type_check'
       AND conrelid = 'public.weapon_roster'::regclass
  ) THEN
    ALTER TABLE public."weapon_roster" ADD CONSTRAINT "weapon_roster_type_check" CHECK (type::text = ANY (ARRAY['Sword'::character varying, 'Staff'::character varying, 'Gloves'::character varying, 'Bow'::character varying]::text[]));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'weekly_grand_pkey'
       AND conrelid = 'public.weekly_grand'::regclass
  ) THEN
    ALTER TABLE public."weekly_grand" ADD CONSTRAINT "weekly_grand_pkey" PRIMARY KEY (discord_id, quest_week);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'weekly_grand_discord_id_fkey'
       AND conrelid = 'public.weekly_grand'::regclass
  ) THEN
    ALTER TABLE public."weekly_grand" ADD CONSTRAINT "weekly_grand_discord_id_fkey" FOREIGN KEY (discord_id) REFERENCES users(discord_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'weekly_quests_pkey'
       AND conrelid = 'public.weekly_quests'::regclass
  ) THEN
    ALTER TABLE public."weekly_quests" ADD CONSTRAINT "weekly_quests_pkey" PRIMARY KEY (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'weekly_quests_discord_id_quest_type_quest_week_key'
       AND conrelid = 'public.weekly_quests'::regclass
  ) THEN
    ALTER TABLE public."weekly_quests" ADD CONSTRAINT "weekly_quests_discord_id_quest_type_quest_week_key" UNIQUE (discord_id, quest_type, quest_week);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'weekly_quests_discord_id_fkey'
       AND conrelid = 'public.weekly_quests'::regclass
  ) THEN
    ALTER TABLE public."weekly_quests" ADD CONSTRAINT "weekly_quests_discord_id_fkey" FOREIGN KEY (discord_id) REFERENCES users(discord_id);
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_active_battles_channel ON public.active_battles USING btree (channel_id);
CREATE UNIQUE INDEX IF NOT EXISTS active_casino_sessions_one_active ON public.active_casino_sessions USING btree (discord_id, game) WHERE ((status)::text = ANY ((ARRAY['active'::character varying, 'resolving'::character varying])::text[]));
CREATE INDEX IF NOT EXISTS idx_active_casino_sessions_expiry ON public.active_casino_sessions USING btree (status, expires_at);
CREATE INDEX IF NOT EXISTS idx_active_duel_participants_duel ON public.active_duel_participants USING btree (duel_id);
CREATE INDEX IF NOT EXISTS idx_active_duels_expires_at ON public.active_duels USING btree (expires_at);
CREATE INDEX IF NOT EXISTS active_ranked_fights_expires_at_idx ON public.active_ranked_fights USING btree (expires_at);
CREATE INDEX IF NOT EXISTS idx_armor_roster_mythology ON public.armor_roster USING btree (mythology);
CREATE INDEX IF NOT EXISTS idx_armor_roster_tier ON public.armor_roster USING btree (tier);
CREATE INDEX IF NOT EXISTS idx_boss_attack_spawn ON public.boss_attack_log USING btree (boss_spawn_id);
CREATE INDEX IF NOT EXISTS idx_boss_attack_spawn_damage ON public.boss_attack_log USING btree (boss_spawn_id, total_damage DESC, attacked_at) INCLUDE (discord_id);
CREATE INDEX IF NOT EXISTS idx_casino_logs_player ON public.casino_logs USING btree (discord_id);
CREATE INDEX IF NOT EXISTS idx_casino_logs_player_time ON public.casino_logs USING btree (discord_id, "timestamp" DESC);
CREATE INDEX IF NOT EXISTS idx_catalog_cat_tier ON public.cosmetic_catalog USING btree (category, tier, is_active);
CREATE UNIQUE INDEX IF NOT EXISTS uq_catalog_skin_code ON public.cosmetic_catalog USING btree (skin_code) WHERE (skin_code IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_daily_quests_player_date ON public.daily_quests USING btree (discord_id, quest_date);
CREATE INDEX IF NOT EXISTS idx_deity_roster_mythology ON public.deity_roster USING btree (mythology);
CREATE INDEX IF NOT EXISTS idx_deity_roster_tier ON public.deity_roster USING btree (tier);
CREATE INDEX IF NOT EXISTS idx_game_logs_player ON public.game_logs USING btree (discord_id);
CREATE INDEX IF NOT EXISTS idx_game_logs_player_time ON public.game_logs USING btree (discord_id, "timestamp" DESC);
CREATE INDEX IF NOT EXISTS idx_mob_roster_mythology ON public.mob_roster USING btree (mythology);
CREATE INDEX IF NOT EXISTS idx_mob_roster_type ON public.mob_roster USING btree (mob_type);
CREATE INDEX IF NOT EXISTS idx_pvp_logs_challenger ON public.pvp_logs USING btree (challenger_id);
CREATE INDEX IF NOT EXISTS idx_pvp_logs_opponent ON public.pvp_logs USING btree (opponent_id);
CREATE INDEX IF NOT EXISTS idx_raid_logs_player ON public.raid_logs USING btree (discord_id);
CREATE INDEX IF NOT EXISTS idx_raid_logs_player_time ON public.raid_logs USING btree (discord_id, "timestamp" DESC);
CREATE INDEX IF NOT EXISTS idx_raid_logs_player_type_time_id ON public.raid_logs USING btree (discord_id, battle_type, "timestamp" DESC, id DESC) INCLUDE (result);
CREATE INDEX IF NOT EXISTS idx_ranked_logs_player_time ON public.ranked_logs USING btree (player_id, "timestamp");
CREATE INDEX IF NOT EXISTS idx_ranked_logs_player_time_id_desc ON public.ranked_logs USING btree (player_id, "timestamp" DESC, id DESC) INCLUDE (result);
CREATE INDEX IF NOT EXISTS idx_supporter_grants_discord ON public.supporter_grants USING btree (discord_id);
CREATE INDEX IF NOT EXISTS idx_token_ledger_user ON public.supporter_token_ledger USING btree (discord_id);
CREATE UNIQUE INDEX IF NOT EXISTS supporter_token_ledger_grant_once_key ON public.supporter_token_ledger USING btree (discord_id, reason, ref) WHERE ((delta > 0) AND (ref IS NOT NULL) AND ((reason)::text = ANY ((ARRAY['subscribe_grant'::character varying, 'founder_grant'::character varying, 'monthly_grant'::character varying])::text[])));
CREATE INDEX IF NOT EXISTS idx_supporters_active ON public.supporters USING btree (active);
CREATE INDEX IF NOT EXISTS idx_supporters_expires ON public.supporters USING btree (expires_at) WHERE (expires_at IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS idx_supporters_founder_number ON public.supporters USING btree (founder_number) WHERE (founder_number IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_supporters_tier_status ON public.supporters USING btree (tier, status);
CREATE INDEX IF NOT EXISTS idx_user_armors_owner ON public.user_armors USING btree (discord_id);
CREATE INDEX IF NOT EXISTS idx_user_armors_owner_roster ON public.user_armors USING btree (discord_id, armor_roster_id);
CREATE INDEX IF NOT EXISTS idx_uc_believer_level ON public.user_character USING btree (believer_level DESC);
CREATE INDEX IF NOT EXISTS idx_uc_boss_kills ON public.user_character USING btree (boss_kills DESC);
CREATE INDEX IF NOT EXISTS idx_uc_boss_top_damage ON public.user_character USING btree (boss_top_damage DESC);
CREATE INDEX IF NOT EXISTS idx_uc_combat_level ON public.user_character USING btree (combat_level DESC);
CREATE INDEX IF NOT EXISTS idx_uc_pvp_rating ON public.user_character USING btree (pvp_rating DESC);
CREATE INDEX IF NOT EXISTS idx_uc_pvp_wins ON public.user_character USING btree (pvp_wins DESC);
CREATE INDEX IF NOT EXISTS idx_uc_raids_done ON public.user_character USING btree (((raids_won + raids_lost)) DESC);
CREATE INDEX IF NOT EXISTS idx_uc_raids_won ON public.user_character USING btree (raids_won DESC);
CREATE INDEX IF NOT EXISTS idx_user_character_combat_level ON public.user_character USING btree (combat_level);
CREATE INDEX IF NOT EXISTS idx_user_cosmetics_user ON public.user_cosmetics USING btree (discord_id);
CREATE INDEX IF NOT EXISTS idx_user_deities_owner ON public.user_deities USING btree (discord_id);
CREATE INDEX IF NOT EXISTS idx_user_guild_activity_guild ON public.user_guild_activity USING btree (guild_id, last_active);
CREATE INDEX IF NOT EXISTS idx_user_guild_activity_guild_discord ON public.user_guild_activity USING btree (guild_id, discord_id);
CREATE INDEX IF NOT EXISTS idx_user_runes_owner ON public.user_runes USING btree (discord_id);
CREATE INDEX IF NOT EXISTS idx_user_titles_user ON public.user_titles USING btree (discord_id);
CREATE INDEX IF NOT EXISTS idx_user_weapons_owner ON public.user_weapons USING btree (discord_id);
CREATE INDEX IF NOT EXISTS idx_user_weapons_owner_roster ON public.user_weapons USING btree (discord_id, weapon_roster_id);
CREATE INDEX IF NOT EXISTS idx_users_is_banned ON public.users USING btree (is_banned);
CREATE INDEX IF NOT EXISTS idx_ub_lifetime_credux ON public.users_bag USING btree (lifetime_credux_earned DESC);
CREATE INDEX IF NOT EXISTS idx_ub_valor ON public.users_bag USING btree (valor_medals DESC);
CREATE INDEX IF NOT EXISTS idx_wager_logs_challenger ON public.wager_logs USING btree (challenger_id);
CREATE INDEX IF NOT EXISTS idx_wager_logs_opponent ON public.wager_logs USING btree (opponent_id);
CREATE INDEX IF NOT EXISTS idx_weapon_roster_mythology ON public.weapon_roster USING btree (mythology);
CREATE INDEX IF NOT EXISTS idx_weapon_roster_tier ON public.weapon_roster USING btree (tier);
CREATE INDEX IF NOT EXISTS idx_weekly_quests_user_week ON public.weekly_quests USING btree (discord_id, quest_week);
