--
-- PostgreSQL database dump
--

\restrict R7Lkhr1cdkdChgQGbV5BWmFz7BKIJcIM8AN54Pa3iHJNU8NlUedYWg4N4yU6eOR

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: pg_database_owner
--

CREATE SCHEMA public;


ALTER SCHEMA public OWNER TO pg_database_owner;

--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: pg_database_owner
--

COMMENT ON SCHEMA public IS 'standard public schema';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: active_battles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.active_battles (
    battle_id integer NOT NULL,
    discord_id character varying(20) NOT NULL,
    channel_id character varying(20) NOT NULL,
    message_id character varying(20) NOT NULL,
    battle_type character varying(10) NOT NULL,
    mob_id integer NOT NULL,
    enemy_level smallint,
    player_hp integer NOT NULL,
    player_max_hp integer NOT NULL,
    enemy_hp integer NOT NULL,
    enemy_max_hp integer NOT NULL,
    current_turn smallint DEFAULT 1 NOT NULL,
    player_goes_first boolean NOT NULL,
    active_debuffs jsonb DEFAULT '[]'::jsonb NOT NULL,
    battle_log jsonb DEFAULT '[]'::jsonb NOT NULL,
    overcharge_pct smallint DEFAULT 0 NOT NULL,
    bleed_stacks jsonb DEFAULT '[]'::jsonb NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT active_battles_battle_type_check CHECK (((battle_type)::text = ANY ((ARRAY['raid'::character varying, 'boss'::character varying])::text[])))
);


ALTER TABLE public.active_battles OWNER TO postgres;

--
-- Name: active_battles_battle_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.active_battles_battle_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.active_battles_battle_id_seq OWNER TO postgres;

--
-- Name: active_battles_battle_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.active_battles_battle_id_seq OWNED BY public.active_battles.battle_id;


--
-- Name: active_casino_sessions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.active_casino_sessions (
    session_id uuid NOT NULL,
    discord_id character varying(20) NOT NULL,
    game character varying(20) NOT NULL,
    status character varying(20) NOT NULL,
    bet_amount bigint NOT NULL,
    balance_before bigint NOT NULL,
    balance_after_debit bigint NOT NULL,
    payout bigint,
    balance_after bigint,
    channel_id character varying(20),
    message_id character varying(20),
    state_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT active_casino_sessions_bet_amount_check CHECK ((bet_amount > 0)),
    CONSTRAINT active_casino_sessions_game_check CHECK (((game)::text = ANY ((ARRAY['blackjack'::character varying, 'crash'::character varying])::text[]))),
    CONSTRAINT active_casino_sessions_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'resolving'::character varying, 'settled'::character varying, 'refunded'::character varying, 'expired'::character varying])::text[])))
);


ALTER TABLE public.active_casino_sessions OWNER TO postgres;

--
-- Name: active_duel_participants; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.active_duel_participants (
    discord_id character varying(20) NOT NULL,
    duel_id uuid NOT NULL,
    lock_token uuid NOT NULL,
    role character varying(12) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT active_duel_participants_role_check CHECK (((role)::text = ANY ((ARRAY['challenger'::character varying, 'opponent'::character varying])::text[])))
);


ALTER TABLE public.active_duel_participants OWNER TO postgres;

--
-- Name: active_duels; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.active_duels (
    duel_id uuid DEFAULT gen_random_uuid() NOT NULL,
    lock_token uuid NOT NULL,
    challenger_id character varying(20) NOT NULL,
    opponent_id character varying(20) NOT NULL,
    duel_type character varying(10) NOT NULL,
    stake bigint,
    status character varying(12) NOT NULL,
    guild_id character varying(20),
    channel_id character varying(20),
    message_id character varying(20),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    accepted_at timestamp with time zone,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT active_duels_duel_type_check CHECK (((duel_type)::text = ANY ((ARRAY['casual'::character varying, 'wager'::character varying])::text[]))),
    CONSTRAINT active_duels_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'running'::character varying, 'settling'::character varying])::text[])))
);


ALTER TABLE public.active_duels OWNER TO postgres;

--
-- Name: active_ranked_fights; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.active_ranked_fights (
    discord_id text NOT NULL,
    lock_token text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL
);


ALTER TABLE public.active_ranked_fights OWNER TO postgres;

--
-- Name: armor_roster; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.armor_roster (
    armor_roster_id integer NOT NULL,
    name character varying(100) NOT NULL,
    type character varying(10) NOT NULL,
    tier character varying(10) NOT NULL,
    mythology character varying(20) NOT NULL,
    passive_key character varying(50) NOT NULL,
    passive_name character varying(100) NOT NULL,
    passive_description text NOT NULL,
    lore text,
    image_filename character varying(100),
    is_available boolean DEFAULT true NOT NULL,
    CONSTRAINT armor_roster_tier_check CHECK (((tier)::text = ANY ((ARRAY['Common'::character varying, 'Rare'::character varying, 'Mythic'::character varying, 'Legendary'::character varying, 'Supreme'::character varying])::text[]))),
    CONSTRAINT armor_roster_type_check CHECK (((type)::text = ANY ((ARRAY['Heavy'::character varying, 'Medium'::character varying, 'Light'::character varying])::text[])))
);


ALTER TABLE public.armor_roster OWNER TO postgres;

--
-- Name: armor_roster_armor_roster_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.armor_roster_armor_roster_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.armor_roster_armor_roster_id_seq OWNER TO postgres;

--
-- Name: armor_roster_armor_roster_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.armor_roster_armor_roster_id_seq OWNED BY public.armor_roster.armor_roster_id;


--
-- Name: auto_raids; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.auto_raids (
    discord_id character varying(20) NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    combat_level smallint NOT NULL
);


ALTER TABLE public.auto_raids OWNER TO postgres;

--
-- Name: boss_attack_log; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.boss_attack_log (
    id integer NOT NULL,
    boss_spawn_id uuid NOT NULL,
    guild_id character varying(20) NOT NULL,
    discord_id character varying(20) NOT NULL,
    mob_id integer NOT NULL,
    total_damage bigint DEFAULT 0 NOT NULL,
    attacked_at timestamp with time zone DEFAULT now() NOT NULL,
    last_daily_reset date NOT NULL
);


ALTER TABLE public.boss_attack_log OWNER TO postgres;

--
-- Name: boss_attack_log_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.boss_attack_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.boss_attack_log_id_seq OWNER TO postgres;

--
-- Name: boss_attack_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.boss_attack_log_id_seq OWNED BY public.boss_attack_log.id;


--
-- Name: boss_state; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.boss_state (
    guild_id character varying(20) NOT NULL,
    spawn_id uuid DEFAULT gen_random_uuid() NOT NULL,
    mob_id integer NOT NULL,
    boss_level smallint,
    max_hp bigint NOT NULL,
    current_hp bigint NOT NULL,
    scaled_atk integer NOT NULL,
    scaled_def integer NOT NULL,
    spawn_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    status character varying(10) DEFAULT 'active'::character varying NOT NULL,
    spawn_source character varying(10) DEFAULT 'natural'::character varying NOT NULL,
    last_attack_at timestamp with time zone,
    passive_state jsonb DEFAULT '{}'::jsonb,
    CONSTRAINT boss_state_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'dead'::character varying, 'escaped'::character varying])::text[])))
);


ALTER TABLE public.boss_state OWNER TO postgres;

--
-- Name: boss_spawn_queue; Type: TABLE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.boss_spawn_queue_queue_id_seq
    AS bigint
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE TABLE public.boss_spawn_queue (
    queue_id bigint DEFAULT nextval('boss_spawn_queue_queue_id_seq'::regclass) NOT NULL,
    guild_id character varying(20) NOT NULL,
    boss_name text NOT NULL,
    requested_by character varying(20) NOT NULL,
    status character varying(10) DEFAULT 'pending'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    claim_started_at timestamp with time zone,
    spawned_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    cancelled_by character varying(20),
    spawn_id uuid,
    CONSTRAINT boss_spawn_queue_pkey PRIMARY KEY (queue_id),
    CONSTRAINT boss_spawn_queue_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'spawning'::character varying, 'spawned'::character varying, 'cancelled'::character varying])::text[])))
);

CREATE UNIQUE INDEX boss_spawn_queue_one_live_per_guild
    ON public.boss_spawn_queue USING btree (guild_id)
    WHERE ((status)::text = ANY ((ARRAY['pending'::character varying, 'spawning'::character varying])::text[]));

--
-- Name: casino_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.casino_logs (
    id bigint NOT NULL,
    discord_id character varying(20) NOT NULL,
    game character varying(20) NOT NULL,
    bet_amount bigint NOT NULL,
    result character varying(5) NOT NULL,
    payout bigint NOT NULL,
    balance_before bigint NOT NULL,
    balance_after bigint NOT NULL,
    metadata jsonb,
    "timestamp" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT casino_logs_result_check CHECK (((result)::text = ANY ((ARRAY['win'::character varying, 'loss'::character varying])::text[])))
);


ALTER TABLE public.casino_logs OWNER TO postgres;

--
-- Name: casino_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.casino_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.casino_logs_id_seq OWNER TO postgres;

--
-- Name: casino_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.casino_logs_id_seq OWNED BY public.casino_logs.id;


--
-- Name: cosmetic_catalog; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.cosmetic_catalog (
    cosmetic_id integer NOT NULL,
    cosmetic_key character varying(80) NOT NULL,
    category character varying(16) NOT NULL,
    tier character varying(16) NOT NULL,
    display_name character varying(80) NOT NULL,
    token_cost integer DEFAULT 0 NOT NULL,
    is_base boolean DEFAULT false NOT NULL,
    has_top_label boolean DEFAULT false NOT NULL,
    display_filename character varying(120),
    render_filename character varying(120),
    victory_filename character varying(120),
    defeated_filename character varying(120),
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    skin_code character varying(8),
    CONSTRAINT cosmetic_catalog_category_check CHECK (((category)::text = ANY ((ARRAY['profile'::character varying, 'battle'::character varying, 'battle_result'::character varying, 'summon'::character varying])::text[]))),
    CONSTRAINT cosmetic_catalog_tier_check CHECK (((tier)::text = ANY ((ARRAY['believer'::character varying, 'chosen'::character varying, 'eternal'::character varying])::text[]))),
    CONSTRAINT cosmetic_catalog_token_cost_check CHECK ((token_cost >= 0))
);


ALTER TABLE public.cosmetic_catalog OWNER TO postgres;

--
-- Name: cosmetic_catalog_cosmetic_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.cosmetic_catalog_cosmetic_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.cosmetic_catalog_cosmetic_id_seq OWNER TO postgres;

--
-- Name: cosmetic_catalog_cosmetic_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.cosmetic_catalog_cosmetic_id_seq OWNED BY public.cosmetic_catalog.cosmetic_id;


--
-- Name: daily_quests; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.daily_quests (
    id integer NOT NULL,
    discord_id character varying(20) NOT NULL,
    quest_type character varying(30) NOT NULL,
    target_count smallint NOT NULL,
    current_count smallint DEFAULT 0 NOT NULL,
    reward_credux integer NOT NULL,
    reward_belief_shards smallint NOT NULL,
    completed boolean DEFAULT false NOT NULL,
    quest_date date NOT NULL
);


ALTER TABLE public.daily_quests OWNER TO postgres;

--
-- Name: daily_quests_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.daily_quests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.daily_quests_id_seq OWNER TO postgres;

--
-- Name: daily_quests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.daily_quests_id_seq OWNED BY public.daily_quests.id;


--
-- Name: deity_roster; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.deity_roster (
    deity_id integer NOT NULL,
    name character varying(100) NOT NULL,
    mythology character varying(20) NOT NULL,
    tier character varying(10) NOT NULL,
    base_hp integer NOT NULL,
    base_atk integer NOT NULL,
    base_def integer NOT NULL,
    blessing_key character varying(50) NOT NULL,
    blessing_name character varying(100) NOT NULL,
    blessing_description text NOT NULL,
    lore text,
    image_filename character varying(100),
    is_available boolean DEFAULT true NOT NULL,
    blessing_scaling character varying(10) DEFAULT 'scalable'::character varying NOT NULL,
    CONSTRAINT deity_roster_blessing_scaling_check CHECK (((blessing_scaling)::text = ANY ((ARRAY['scalable'::character varying, 'binary'::character varying])::text[]))),
    CONSTRAINT deity_roster_tier_check CHECK (((tier)::text = ANY ((ARRAY['Epic'::character varying, 'Mythic'::character varying, 'Legendary'::character varying, 'Supreme'::character varying])::text[])))
);


ALTER TABLE public.deity_roster OWNER TO postgres;

--
-- Name: deity_roster_deity_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.deity_roster_deity_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.deity_roster_deity_id_seq OWNER TO postgres;

--
-- Name: deity_roster_deity_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.deity_roster_deity_id_seq OWNED BY public.deity_roster.deity_id;


--
-- Name: dev_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.dev_logs (
    id bigint NOT NULL,
    dev_id character varying(20) NOT NULL,
    action_type character varying(30) NOT NULL,
    target_discord_id character varying(20) NOT NULL,
    amount_or_detail character varying(200),
    pre_reset_snapshot jsonb,
    "timestamp" timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.dev_logs OWNER TO postgres;

--
-- Name: dev_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.dev_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.dev_logs_id_seq OWNER TO postgres;

--
-- Name: dev_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.dev_logs_id_seq OWNED BY public.dev_logs.id;


--
-- Name: equipped_skins; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.equipped_skins (
    discord_id character varying(20) NOT NULL,
    category character varying(16) NOT NULL,
    cosmetic_id integer,
    override_path character varying(200),
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT equipped_skins_category_check CHECK (((category)::text = ANY ((ARRAY['profile'::character varying, 'battle'::character varying, 'battle_result'::character varying, 'summon'::character varying])::text[])))
);


ALTER TABLE public.equipped_skins OWNER TO postgres;

--
-- Name: essence_bag_def; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.essence_bag_def (
    bag_key character varying(20) NOT NULL,
    open_command character varying(10) NOT NULL,
    essence_tier character varying(10) NOT NULL,
    essence_cost integer NOT NULL,
    credux_cost bigint NOT NULL,
    rune_pool jsonb NOT NULL
);


ALTER TABLE public.essence_bag_def OWNER TO postgres;

--
-- Name: game_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.game_logs (
    id bigint NOT NULL,
    discord_id character varying(20) NOT NULL,
    action character varying(30) NOT NULL,
    item_type character varying(30),
    previous_credux bigint,
    updated_credux bigint,
    previous_belief_shards integer,
    updated_belief_shards integer,
    previous_chest_count integer,
    updated_chest_count integer,
    previous_relic_count integer,
    updated_relic_count integer,
    previous_essence_count integer,
    updated_essence_count integer,
    "timestamp" timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.game_logs OWNER TO postgres;

--
-- Name: game_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.game_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.game_logs_id_seq OWNER TO postgres;

--
-- Name: game_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.game_logs_id_seq OWNED BY public.game_logs.id;


--
-- Name: mob_roster; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.mob_roster (
    mob_id integer NOT NULL,
    name character varying(100) NOT NULL,
    mythology character varying(20) NOT NULL,
    mob_type character varying(10) NOT NULL,
    base_hp integer NOT NULL,
    base_atk integer NOT NULL,
    base_def integer NOT NULL,
    base_crit numeric(4,1) NOT NULL,
    hp_per_level integer DEFAULT 0 NOT NULL,
    atk_per_level integer DEFAULT 0 NOT NULL,
    def_per_level integer DEFAULT 0 NOT NULL,
    skill_key character varying(50) NOT NULL,
    skill_name character varying(100) NOT NULL,
    skill_description text NOT NULL,
    immunity_tags jsonb DEFAULT '[]'::jsonb NOT NULL,
    special_flags jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT mob_roster_mob_type_check CHECK (((mob_type)::text = ANY ((ARRAY['regular'::character varying, 'elite'::character varying, 'boss'::character varying])::text[])))
);


ALTER TABLE public.mob_roster OWNER TO postgres;

--
-- Name: mob_roster_mob_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.mob_roster_mob_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.mob_roster_mob_id_seq OWNER TO postgres;

--
-- Name: mob_roster_mob_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.mob_roster_mob_id_seq OWNED BY public.mob_roster.mob_id;


--
-- Name: pity_counters; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.pity_counters (
    discord_id character varying(20) NOT NULL,
    pity_count smallint DEFAULT 0 NOT NULL
);


ALTER TABLE public.pity_counters OWNER TO postgres;

--
-- Name: pvp_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.pvp_logs (
    id bigint NOT NULL,
    duel_id uuid,
    challenger_id character varying(20) NOT NULL,
    opponent_id character varying(20) NOT NULL,
    winner_id character varying(20) NOT NULL,
    challenger_damage integer NOT NULL,
    opponent_damage integer NOT NULL,
    "timestamp" timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.pvp_logs OWNER TO postgres;

CREATE UNIQUE INDEX pvp_logs_duel_id_key ON public.pvp_logs USING btree (duel_id);

CREATE TABLE public.essence_exchange_submissions (
    submission_id character varying(64) PRIMARY KEY,
    discord_id character varying(20) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.essence_exchange_submissions OWNER TO postgres;
ALTER TABLE public.essence_exchange_submissions ENABLE ROW LEVEL SECURITY;
CREATE INDEX essence_exchange_submissions_created_at_idx ON public.essence_exchange_submissions USING btree (created_at);

--
-- Name: pvp_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.pvp_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.pvp_logs_id_seq OWNER TO postgres;

--
-- Name: pvp_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.pvp_logs_id_seq OWNED BY public.pvp_logs.id;


--
-- Name: pvp_shop_purchases; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.pvp_shop_purchases (
    discord_id character varying(20) NOT NULL,
    season_id integer NOT NULL,
    item_key character varying(30) NOT NULL,
    qty integer DEFAULT 0 NOT NULL
);


ALTER TABLE public.pvp_shop_purchases OWNER TO postgres;

--
-- Name: raid_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.raid_logs (
    id bigint NOT NULL,
    discord_id character varying(20) NOT NULL,
    battle_type character varying(10) NOT NULL,
    enemy_name character varying(100) NOT NULL,
    enemy_tier character varying(10) NOT NULL,
    result character varying(5) NOT NULL,
    exp_earned integer DEFAULT 0 NOT NULL,
    updated_exp bigint NOT NULL,
    belief_shards_dropped smallint DEFAULT 0 NOT NULL,
    updated_belief_shards integer NOT NULL,
    credux_earned integer DEFAULT 0 NOT NULL,
    updated_credux bigint NOT NULL,
    chest_dropped character varying(30),
    "timestamp" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT raid_logs_enemy_tier_check CHECK (((enemy_tier)::text = ANY ((ARRAY['regular'::character varying, 'elite'::character varying, 'boss'::character varying])::text[]))),
    CONSTRAINT raid_logs_result_check CHECK (((result)::text = ANY ((ARRAY['win'::character varying, 'loss'::character varying])::text[])))
);


ALTER TABLE public.raid_logs OWNER TO postgres;

--
-- Name: raid_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.raid_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.raid_logs_id_seq OWNER TO postgres;

--
-- Name: raid_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.raid_logs_id_seq OWNED BY public.raid_logs.id;


--
-- Name: ranked_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ranked_logs (
    id bigint NOT NULL,
    player_id character varying(20) NOT NULL,
    opponent_id character varying(20) NOT NULL,
    result character varying(4) NOT NULL,
    rating_before integer NOT NULL,
    rating_after integer NOT NULL,
    "timestamp" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ranked_logs_result_check CHECK (((result)::text = ANY ((ARRAY['win'::character varying, 'loss'::character varying])::text[])))
);


ALTER TABLE public.ranked_logs OWNER TO postgres;

--
-- Name: ranked_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.ranked_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.ranked_logs_id_seq OWNER TO postgres;

--
-- Name: ranked_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.ranked_logs_id_seq OWNED BY public.ranked_logs.id;


--
-- Name: ranked_reward; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ranked_reward (
    bracket character varying(10) NOT NULL,
    weekly_credux bigint DEFAULT 0 NOT NULL,
    weekly_payload jsonb DEFAULT '[]'::jsonb NOT NULL,
    season_end_payload jsonb DEFAULT '[]'::jsonb NOT NULL,
    weekly_valor integer DEFAULT 0 NOT NULL,
    season_valor integer DEFAULT 0 NOT NULL,
    CONSTRAINT ranked_reward_bracket_check CHECK (((bracket)::text = ANY ((ARRAY['Mortal'::character varying, 'Champion'::character varying, 'Demigod'::character varying, 'Ascendant'::character varying, 'Divine'::character varying])::text[])))
);


ALTER TABLE public.ranked_reward OWNER TO postgres;

--
-- Name: rune_roster; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.rune_roster (
    rune_id integer NOT NULL,
    name character varying(50) NOT NULL,
    lane character varying(10) NOT NULL,
    effect_key character varying(50) NOT NULL,
    tier character varying(10) NOT NULL,
    value numeric(6,2) NOT NULL,
    description text NOT NULL,
    is_available boolean DEFAULT true NOT NULL,
    CONSTRAINT rune_roster_lane_check CHECK (((lane)::text = ANY ((ARRAY['offense'::character varying, 'defense'::character varying])::text[]))),
    CONSTRAINT rune_roster_tier_check CHECK (((tier)::text = ANY ((ARRAY['Common'::character varying, 'Rare'::character varying, 'Mythic'::character varying, 'Legendary'::character varying, 'Supreme'::character varying])::text[])))
);


ALTER TABLE public.rune_roster OWNER TO postgres;

--
-- Name: rune_roster_rune_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.rune_roster_rune_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.rune_roster_rune_id_seq OWNER TO postgres;

--
-- Name: rune_roster_rune_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.rune_roster_rune_id_seq OWNED BY public.rune_roster.rune_id;


--
-- Name: seasons; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.seasons (
    season_id integer NOT NULL,
    name character varying(50) NOT NULL,
    theme character varying(50),
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    featured_deity_id integer,
    is_active boolean DEFAULT false NOT NULL
);


ALTER TABLE public.seasons OWNER TO postgres;

--
-- Name: seasons_season_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.seasons_season_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.seasons_season_id_seq OWNER TO postgres;

--
-- Name: seasons_season_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.seasons_season_id_seq OWNED BY public.seasons.season_id;


--
-- Name: server_config; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.server_config (
    guild_id character varying(20) NOT NULL,
    prefix character varying(5) DEFAULT 'crd'::character varying NOT NULL,
    announcement_channel_id character varying(20),
    boss_announcement_channel_id character varying(20),
    bot_channel_id character varying(20),
    configured_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.server_config OWNER TO postgres;

--
-- Name: socket_unlock_cost; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.socket_unlock_cost (
    tier character varying(10) NOT NULL,
    slot_index smallint NOT NULL,
    essence_tier character varying(10) NOT NULL,
    essence_cost integer NOT NULL,
    credux_cost bigint NOT NULL,
    CONSTRAINT socket_unlock_cost_tier_check CHECK (((tier)::text = ANY ((ARRAY['Mythic'::character varying, 'Legendary'::character varying, 'Supreme'::character varying])::text[])))
);


ALTER TABLE public.socket_unlock_cost OWNER TO postgres;

--
-- Name: stripe_events; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.stripe_events (
    event_id character varying(64) NOT NULL,
    type character varying(48) NOT NULL,
    processed_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.stripe_events OWNER TO postgres;

--
-- Name: supporter_founder_number_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.supporter_founder_number_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.supporter_founder_number_seq OWNER TO postgres;

--
-- Name: supporter_item_grants; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.supporter_item_grants (
    grant_id bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL,
    discord_id character varying(20) NOT NULL,
    item_key character varying(32) NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    grant_reason character varying(32) NOT NULL,
    grant_ref character varying(100) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT supporter_item_grants_pkey PRIMARY KEY (grant_id),
    CONSTRAINT supporter_item_grants_item_key_check CHECK (((item_key)::text = 'custom_deity_token'::text)),
    CONSTRAINT supporter_item_grants_quantity_check CHECK (quantity > 0),
    CONSTRAINT supporter_item_grants_idempotency_key UNIQUE (discord_id, item_key, grant_reason, grant_ref)
);

ALTER TABLE public.supporter_item_grants OWNER TO postgres;

--
-- Name: supporter_grants; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.supporter_grants (
    id bigint NOT NULL,
    discord_id character varying(20) NOT NULL,
    action character varying(12) NOT NULL,
    tier character varying(20),
    months smallint,
    paypal_ref character varying(100),
    granted_by character varying(20) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT supporter_grants_action_check CHECK (((action)::text = ANY ((ARRAY['grant'::character varying, 'extend'::character varying, 'revoke'::character varying])::text[])))
);


ALTER TABLE public.supporter_grants OWNER TO postgres;

--
-- Name: supporter_grants_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.supporter_grants_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.supporter_grants_id_seq OWNER TO postgres;

--
-- Name: supporter_grants_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.supporter_grants_id_seq OWNED BY public.supporter_grants.id;


--
-- Name: supporter_token_ledger; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.supporter_token_ledger (
    entry_id bigint NOT NULL,
    discord_id character varying(20) NOT NULL,
    delta integer NOT NULL,
    reason character varying(32) NOT NULL,
    ref character varying(64),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.supporter_token_ledger OWNER TO postgres;

--
-- Name: supporter_token_ledger_entry_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.supporter_token_ledger_entry_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.supporter_token_ledger_entry_id_seq OWNER TO postgres;

--
-- Name: supporter_token_ledger_entry_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.supporter_token_ledger_entry_id_seq OWNED BY public.supporter_token_ledger.entry_id;


--
-- Name: supporters; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.supporters (
    discord_id character varying(20) NOT NULL,
    tier character varying(16) NOT NULL,
    status character varying(16) DEFAULT 'active'::character varying NOT NULL,
    current_period_end timestamp with time zone,
    founder_number integer,
    founder_purchased_at timestamp with time zone,
    cancel_at_period_end boolean DEFAULT false NOT NULL,
    token_balance integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    active boolean DEFAULT true NOT NULL,
    founding_supporter boolean DEFAULT false NOT NULL,
    granted_by character varying(20),
    subscribed_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    CONSTRAINT supporters_founder_number_check CHECK (((founder_number >= 1) AND (founder_number <= 50))),
    CONSTRAINT supporters_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'past_due'::character varying, 'canceled'::character varying, 'expired'::character varying])::text[]))),
    CONSTRAINT supporters_tier_check CHECK (((tier)::text = ANY ((ARRAY['believer'::character varying, 'chosen_believer'::character varying, 'eternal_believer'::character varying])::text[]))),
    CONSTRAINT supporters_token_balance_check CHECK ((token_balance >= 0))
);


ALTER TABLE public.supporters OWNER TO postgres;

--
-- Name: tickets; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.tickets (
    ticket_id text NOT NULL,
    type text NOT NULL,
    user_id character varying(20) NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    completed_by character varying(20),
    notes text,
    CONSTRAINT tickets_pkey PRIMARY KEY (ticket_id),
    CONSTRAINT tickets_type_check CHECK (type = ANY (ARRAY['avatar'::text, 'deity'::text])),
    CONSTRAINT tickets_status_check CHECK (status = ANY (ARRAY['queued'::text, 'in_progress'::text, 'done'::text]))
);

ALTER TABLE public.tickets OWNER TO postgres;

--
-- Name: title_catalog; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.title_catalog (
    title_id integer NOT NULL,
    code character varying(40) NOT NULL,
    display character varying(60) NOT NULL,
    source character varying(20) NOT NULL,
    is_repeatable boolean DEFAULT true NOT NULL,
    how_to character varying(160),
    image_filename character varying(100),
    CONSTRAINT title_catalog_source_check CHECK (((source)::text = ANY ((ARRAY['believer'::character varying, 'rank_season'::character varying, 'boss_feat'::character varying, 'collection'::character varying, 'event'::character varying])::text[])))
);


ALTER TABLE public.title_catalog OWNER TO postgres;

--
-- Name: title_catalog_title_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.title_catalog_title_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.title_catalog_title_id_seq OWNER TO postgres;

--
-- Name: title_catalog_title_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.title_catalog_title_id_seq OWNED BY public.title_catalog.title_id;


--
-- Name: user_armors; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_armors (
    discord_id character varying(20) NOT NULL,
    armor_id character varying(8) NOT NULL,
    armor_roster_id integer NOT NULL,
    curr_hp integer NOT NULL,
    curr_def integer NOT NULL,
    enhancement smallint DEFAULT 1 NOT NULL,
    base_hp integer NOT NULL,
    base_def integer NOT NULL,
    native_sockets jsonb DEFAULT '[]'::jsonb NOT NULL,
    opposite_sockets jsonb DEFAULT '[]'::jsonb NOT NULL,
    is_locked boolean DEFAULT false NOT NULL,
    obtained_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_armors_enhancement_check CHECK (((enhancement >= 1) AND (enhancement <= 11)))
);


ALTER TABLE public.user_armors OWNER TO postgres;

--
-- Name: user_character; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_character (
    discord_id character varying(20) NOT NULL,
    class character varying(20) NOT NULL,
    combat_level smallint DEFAULT 1 NOT NULL,
    combat_exp bigint DEFAULT 0 NOT NULL,
    active_preset_slot smallint DEFAULT 1 NOT NULL,
    highest_raid_streak integer DEFAULT 0 NOT NULL,
    highest_rank_streak integer DEFAULT 0 NOT NULL,
    equipped_weapon_id character varying(8),
    active_deity_id integer,
    raids_won integer DEFAULT 0 NOT NULL,
    raids_lost integer DEFAULT 0 NOT NULL,
    pvp_wins integer DEFAULT 0 NOT NULL,
    pvp_losses integer DEFAULT 0 NOT NULL,
    believer_level integer DEFAULT 1 NOT NULL,
    believer_exp bigint DEFAULT 0 NOT NULL,
    reputation_exp_today integer DEFAULT 0 NOT NULL,
    reputation_exp_reset_date date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    equipped_armor_id character varying(8),
    active_deity_id_2 integer,
    active_deity_id_3 integer,
    pvp_rating integer DEFAULT 1000 NOT NULL,
    boss_kills integer DEFAULT 0 NOT NULL,
    equipped_title_id integer,
    active_echo_deity_id integer,
    pvp_peak integer DEFAULT 1000 NOT NULL,
    last_weekly_claim_week integer,
    pvp_demotion_shield boolean DEFAULT true NOT NULL,
    boss_top_damage bigint DEFAULT 0 NOT NULL,
    CONSTRAINT user_character_class_check CHECK (((class)::text = ANY ((ARRAY['Swordsman'::character varying, 'Fighter'::character varying, 'Mage'::character varying, 'Knight'::character varying, 'Archer'::character varying])::text[]))),
    CONSTRAINT user_character_combat_level_check CHECK (((combat_level >= 1) AND (combat_level <= 50))),
    CONSTRAINT user_character_active_preset_slot_check CHECK (active_preset_slot = ANY (ARRAY[1, 2])),
    CONSTRAINT user_character_highest_raid_streak_check CHECK (highest_raid_streak >= 0),
    CONSTRAINT user_character_highest_rank_streak_check CHECK (highest_rank_streak >= 0)
);

-- Monthsary Phase 2 A: preset-local deity/equipment source. Legacy loadout
-- columns above remain until 20260803_05 is deployed.
CREATE TABLE public.user_presets (
    id bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL,
    discord_id character varying(20) NOT NULL,
    slot smallint NOT NULL,
    name character varying(32),
    equipped_deity_1_id integer,
    equipped_deity_2_id integer,
    equipped_deity_3_id integer,
    equipped_echo_deity_id integer,
    equipped_armor_id character varying(8),
    equipped_weapon_id character varying(8),
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_presets_pkey PRIMARY KEY (id),
    CONSTRAINT user_presets_slot_check CHECK (slot = ANY (ARRAY[1, 2])),
    CONSTRAINT user_presets_discord_slot_key UNIQUE (discord_id, slot),
    CONSTRAINT user_presets_echo_source_check CHECK (
      equipped_echo_deity_id IS NULL
      OR equipped_echo_deity_id IS NOT DISTINCT FROM equipped_deity_2_id
      OR equipped_echo_deity_id IS NOT DISTINCT FROM equipped_deity_3_id
    )
);
ALTER TABLE public.user_presets OWNER TO postgres;
ALTER TABLE public.user_presets ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_user_presets_discord_id ON public.user_presets(discord_id);


ALTER TABLE public.user_character OWNER TO postgres;

--
-- Name: user_cosmetics; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_cosmetics (
    discord_id character varying(20) NOT NULL,
    cosmetic_id integer NOT NULL,
    source character varying(16) NOT NULL,
    acquired_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_cosmetics_source_check CHECK (((source)::text = ANY ((ARRAY['base'::character varying, 'shop'::character varying, 'founder'::character varying, 'grant'::character varying])::text[])))
);


ALTER TABLE public.user_cosmetics OWNER TO postgres;

--
-- Name: user_deities; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_deities (
    user_deity_id integer NOT NULL,
    discord_id character varying(20) NOT NULL,
    deity_id integer NOT NULL,
    curr_atk integer NOT NULL,
    curr_hp integer NOT NULL,
    curr_def integer NOT NULL,
    enhancement smallint DEFAULT 1 NOT NULL,
    obtained_at timestamp with time zone DEFAULT now() NOT NULL,
    last_pull_date date NOT NULL,
    CONSTRAINT user_deities_enhancement_check CHECK (((enhancement >= 1) AND (enhancement <= 11)))
);


ALTER TABLE public.user_deities OWNER TO postgres;

--
-- Name: user_deities_user_deity_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.user_deities_user_deity_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.user_deities_user_deity_id_seq OWNER TO postgres;

--
-- Name: user_deities_user_deity_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.user_deities_user_deity_id_seq OWNED BY public.user_deities.user_deity_id;


--
-- Name: user_guild_activity; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_guild_activity (
    discord_id character varying(20) NOT NULL,
    guild_id character varying(20) NOT NULL,
    last_active timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.user_guild_activity OWNER TO postgres;

--
-- Name: user_runes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_runes (
    rune_uid character varying(8) NOT NULL,
    discord_id character varying(20) NOT NULL,
    rune_id integer NOT NULL,
    socketed_into character varying(8),
    is_locked boolean DEFAULT false NOT NULL,
    obtained_at timestamp with time zone DEFAULT now() NOT NULL,
    rolled_value numeric
);


ALTER TABLE public.user_runes OWNER TO postgres;

--
-- Name: user_titles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_titles (
    discord_id character varying(20) NOT NULL,
    title_id integer NOT NULL,
    earned_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.user_titles OWNER TO postgres;

--
-- Name: user_weapons; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_weapons (
    discord_id character varying(20) NOT NULL,
    weapon_id character varying(8) NOT NULL,
    weapon_roster_id integer NOT NULL,
    curr_atk integer NOT NULL,
    enhancement smallint DEFAULT 1 NOT NULL,
    base_atk integer NOT NULL,
    crit numeric(4,1) NOT NULL,
    bonus_dmg_pct numeric(5,2),
    is_locked boolean DEFAULT false NOT NULL,
    obtained_at timestamp with time zone DEFAULT now() NOT NULL,
    native_sockets jsonb DEFAULT '[]'::jsonb NOT NULL,
    opposite_sockets jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT user_weapons_enhancement_check CHECK (((enhancement >= 1) AND (enhancement <= 11)))
);


ALTER TABLE public.user_weapons OWNER TO postgres;

--
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    discord_id character varying(20) NOT NULL,
    username character varying(100) NOT NULL,
    monthly_streak smallint DEFAULT 0 NOT NULL,
    overall_streak integer DEFAULT 0 NOT NULL,
    last_daily_claim_date date,
    last_bestow_received date,
    bestow_received_today bigint DEFAULT 0 NOT NULL,
    last_boss_attack_date date,
    is_banned boolean DEFAULT false NOT NULL,
    registered_at timestamp with time zone DEFAULT now() NOT NULL,
    quest_refreshes_today smallint DEFAULT 0 NOT NULL,
    last_quest_refresh_date date
);


ALTER TABLE public.users OWNER TO postgres;

--
-- Name: users_bag; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users_bag (
    discord_id character varying(20) NOT NULL,
    credux bigint DEFAULT 0 NOT NULL,
    belief_shards integer DEFAULT 0 NOT NULL,
    sacred_relics integer DEFAULT 0 NOT NULL,
    supreme_relics integer DEFAULT 0 NOT NULL,
    silver_chest integer DEFAULT 0 NOT NULL,
    gold_chest integer DEFAULT 0 NOT NULL,
    boss_treasure_chest integer DEFAULT 0 NOT NULL,
    boss_golden_chest integer DEFAULT 0 NOT NULL,
    supreme_chest integer DEFAULT 0 NOT NULL,
    epic_essence integer DEFAULT 0 NOT NULL,
    mythic_essence integer DEFAULT 0 NOT NULL,
    legendary_essence integer DEFAULT 0 NOT NULL,
    supreme_essence integer DEFAULT 0 NOT NULL,
    lifetime_credux_earned bigint DEFAULT 0 NOT NULL,
    lesser_rune_bag integer DEFAULT 0 NOT NULL,
    greater_rune_bag integer DEFAULT 0 NOT NULL,
    divine_rune_bag integer DEFAULT 0 NOT NULL,
    valor_medals bigint DEFAULT 0 NOT NULL,
    custom_avatar_token integer DEFAULT 0 NOT NULL,
    custom_deity_token integer DEFAULT 0 NOT NULL,
    CONSTRAINT users_bag_custom_avatar_token_check CHECK (custom_avatar_token >= 0),
    CONSTRAINT users_bag_custom_deity_token_check CHECK (custom_deity_token >= 0)
);


ALTER TABLE public.users_bag OWNER TO postgres;

--
-- Name: wager_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.wager_logs (
    id bigint NOT NULL,
    challenger_id character varying(20) NOT NULL,
    opponent_id character varying(20) NOT NULL,
    winner_id character varying(20) NOT NULL,
    amount bigint NOT NULL,
    "timestamp" timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.wager_logs OWNER TO postgres;

--
-- Name: wager_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.wager_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.wager_logs_id_seq OWNER TO postgres;

--
-- Name: wager_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.wager_logs_id_seq OWNED BY public.wager_logs.id;


--
-- Name: weapon_roster; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.weapon_roster (
    weapon_roster_id integer NOT NULL,
    name character varying(100) NOT NULL,
    type character varying(10) NOT NULL,
    tier character varying(10) NOT NULL,
    mythology character varying(20) NOT NULL,
    passive_key character varying(50) NOT NULL,
    passive_name character varying(100) NOT NULL,
    passive_description text NOT NULL,
    lore text,
    image_filename character varying(100),
    is_available boolean DEFAULT true NOT NULL,
    CONSTRAINT weapon_roster_tier_check CHECK (((tier)::text = ANY ((ARRAY['Common'::character varying, 'Rare'::character varying, 'Mythic'::character varying, 'Legendary'::character varying, 'Supreme'::character varying])::text[]))),
    CONSTRAINT weapon_roster_type_check CHECK (((type)::text = ANY ((ARRAY['Sword'::character varying, 'Staff'::character varying, 'Gloves'::character varying, 'Bow'::character varying])::text[])))
);


ALTER TABLE public.weapon_roster OWNER TO postgres;

--
-- Name: weapon_roster_weapon_roster_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.weapon_roster_weapon_roster_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.weapon_roster_weapon_roster_id_seq OWNER TO postgres;

--
-- Name: weapon_roster_weapon_roster_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.weapon_roster_weapon_roster_id_seq OWNED BY public.weapon_roster.weapon_roster_id;


--
-- Name: weekly_grand; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.weekly_grand (
    discord_id character varying(20) NOT NULL,
    quest_week integer NOT NULL,
    claimed boolean DEFAULT false NOT NULL
);


ALTER TABLE public.weekly_grand OWNER TO postgres;

--
-- Name: weekly_quests; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.weekly_quests (
    id integer NOT NULL,
    discord_id character varying(20) NOT NULL,
    quest_type character varying(30) NOT NULL,
    target_count integer NOT NULL,
    current_count integer DEFAULT 0 NOT NULL,
    reward_credux integer NOT NULL,
    reward_valor integer NOT NULL,
    completed boolean DEFAULT false NOT NULL,
    quest_week integer NOT NULL
);


ALTER TABLE public.weekly_quests OWNER TO postgres;

--
-- Name: weekly_quests_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.weekly_quests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.weekly_quests_id_seq OWNER TO postgres;

--
-- Name: weekly_quests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.weekly_quests_id_seq OWNED BY public.weekly_quests.id;


--
-- Name: active_battles battle_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.active_battles ALTER COLUMN battle_id SET DEFAULT nextval('public.active_battles_battle_id_seq'::regclass);


--
-- Name: armor_roster armor_roster_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.armor_roster ALTER COLUMN armor_roster_id SET DEFAULT nextval('public.armor_roster_armor_roster_id_seq'::regclass);


--
-- Name: boss_attack_log id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.boss_attack_log ALTER COLUMN id SET DEFAULT nextval('public.boss_attack_log_id_seq'::regclass);


--
-- Name: casino_logs id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.casino_logs ALTER COLUMN id SET DEFAULT nextval('public.casino_logs_id_seq'::regclass);


--
-- Name: cosmetic_catalog cosmetic_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cosmetic_catalog ALTER COLUMN cosmetic_id SET DEFAULT nextval('public.cosmetic_catalog_cosmetic_id_seq'::regclass);


--
-- Name: daily_quests id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.daily_quests ALTER COLUMN id SET DEFAULT nextval('public.daily_quests_id_seq'::regclass);


--
-- Name: deity_roster deity_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.deity_roster ALTER COLUMN deity_id SET DEFAULT nextval('public.deity_roster_deity_id_seq'::regclass);


--
-- Name: dev_logs id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.dev_logs ALTER COLUMN id SET DEFAULT nextval('public.dev_logs_id_seq'::regclass);


--
-- Name: game_logs id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.game_logs ALTER COLUMN id SET DEFAULT nextval('public.game_logs_id_seq'::regclass);


--
-- Name: mob_roster mob_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mob_roster ALTER COLUMN mob_id SET DEFAULT nextval('public.mob_roster_mob_id_seq'::regclass);


--
-- Name: pvp_logs id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pvp_logs ALTER COLUMN id SET DEFAULT nextval('public.pvp_logs_id_seq'::regclass);


--
-- Name: raid_logs id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.raid_logs ALTER COLUMN id SET DEFAULT nextval('public.raid_logs_id_seq'::regclass);


--
-- Name: ranked_logs id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ranked_logs ALTER COLUMN id SET DEFAULT nextval('public.ranked_logs_id_seq'::regclass);


--
-- Name: rune_roster rune_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rune_roster ALTER COLUMN rune_id SET DEFAULT nextval('public.rune_roster_rune_id_seq'::regclass);


--
-- Name: seasons season_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.seasons ALTER COLUMN season_id SET DEFAULT nextval('public.seasons_season_id_seq'::regclass);


--
-- Name: supporter_grants id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.supporter_grants ALTER COLUMN id SET DEFAULT nextval('public.supporter_grants_id_seq'::regclass);


--
-- Name: supporter_token_ledger entry_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.supporter_token_ledger ALTER COLUMN entry_id SET DEFAULT nextval('public.supporter_token_ledger_entry_id_seq'::regclass);


--
-- Name: title_catalog title_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.title_catalog ALTER COLUMN title_id SET DEFAULT nextval('public.title_catalog_title_id_seq'::regclass);


--
-- Name: user_deities user_deity_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_deities ALTER COLUMN user_deity_id SET DEFAULT nextval('public.user_deities_user_deity_id_seq'::regclass);


--
-- Name: wager_logs id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.wager_logs ALTER COLUMN id SET DEFAULT nextval('public.wager_logs_id_seq'::regclass);


--
-- Name: weapon_roster weapon_roster_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.weapon_roster ALTER COLUMN weapon_roster_id SET DEFAULT nextval('public.weapon_roster_weapon_roster_id_seq'::regclass);


--
-- Name: weekly_quests id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.weekly_quests ALTER COLUMN id SET DEFAULT nextval('public.weekly_quests_id_seq'::regclass);


--
-- Name: active_battles active_battles_discord_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.active_battles
    ADD CONSTRAINT active_battles_discord_id_key UNIQUE (discord_id);


--
-- Name: active_battles active_battles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.active_battles
    ADD CONSTRAINT active_battles_pkey PRIMARY KEY (battle_id);


--
-- Name: active_casino_sessions active_casino_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.active_casino_sessions
    ADD CONSTRAINT active_casino_sessions_pkey PRIMARY KEY (session_id);


--
-- Name: active_duel_participants active_duel_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.active_duel_participants
    ADD CONSTRAINT active_duel_participants_pkey PRIMARY KEY (discord_id);


--
-- Name: active_duels active_duels_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.active_duels
    ADD CONSTRAINT active_duels_pkey PRIMARY KEY (duel_id);


--
-- Name: active_ranked_fights active_ranked_fights_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.active_ranked_fights
    ADD CONSTRAINT active_ranked_fights_pkey PRIMARY KEY (discord_id);


--
-- Name: armor_roster armor_roster_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.armor_roster
    ADD CONSTRAINT armor_roster_pkey PRIMARY KEY (armor_roster_id);


--
-- Name: auto_raids auto_raids_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.auto_raids
    ADD CONSTRAINT auto_raids_pkey PRIMARY KEY (discord_id);


--
-- Name: boss_attack_log boss_attack_log_boss_spawn_id_discord_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.boss_attack_log
    ADD CONSTRAINT boss_attack_log_boss_spawn_id_discord_id_key UNIQUE (boss_spawn_id, discord_id);


--
-- Name: boss_attack_log boss_attack_log_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.boss_attack_log
    ADD CONSTRAINT boss_attack_log_pkey PRIMARY KEY (id);


--
-- Name: boss_state boss_state_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.boss_state
    ADD CONSTRAINT boss_state_pkey PRIMARY KEY (guild_id);


--
-- Name: casino_logs casino_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.casino_logs
    ADD CONSTRAINT casino_logs_pkey PRIMARY KEY (id);


--
-- Name: cosmetic_catalog cosmetic_catalog_cosmetic_key_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cosmetic_catalog
    ADD CONSTRAINT cosmetic_catalog_cosmetic_key_key UNIQUE (cosmetic_key);


--
-- Name: cosmetic_catalog cosmetic_catalog_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cosmetic_catalog
    ADD CONSTRAINT cosmetic_catalog_pkey PRIMARY KEY (cosmetic_id);


--
-- Name: daily_quests daily_quests_discord_id_quest_type_quest_date_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.daily_quests
    ADD CONSTRAINT daily_quests_discord_id_quest_type_quest_date_key UNIQUE (discord_id, quest_type, quest_date);


--
-- Name: daily_quests daily_quests_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.daily_quests
    ADD CONSTRAINT daily_quests_pkey PRIMARY KEY (id);


--
-- Name: deity_roster deity_roster_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.deity_roster
    ADD CONSTRAINT deity_roster_name_key UNIQUE (name);


--
-- Name: deity_roster deity_roster_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.deity_roster
    ADD CONSTRAINT deity_roster_pkey PRIMARY KEY (deity_id);


--
-- Name: dev_logs dev_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.dev_logs
    ADD CONSTRAINT dev_logs_pkey PRIMARY KEY (id);


--
-- Name: equipped_skins equipped_skins_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.equipped_skins
    ADD CONSTRAINT equipped_skins_pkey PRIMARY KEY (discord_id, category);


--
-- Name: essence_bag_def essence_bag_def_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.essence_bag_def
    ADD CONSTRAINT essence_bag_def_pkey PRIMARY KEY (bag_key);


--
-- Name: game_logs game_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.game_logs
    ADD CONSTRAINT game_logs_pkey PRIMARY KEY (id);


--
-- Name: mob_roster mob_roster_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mob_roster
    ADD CONSTRAINT mob_roster_pkey PRIMARY KEY (mob_id);


--
-- Name: pity_counters pity_counters_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pity_counters
    ADD CONSTRAINT pity_counters_pkey PRIMARY KEY (discord_id);


--
-- Name: pvp_logs pvp_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pvp_logs
    ADD CONSTRAINT pvp_logs_pkey PRIMARY KEY (id);


--
-- Name: pvp_shop_purchases pvp_shop_purchases_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pvp_shop_purchases
    ADD CONSTRAINT pvp_shop_purchases_pkey PRIMARY KEY (discord_id, season_id, item_key);


--
-- Name: raid_logs raid_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.raid_logs
    ADD CONSTRAINT raid_logs_pkey PRIMARY KEY (id);


--
-- Name: ranked_logs ranked_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ranked_logs
    ADD CONSTRAINT ranked_logs_pkey PRIMARY KEY (id);


--
-- Name: ranked_reward ranked_reward_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ranked_reward
    ADD CONSTRAINT ranked_reward_pkey PRIMARY KEY (bracket);


--
-- Name: rune_roster rune_roster_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rune_roster
    ADD CONSTRAINT rune_roster_pkey PRIMARY KEY (rune_id);


--
-- Name: seasons seasons_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.seasons
    ADD CONSTRAINT seasons_pkey PRIMARY KEY (season_id);


--
-- Name: server_config server_config_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.server_config
    ADD CONSTRAINT server_config_pkey PRIMARY KEY (guild_id);


--
-- Name: socket_unlock_cost socket_unlock_cost_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.socket_unlock_cost
    ADD CONSTRAINT socket_unlock_cost_pkey PRIMARY KEY (tier, slot_index);


--
-- Name: stripe_events stripe_events_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stripe_events
    ADD CONSTRAINT stripe_events_pkey PRIMARY KEY (event_id);


--
-- Name: supporter_grants supporter_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.supporter_grants
    ADD CONSTRAINT supporter_grants_pkey PRIMARY KEY (id);


--
-- Name: supporter_token_ledger supporter_token_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.supporter_token_ledger
    ADD CONSTRAINT supporter_token_ledger_pkey PRIMARY KEY (entry_id);


--
-- Name: supporters supporters_founder_number_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.supporters
    ADD CONSTRAINT supporters_founder_number_key UNIQUE (founder_number);


--
-- Name: supporters supporters_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.supporters
    ADD CONSTRAINT supporters_pkey PRIMARY KEY (discord_id);


--
-- Name: title_catalog title_catalog_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.title_catalog
    ADD CONSTRAINT title_catalog_code_key UNIQUE (code);


--
-- Name: title_catalog title_catalog_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.title_catalog
    ADD CONSTRAINT title_catalog_pkey PRIMARY KEY (title_id);


--
-- Name: user_armors user_armors_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_armors
    ADD CONSTRAINT user_armors_pkey PRIMARY KEY (armor_id);


--
-- Name: user_character user_character_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_character
    ADD CONSTRAINT user_character_pkey PRIMARY KEY (discord_id);


--
-- Name: user_cosmetics user_cosmetics_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_cosmetics
    ADD CONSTRAINT user_cosmetics_pkey PRIMARY KEY (discord_id, cosmetic_id);


--
-- Name: user_deities user_deities_discord_id_deity_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_deities
    ADD CONSTRAINT user_deities_discord_id_deity_id_key UNIQUE (discord_id, deity_id);


--
-- Name: user_deities user_deities_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_deities
    ADD CONSTRAINT user_deities_pkey PRIMARY KEY (user_deity_id);


--
-- Name: user_guild_activity user_guild_activity_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_guild_activity
    ADD CONSTRAINT user_guild_activity_pkey PRIMARY KEY (discord_id, guild_id);


--
-- Name: user_runes user_runes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_runes
    ADD CONSTRAINT user_runes_pkey PRIMARY KEY (rune_uid);


--
-- Name: user_titles user_titles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_titles
    ADD CONSTRAINT user_titles_pkey PRIMARY KEY (discord_id, title_id);


--
-- Name: user_weapons user_weapons_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_weapons
    ADD CONSTRAINT user_weapons_pkey PRIMARY KEY (weapon_id);


--
-- Name: users_bag users_bag_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users_bag
    ADD CONSTRAINT users_bag_pkey PRIMARY KEY (discord_id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (discord_id);


--
-- Name: wager_logs wager_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.wager_logs
    ADD CONSTRAINT wager_logs_pkey PRIMARY KEY (id);


--
-- Name: weapon_roster weapon_roster_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.weapon_roster
    ADD CONSTRAINT weapon_roster_pkey PRIMARY KEY (weapon_roster_id);


--
-- Name: weekly_grand weekly_grand_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.weekly_grand
    ADD CONSTRAINT weekly_grand_pkey PRIMARY KEY (discord_id, quest_week);


--
-- Name: weekly_quests weekly_quests_discord_id_quest_type_quest_week_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.weekly_quests
    ADD CONSTRAINT weekly_quests_discord_id_quest_type_quest_week_key UNIQUE (discord_id, quest_type, quest_week);


--
-- Name: weekly_quests weekly_quests_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.weekly_quests
    ADD CONSTRAINT weekly_quests_pkey PRIMARY KEY (id);


--
-- Name: active_casino_sessions_one_active; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX active_casino_sessions_one_active ON public.active_casino_sessions USING btree (discord_id, game) WHERE ((status)::text = ANY ((ARRAY['active'::character varying, 'resolving'::character varying])::text[]));


--
-- Name: active_ranked_fights_expires_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX active_ranked_fights_expires_at_idx ON public.active_ranked_fights USING btree (expires_at);


--
-- Name: idx_active_battles_channel; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_active_battles_channel ON public.active_battles USING btree (channel_id);


--
-- Name: idx_active_casino_sessions_expiry; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_active_casino_sessions_expiry ON public.active_casino_sessions USING btree (status, expires_at);


--
-- Name: idx_active_duel_participants_duel; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_active_duel_participants_duel ON public.active_duel_participants USING btree (duel_id);


--
-- Name: idx_active_duels_expires_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_active_duels_expires_at ON public.active_duels USING btree (expires_at);


--
-- Name: idx_armor_roster_mythology; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_armor_roster_mythology ON public.armor_roster USING btree (mythology);


--
-- Name: idx_armor_roster_tier; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_armor_roster_tier ON public.armor_roster USING btree (tier);


--
-- Name: idx_boss_attack_spawn; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_boss_attack_spawn ON public.boss_attack_log USING btree (boss_spawn_id);


--
-- Name: idx_boss_attack_spawn_damage; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_boss_attack_spawn_damage ON public.boss_attack_log USING btree (boss_spawn_id, total_damage DESC, attacked_at) INCLUDE (discord_id);


--
-- Name: idx_casino_logs_player; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_casino_logs_player ON public.casino_logs USING btree (discord_id);


--
-- Name: idx_casino_logs_player_time; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_casino_logs_player_time ON public.casino_logs USING btree (discord_id, "timestamp" DESC);


--
-- Name: idx_catalog_cat_tier; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_catalog_cat_tier ON public.cosmetic_catalog USING btree (category, tier, is_active);


--
-- Name: idx_daily_quests_player_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_daily_quests_player_date ON public.daily_quests USING btree (discord_id, quest_date);


--
-- Name: idx_deity_roster_mythology; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_deity_roster_mythology ON public.deity_roster USING btree (mythology);


--
-- Name: idx_deity_roster_tier; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_deity_roster_tier ON public.deity_roster USING btree (tier);


--
-- Name: idx_game_logs_player; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_game_logs_player ON public.game_logs USING btree (discord_id);


--
-- Name: idx_game_logs_player_time; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_game_logs_player_time ON public.game_logs USING btree (discord_id, "timestamp" DESC);


--
-- Name: idx_mob_roster_mythology; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_mob_roster_mythology ON public.mob_roster USING btree (mythology);


--
-- Name: idx_mob_roster_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_mob_roster_type ON public.mob_roster USING btree (mob_type);


--
-- Name: idx_pvp_logs_challenger; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pvp_logs_challenger ON public.pvp_logs USING btree (challenger_id);


--
-- Name: idx_pvp_logs_opponent; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pvp_logs_opponent ON public.pvp_logs USING btree (opponent_id);


--
-- Name: idx_raid_logs_player; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_raid_logs_player ON public.raid_logs USING btree (discord_id);


--
-- Name: idx_raid_logs_player_time; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_raid_logs_player_time ON public.raid_logs USING btree (discord_id, "timestamp" DESC);


--
-- Name: idx_raid_logs_player_type_time_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_raid_logs_player_type_time_id ON public.raid_logs USING btree (discord_id, battle_type, "timestamp" DESC, id DESC) INCLUDE (result);


--
-- Name: idx_ranked_logs_player_time; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ranked_logs_player_time ON public.ranked_logs USING btree (player_id, "timestamp");


--
-- Name: idx_ranked_logs_player_time_id_desc; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ranked_logs_player_time_id_desc ON public.ranked_logs USING btree (player_id, "timestamp" DESC, id DESC) INCLUDE (result);


--
-- Name: idx_supporter_grants_discord; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_supporter_grants_discord ON public.supporter_grants USING btree (discord_id);


--
-- Name: idx_supporters_active; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_supporters_active ON public.supporters USING btree (active);


--
-- Name: idx_supporters_expires; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_supporters_expires ON public.supporters USING btree (expires_at) WHERE (expires_at IS NOT NULL);


--
-- Name: idx_supporters_founder_number; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX idx_supporters_founder_number ON public.supporters USING btree (founder_number) WHERE (founder_number IS NOT NULL);


--
-- Name: idx_supporters_tier_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_supporters_tier_status ON public.supporters USING btree (tier, status);


--
-- Name: idx_token_ledger_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_token_ledger_user ON public.supporter_token_ledger USING btree (discord_id);

CREATE INDEX idx_tickets_status_type_created ON public.tickets USING btree (status, type, created_at);


--
-- Name: idx_ub_lifetime_credux; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ub_lifetime_credux ON public.users_bag USING btree (lifetime_credux_earned DESC);


--
-- Name: idx_ub_valor; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ub_valor ON public.users_bag USING btree (valor_medals DESC);


--
-- Name: idx_uc_believer_level; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_uc_believer_level ON public.user_character USING btree (believer_level DESC);


--
-- Name: idx_uc_boss_kills; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_uc_boss_kills ON public.user_character USING btree (boss_kills DESC);


--
-- Name: idx_uc_boss_top_damage; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_uc_boss_top_damage ON public.user_character USING btree (boss_top_damage DESC);


--
-- Name: idx_uc_combat_level; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_uc_combat_level ON public.user_character USING btree (combat_level DESC);


--
-- Name: idx_uc_pvp_rating; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_uc_pvp_rating ON public.user_character USING btree (pvp_rating DESC);


--
-- Name: idx_uc_pvp_wins; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_uc_pvp_wins ON public.user_character USING btree (pvp_wins DESC);


--
-- Name: idx_uc_raids_done; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_uc_raids_done ON public.user_character USING btree (((raids_won + raids_lost)) DESC);


--
-- Name: idx_uc_raids_won; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_uc_raids_won ON public.user_character USING btree (raids_won DESC);


--
-- Name: idx_user_armors_owner; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_user_armors_owner ON public.user_armors USING btree (discord_id);


--
-- Name: idx_user_armors_owner_roster; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_user_armors_owner_roster ON public.user_armors USING btree (discord_id, armor_roster_id);


--
-- Name: idx_user_character_combat_level; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_user_character_combat_level ON public.user_character USING btree (combat_level);


--
-- Name: idx_user_cosmetics_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_user_cosmetics_user ON public.user_cosmetics USING btree (discord_id);


--
-- Name: idx_user_deities_owner; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_user_deities_owner ON public.user_deities USING btree (discord_id);


--
-- Name: idx_user_guild_activity_guild; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_user_guild_activity_guild ON public.user_guild_activity USING btree (guild_id, last_active);


--
-- Name: idx_user_guild_activity_guild_discord; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_user_guild_activity_guild_discord ON public.user_guild_activity USING btree (guild_id, discord_id);


--
-- Name: idx_user_runes_owner; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_user_runes_owner ON public.user_runes USING btree (discord_id);


--
-- Name: idx_user_titles_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_user_titles_user ON public.user_titles USING btree (discord_id);


--
-- Name: idx_user_weapons_owner; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_user_weapons_owner ON public.user_weapons USING btree (discord_id);


--
-- Name: idx_user_weapons_owner_roster; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_user_weapons_owner_roster ON public.user_weapons USING btree (discord_id, weapon_roster_id);


--
-- Name: idx_users_is_banned; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_users_is_banned ON public.users USING btree (is_banned);


--
-- Name: idx_wager_logs_challenger; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_wager_logs_challenger ON public.wager_logs USING btree (challenger_id);


--
-- Name: idx_wager_logs_opponent; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_wager_logs_opponent ON public.wager_logs USING btree (opponent_id);


--
-- Name: idx_weapon_roster_mythology; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_weapon_roster_mythology ON public.weapon_roster USING btree (mythology);


--
-- Name: idx_weapon_roster_tier; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_weapon_roster_tier ON public.weapon_roster USING btree (tier);


--
-- Name: idx_weekly_quests_user_week; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_weekly_quests_user_week ON public.weekly_quests USING btree (discord_id, quest_week);


--
-- Name: supporter_token_ledger_grant_once_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX supporter_token_ledger_grant_once_key ON public.supporter_token_ledger USING btree (discord_id, reason, ref) WHERE ((delta > 0) AND (ref IS NOT NULL) AND ((reason)::text = ANY ((ARRAY['subscribe_grant'::character varying, 'founder_grant'::character varying, 'monthly_grant'::character varying])::text[])));


--
-- Name: uq_catalog_skin_code; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_catalog_skin_code ON public.cosmetic_catalog USING btree (skin_code) WHERE (skin_code IS NOT NULL);


--
-- Name: active_battles active_battles_discord_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.active_battles
    ADD CONSTRAINT active_battles_discord_id_fkey FOREIGN KEY (discord_id) REFERENCES public.users(discord_id);


--
-- Name: active_battles active_battles_mob_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.active_battles
    ADD CONSTRAINT active_battles_mob_id_fkey FOREIGN KEY (mob_id) REFERENCES public.mob_roster(mob_id);


--
-- Name: active_casino_sessions active_casino_sessions_discord_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.active_casino_sessions
    ADD CONSTRAINT active_casino_sessions_discord_id_fkey FOREIGN KEY (discord_id) REFERENCES public.users(discord_id) ON DELETE CASCADE;


--
-- Name: active_duel_participants active_duel_participants_duel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.active_duel_participants
    ADD CONSTRAINT active_duel_participants_duel_id_fkey FOREIGN KEY (duel_id) REFERENCES public.active_duels(duel_id) ON DELETE CASCADE;


--
-- Name: boss_attack_log boss_attack_log_discord_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.boss_attack_log
    ADD CONSTRAINT boss_attack_log_discord_id_fkey FOREIGN KEY (discord_id) REFERENCES public.users(discord_id);


--
-- Name: boss_state boss_state_mob_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.boss_state
    ADD CONSTRAINT boss_state_mob_id_fkey FOREIGN KEY (mob_id) REFERENCES public.mob_roster(mob_id);


--
-- Name: daily_quests daily_quests_discord_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.daily_quests
    ADD CONSTRAINT daily_quests_discord_id_fkey FOREIGN KEY (discord_id) REFERENCES public.users(discord_id);


--
-- Name: equipped_skins equipped_skins_cosmetic_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.equipped_skins
    ADD CONSTRAINT equipped_skins_cosmetic_id_fkey FOREIGN KEY (cosmetic_id) REFERENCES public.cosmetic_catalog(cosmetic_id) ON DELETE SET NULL;


--
-- Name: equipped_skins equipped_skins_discord_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.equipped_skins
    ADD CONSTRAINT equipped_skins_discord_id_fkey FOREIGN KEY (discord_id) REFERENCES public.users(discord_id) ON DELETE CASCADE;


--
-- Name: pity_counters pity_counters_discord_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pity_counters
    ADD CONSTRAINT pity_counters_discord_id_fkey FOREIGN KEY (discord_id) REFERENCES public.users(discord_id);


--
-- Name: pvp_shop_purchases pvp_shop_purchases_discord_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pvp_shop_purchases
    ADD CONSTRAINT pvp_shop_purchases_discord_id_fkey FOREIGN KEY (discord_id) REFERENCES public.users(discord_id);


--
-- Name: ranked_logs ranked_logs_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ranked_logs
    ADD CONSTRAINT ranked_logs_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.users(discord_id);


--
-- Name: seasons seasons_featured_deity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.seasons
    ADD CONSTRAINT seasons_featured_deity_id_fkey FOREIGN KEY (featured_deity_id) REFERENCES public.deity_roster(deity_id);


--
-- Name: supporter_token_ledger supporter_token_ledger_discord_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.supporter_token_ledger
    ADD CONSTRAINT supporter_token_ledger_discord_id_fkey FOREIGN KEY (discord_id) REFERENCES public.users(discord_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.supporter_item_grants
    ADD CONSTRAINT supporter_item_grants_discord_id_fkey FOREIGN KEY (discord_id) REFERENCES public.users(discord_id) ON DELETE CASCADE;


--
-- Name: supporters supporters_discord_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.supporters
    ADD CONSTRAINT supporters_discord_id_fkey FOREIGN KEY (discord_id) REFERENCES public.users(discord_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(discord_id) ON DELETE CASCADE;


--
-- Name: user_armors user_armors_armor_roster_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_armors
    ADD CONSTRAINT user_armors_armor_roster_id_fkey FOREIGN KEY (armor_roster_id) REFERENCES public.armor_roster(armor_roster_id);


--
-- Name: user_armors user_armors_discord_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_armors
    ADD CONSTRAINT user_armors_discord_id_fkey FOREIGN KEY (discord_id) REFERENCES public.users(discord_id);


--
-- Name: user_character user_character_active_deity_id_2_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_character
    ADD CONSTRAINT user_character_active_deity_id_2_fkey FOREIGN KEY (active_deity_id_2) REFERENCES public.user_deities(user_deity_id) ON DELETE SET NULL;


--
-- Name: user_character user_character_active_deity_id_3_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_character
    ADD CONSTRAINT user_character_active_deity_id_3_fkey FOREIGN KEY (active_deity_id_3) REFERENCES public.user_deities(user_deity_id) ON DELETE SET NULL;


--
-- Name: user_character user_character_active_deity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_character
    ADD CONSTRAINT user_character_active_deity_id_fkey FOREIGN KEY (active_deity_id) REFERENCES public.user_deities(user_deity_id) ON DELETE SET NULL;


--
-- Name: user_character user_character_active_echo_deity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_character
    ADD CONSTRAINT user_character_active_echo_deity_id_fkey FOREIGN KEY (active_echo_deity_id) REFERENCES public.user_deities(user_deity_id) ON DELETE SET NULL;


--
-- Name: user_character user_character_discord_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_character
    ADD CONSTRAINT user_character_discord_id_fkey FOREIGN KEY (discord_id) REFERENCES public.users(discord_id);


--
-- Name: user_character user_character_equipped_armor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_character
    ADD CONSTRAINT user_character_equipped_armor_id_fkey FOREIGN KEY (equipped_armor_id) REFERENCES public.user_armors(armor_id) ON DELETE SET NULL;


--
-- Name: user_character user_character_equipped_title_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_character
    ADD CONSTRAINT user_character_equipped_title_id_fkey FOREIGN KEY (equipped_title_id) REFERENCES public.title_catalog(title_id) ON DELETE SET NULL;


--
-- Name: user_character user_character_equipped_weapon_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_character
    ADD CONSTRAINT user_character_equipped_weapon_id_fkey FOREIGN KEY (equipped_weapon_id) REFERENCES public.user_weapons(weapon_id) ON DELETE SET NULL;


--
-- Name: user_presets user_presets_discord_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_presets
    ADD CONSTRAINT user_presets_discord_id_fkey FOREIGN KEY (discord_id) REFERENCES public.users(discord_id) ON DELETE CASCADE;


--
-- Name: user_presets user_presets_equipped_armor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_presets
    ADD CONSTRAINT user_presets_equipped_armor_id_fkey FOREIGN KEY (equipped_armor_id) REFERENCES public.user_armors(armor_id) ON DELETE SET NULL;


--
-- Name: user_presets user_presets_equipped_deity_1_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_presets
    ADD CONSTRAINT user_presets_equipped_deity_1_id_fkey FOREIGN KEY (equipped_deity_1_id) REFERENCES public.user_deities(user_deity_id) ON DELETE SET NULL;


--
-- Name: user_presets user_presets_equipped_deity_2_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_presets
    ADD CONSTRAINT user_presets_equipped_deity_2_id_fkey FOREIGN KEY (equipped_deity_2_id) REFERENCES public.user_deities(user_deity_id) ON DELETE SET NULL;


--
-- Name: user_presets user_presets_equipped_deity_3_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_presets
    ADD CONSTRAINT user_presets_equipped_deity_3_id_fkey FOREIGN KEY (equipped_deity_3_id) REFERENCES public.user_deities(user_deity_id) ON DELETE SET NULL;


--
-- Name: user_presets user_presets_equipped_echo_deity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_presets
    ADD CONSTRAINT user_presets_equipped_echo_deity_id_fkey FOREIGN KEY (equipped_echo_deity_id) REFERENCES public.user_deities(user_deity_id) ON DELETE SET NULL;


--
-- Name: user_presets user_presets_equipped_weapon_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_presets
    ADD CONSTRAINT user_presets_equipped_weapon_id_fkey FOREIGN KEY (equipped_weapon_id) REFERENCES public.user_weapons(weapon_id) ON DELETE SET NULL;


--
-- Name: user_cosmetics user_cosmetics_cosmetic_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_cosmetics
    ADD CONSTRAINT user_cosmetics_cosmetic_id_fkey FOREIGN KEY (cosmetic_id) REFERENCES public.cosmetic_catalog(cosmetic_id) ON DELETE CASCADE;


--
-- Name: user_cosmetics user_cosmetics_discord_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_cosmetics
    ADD CONSTRAINT user_cosmetics_discord_id_fkey FOREIGN KEY (discord_id) REFERENCES public.users(discord_id) ON DELETE CASCADE;


--
-- Name: user_deities user_deities_deity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_deities
    ADD CONSTRAINT user_deities_deity_id_fkey FOREIGN KEY (deity_id) REFERENCES public.deity_roster(deity_id);


--
-- Name: user_deities user_deities_discord_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_deities
    ADD CONSTRAINT user_deities_discord_id_fkey FOREIGN KEY (discord_id) REFERENCES public.users(discord_id);


--
-- Name: user_guild_activity user_guild_activity_discord_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_guild_activity
    ADD CONSTRAINT user_guild_activity_discord_id_fkey FOREIGN KEY (discord_id) REFERENCES public.users(discord_id);


--
-- Name: user_runes user_runes_discord_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_runes
    ADD CONSTRAINT user_runes_discord_id_fkey FOREIGN KEY (discord_id) REFERENCES public.users(discord_id);


--
-- Name: user_runes user_runes_rune_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_runes
    ADD CONSTRAINT user_runes_rune_id_fkey FOREIGN KEY (rune_id) REFERENCES public.rune_roster(rune_id);


--
-- Name: user_titles user_titles_discord_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_titles
    ADD CONSTRAINT user_titles_discord_id_fkey FOREIGN KEY (discord_id) REFERENCES public.users(discord_id);


--
-- Name: user_titles user_titles_title_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_titles
    ADD CONSTRAINT user_titles_title_id_fkey FOREIGN KEY (title_id) REFERENCES public.title_catalog(title_id);


--
-- Name: user_weapons user_weapons_discord_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_weapons
    ADD CONSTRAINT user_weapons_discord_id_fkey FOREIGN KEY (discord_id) REFERENCES public.users(discord_id);


--
-- Name: user_weapons user_weapons_weapon_roster_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_weapons
    ADD CONSTRAINT user_weapons_weapon_roster_id_fkey FOREIGN KEY (weapon_roster_id) REFERENCES public.weapon_roster(weapon_roster_id);


--
-- Name: users_bag users_bag_discord_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users_bag
    ADD CONSTRAINT users_bag_discord_id_fkey FOREIGN KEY (discord_id) REFERENCES public.users(discord_id);


--
-- Name: weekly_grand weekly_grand_discord_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.weekly_grand
    ADD CONSTRAINT weekly_grand_discord_id_fkey FOREIGN KEY (discord_id) REFERENCES public.users(discord_id);


--
-- Name: weekly_quests weekly_quests_discord_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.weekly_quests
    ADD CONSTRAINT weekly_quests_discord_id_fkey FOREIGN KEY (discord_id) REFERENCES public.users(discord_id);


--
-- Name: active_battles; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.active_battles ENABLE ROW LEVEL SECURITY;

--
-- Name: active_casino_sessions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.active_casino_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: active_duel_participants; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.active_duel_participants ENABLE ROW LEVEL SECURITY;

--
-- Name: active_duels; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.active_duels ENABLE ROW LEVEL SECURITY;

--
-- Name: active_ranked_fights; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.active_ranked_fights ENABLE ROW LEVEL SECURITY;

--
-- Name: armor_roster; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.armor_roster ENABLE ROW LEVEL SECURITY;

--
-- Name: auto_raids; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.auto_raids ENABLE ROW LEVEL SECURITY;

--
-- Name: boss_attack_log; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.boss_attack_log ENABLE ROW LEVEL SECURITY;

--
-- Name: boss_state; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.boss_state ENABLE ROW LEVEL SECURITY;

--
-- Name: boss_spawn_queue; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.boss_spawn_queue ENABLE ROW LEVEL SECURITY;

--
-- Name: casino_logs; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.casino_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: cosmetic_catalog; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.cosmetic_catalog ENABLE ROW LEVEL SECURITY;

--
-- Name: daily_quests; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.daily_quests ENABLE ROW LEVEL SECURITY;

--
-- Name: deity_roster; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.deity_roster ENABLE ROW LEVEL SECURITY;

--
-- Name: dev_logs; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.dev_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: equipped_skins; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.equipped_skins ENABLE ROW LEVEL SECURITY;

--
-- Name: essence_bag_def; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.essence_bag_def ENABLE ROW LEVEL SECURITY;

--
-- Name: game_logs; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.game_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: mob_roster; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.mob_roster ENABLE ROW LEVEL SECURITY;

--
-- Name: pity_counters; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.pity_counters ENABLE ROW LEVEL SECURITY;

--
-- Name: pvp_logs; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.pvp_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: pvp_shop_purchases; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.pvp_shop_purchases ENABLE ROW LEVEL SECURITY;

--
-- Name: raid_logs; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.raid_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: ranked_logs; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.ranked_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: ranked_reward; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.ranked_reward ENABLE ROW LEVEL SECURITY;

--
-- Name: rune_roster; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.rune_roster ENABLE ROW LEVEL SECURITY;

--
-- Name: seasons; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.seasons ENABLE ROW LEVEL SECURITY;

--
-- Name: server_config; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.server_config ENABLE ROW LEVEL SECURITY;

--
-- Name: socket_unlock_cost; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.socket_unlock_cost ENABLE ROW LEVEL SECURITY;

--
-- Name: stripe_events; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.stripe_events ENABLE ROW LEVEL SECURITY;

--
-- Name: supporter_grants; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.supporter_grants ENABLE ROW LEVEL SECURITY;

--
-- Name: supporter_item_grants; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.supporter_item_grants ENABLE ROW LEVEL SECURITY;

--
-- Name: supporter_token_ledger; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.supporter_token_ledger ENABLE ROW LEVEL SECURITY;

--
-- Name: supporters; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.supporters ENABLE ROW LEVEL SECURITY;

--
-- Name: tickets; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;

--
-- Name: title_catalog; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.title_catalog ENABLE ROW LEVEL SECURITY;

--
-- Name: user_armors; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.user_armors ENABLE ROW LEVEL SECURITY;

--
-- Name: user_character; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.user_character ENABLE ROW LEVEL SECURITY;

--
-- Name: user_presets; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.user_presets ENABLE ROW LEVEL SECURITY;

--
-- Name: user_cosmetics; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.user_cosmetics ENABLE ROW LEVEL SECURITY;

--
-- Name: user_deities; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.user_deities ENABLE ROW LEVEL SECURITY;

--
-- Name: user_guild_activity; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.user_guild_activity ENABLE ROW LEVEL SECURITY;

--
-- Name: user_runes; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.user_runes ENABLE ROW LEVEL SECURITY;

--
-- Name: user_titles; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.user_titles ENABLE ROW LEVEL SECURITY;

--
-- Name: user_weapons; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.user_weapons ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- Name: users_bag; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.users_bag ENABLE ROW LEVEL SECURITY;

--
-- Name: wager_logs; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.wager_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: weapon_roster; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.weapon_roster ENABLE ROW LEVEL SECURITY;

--
-- Name: weekly_grand; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.weekly_grand ENABLE ROW LEVEL SECURITY;

--
-- Name: weekly_quests; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.weekly_quests ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: pg_database_owner
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: TABLE active_battles; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.active_battles TO anon;
GRANT ALL ON TABLE public.active_battles TO authenticated;
GRANT ALL ON TABLE public.active_battles TO service_role;


--
-- Name: SEQUENCE active_battles_battle_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.active_battles_battle_id_seq TO anon;
GRANT ALL ON SEQUENCE public.active_battles_battle_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.active_battles_battle_id_seq TO service_role;


--
-- Name: TABLE active_casino_sessions; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.active_casino_sessions TO anon;
GRANT ALL ON TABLE public.active_casino_sessions TO authenticated;
GRANT ALL ON TABLE public.active_casino_sessions TO service_role;


--
-- Name: TABLE active_duel_participants; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.active_duel_participants TO anon;
GRANT ALL ON TABLE public.active_duel_participants TO authenticated;
GRANT ALL ON TABLE public.active_duel_participants TO service_role;


--
-- Name: TABLE active_duels; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.active_duels TO anon;
GRANT ALL ON TABLE public.active_duels TO authenticated;
GRANT ALL ON TABLE public.active_duels TO service_role;


--
-- Name: TABLE active_ranked_fights; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.active_ranked_fights TO anon;
GRANT ALL ON TABLE public.active_ranked_fights TO authenticated;
GRANT ALL ON TABLE public.active_ranked_fights TO service_role;


--
-- Name: TABLE armor_roster; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.armor_roster TO anon;
GRANT ALL ON TABLE public.armor_roster TO authenticated;
GRANT ALL ON TABLE public.armor_roster TO service_role;


--
-- Name: SEQUENCE armor_roster_armor_roster_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.armor_roster_armor_roster_id_seq TO anon;
GRANT ALL ON SEQUENCE public.armor_roster_armor_roster_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.armor_roster_armor_roster_id_seq TO service_role;


--
-- Name: TABLE auto_raids; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.auto_raids TO anon;
GRANT ALL ON TABLE public.auto_raids TO authenticated;
GRANT ALL ON TABLE public.auto_raids TO service_role;


--
-- Name: TABLE boss_attack_log; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.boss_attack_log TO anon;
GRANT ALL ON TABLE public.boss_attack_log TO authenticated;
GRANT ALL ON TABLE public.boss_attack_log TO service_role;


--
-- Name: SEQUENCE boss_attack_log_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.boss_attack_log_id_seq TO anon;
GRANT ALL ON SEQUENCE public.boss_attack_log_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.boss_attack_log_id_seq TO service_role;


--
-- Name: TABLE boss_state; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.boss_state TO anon;
GRANT ALL ON TABLE public.boss_state TO authenticated;
GRANT ALL ON TABLE public.boss_state TO service_role;


--
-- Name: TABLE casino_logs; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.casino_logs TO anon;
GRANT ALL ON TABLE public.casino_logs TO authenticated;
GRANT ALL ON TABLE public.casino_logs TO service_role;


--
-- Name: SEQUENCE casino_logs_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.casino_logs_id_seq TO anon;
GRANT ALL ON SEQUENCE public.casino_logs_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.casino_logs_id_seq TO service_role;


--
-- Name: TABLE cosmetic_catalog; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.cosmetic_catalog TO anon;
GRANT ALL ON TABLE public.cosmetic_catalog TO authenticated;
GRANT ALL ON TABLE public.cosmetic_catalog TO service_role;


--
-- Name: SEQUENCE cosmetic_catalog_cosmetic_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.cosmetic_catalog_cosmetic_id_seq TO anon;
GRANT ALL ON SEQUENCE public.cosmetic_catalog_cosmetic_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.cosmetic_catalog_cosmetic_id_seq TO service_role;


--
-- Name: TABLE daily_quests; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.daily_quests TO anon;
GRANT ALL ON TABLE public.daily_quests TO authenticated;
GRANT ALL ON TABLE public.daily_quests TO service_role;


--
-- Name: SEQUENCE daily_quests_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.daily_quests_id_seq TO anon;
GRANT ALL ON SEQUENCE public.daily_quests_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.daily_quests_id_seq TO service_role;


--
-- Name: TABLE deity_roster; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.deity_roster TO anon;
GRANT ALL ON TABLE public.deity_roster TO authenticated;
GRANT ALL ON TABLE public.deity_roster TO service_role;


--
-- Name: SEQUENCE deity_roster_deity_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.deity_roster_deity_id_seq TO anon;
GRANT ALL ON SEQUENCE public.deity_roster_deity_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.deity_roster_deity_id_seq TO service_role;


--
-- Name: TABLE dev_logs; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.dev_logs TO anon;
GRANT ALL ON TABLE public.dev_logs TO authenticated;
GRANT ALL ON TABLE public.dev_logs TO service_role;


--
-- Name: SEQUENCE dev_logs_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.dev_logs_id_seq TO anon;
GRANT ALL ON SEQUENCE public.dev_logs_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.dev_logs_id_seq TO service_role;


--
-- Name: TABLE equipped_skins; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.equipped_skins TO anon;
GRANT ALL ON TABLE public.equipped_skins TO authenticated;
GRANT ALL ON TABLE public.equipped_skins TO service_role;


--
-- Name: TABLE essence_bag_def; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.essence_bag_def TO anon;
GRANT ALL ON TABLE public.essence_bag_def TO authenticated;
GRANT ALL ON TABLE public.essence_bag_def TO service_role;


--
-- Name: TABLE game_logs; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.game_logs TO anon;
GRANT ALL ON TABLE public.game_logs TO authenticated;
GRANT ALL ON TABLE public.game_logs TO service_role;


--
-- Name: SEQUENCE game_logs_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.game_logs_id_seq TO anon;
GRANT ALL ON SEQUENCE public.game_logs_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.game_logs_id_seq TO service_role;


--
-- Name: TABLE mob_roster; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.mob_roster TO anon;
GRANT ALL ON TABLE public.mob_roster TO authenticated;
GRANT ALL ON TABLE public.mob_roster TO service_role;


--
-- Name: SEQUENCE mob_roster_mob_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.mob_roster_mob_id_seq TO anon;
GRANT ALL ON SEQUENCE public.mob_roster_mob_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.mob_roster_mob_id_seq TO service_role;


--
-- Name: TABLE pity_counters; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.pity_counters TO anon;
GRANT ALL ON TABLE public.pity_counters TO authenticated;
GRANT ALL ON TABLE public.pity_counters TO service_role;


--
-- Name: TABLE pvp_logs; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.pvp_logs TO anon;
GRANT ALL ON TABLE public.pvp_logs TO authenticated;
GRANT ALL ON TABLE public.pvp_logs TO service_role;


--
-- Name: SEQUENCE pvp_logs_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.pvp_logs_id_seq TO anon;
GRANT ALL ON SEQUENCE public.pvp_logs_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.pvp_logs_id_seq TO service_role;


--
-- Name: TABLE pvp_shop_purchases; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.pvp_shop_purchases TO anon;
GRANT ALL ON TABLE public.pvp_shop_purchases TO authenticated;
GRANT ALL ON TABLE public.pvp_shop_purchases TO service_role;


--
-- Name: TABLE raid_logs; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.raid_logs TO anon;
GRANT ALL ON TABLE public.raid_logs TO authenticated;
GRANT ALL ON TABLE public.raid_logs TO service_role;


--
-- Name: SEQUENCE raid_logs_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.raid_logs_id_seq TO anon;
GRANT ALL ON SEQUENCE public.raid_logs_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.raid_logs_id_seq TO service_role;


--
-- Name: TABLE ranked_logs; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.ranked_logs TO anon;
GRANT ALL ON TABLE public.ranked_logs TO authenticated;
GRANT ALL ON TABLE public.ranked_logs TO service_role;


--
-- Name: SEQUENCE ranked_logs_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.ranked_logs_id_seq TO anon;
GRANT ALL ON SEQUENCE public.ranked_logs_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.ranked_logs_id_seq TO service_role;


--
-- Name: TABLE ranked_reward; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.ranked_reward TO anon;
GRANT ALL ON TABLE public.ranked_reward TO authenticated;
GRANT ALL ON TABLE public.ranked_reward TO service_role;


--
-- Name: TABLE rune_roster; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.rune_roster TO anon;
GRANT ALL ON TABLE public.rune_roster TO authenticated;
GRANT ALL ON TABLE public.rune_roster TO service_role;


--
-- Name: SEQUENCE rune_roster_rune_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.rune_roster_rune_id_seq TO anon;
GRANT ALL ON SEQUENCE public.rune_roster_rune_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.rune_roster_rune_id_seq TO service_role;


--
-- Name: TABLE seasons; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.seasons TO anon;
GRANT ALL ON TABLE public.seasons TO authenticated;
GRANT ALL ON TABLE public.seasons TO service_role;


--
-- Name: SEQUENCE seasons_season_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.seasons_season_id_seq TO anon;
GRANT ALL ON SEQUENCE public.seasons_season_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.seasons_season_id_seq TO service_role;


--
-- Name: TABLE server_config; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.server_config TO anon;
GRANT ALL ON TABLE public.server_config TO authenticated;
GRANT ALL ON TABLE public.server_config TO service_role;


--
-- Name: TABLE socket_unlock_cost; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.socket_unlock_cost TO anon;
GRANT ALL ON TABLE public.socket_unlock_cost TO authenticated;
GRANT ALL ON TABLE public.socket_unlock_cost TO service_role;


--
-- Name: TABLE stripe_events; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.stripe_events TO anon;
GRANT ALL ON TABLE public.stripe_events TO authenticated;
GRANT ALL ON TABLE public.stripe_events TO service_role;


--
-- Name: SEQUENCE supporter_founder_number_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.supporter_founder_number_seq TO anon;
GRANT ALL ON SEQUENCE public.supporter_founder_number_seq TO authenticated;
GRANT ALL ON SEQUENCE public.supporter_founder_number_seq TO service_role;


--
-- Name: TABLE supporter_grants; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.supporter_grants TO anon;
GRANT ALL ON TABLE public.supporter_grants TO authenticated;
GRANT ALL ON TABLE public.supporter_grants TO service_role;


--
-- Name: SEQUENCE supporter_grants_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.supporter_grants_id_seq TO anon;
GRANT ALL ON SEQUENCE public.supporter_grants_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.supporter_grants_id_seq TO service_role;


--
-- Name: TABLE supporter_token_ledger; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.supporter_token_ledger TO anon;
GRANT ALL ON TABLE public.supporter_token_ledger TO authenticated;
GRANT ALL ON TABLE public.supporter_token_ledger TO service_role;


--
-- Name: SEQUENCE supporter_token_ledger_entry_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.supporter_token_ledger_entry_id_seq TO anon;
GRANT ALL ON SEQUENCE public.supporter_token_ledger_entry_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.supporter_token_ledger_entry_id_seq TO service_role;


--
-- Name: TABLE supporters; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.supporters TO anon;
GRANT ALL ON TABLE public.supporters TO authenticated;
GRANT ALL ON TABLE public.supporters TO service_role;


--
-- Name: TABLE title_catalog; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.title_catalog TO anon;
GRANT ALL ON TABLE public.title_catalog TO authenticated;
GRANT ALL ON TABLE public.title_catalog TO service_role;


--
-- Name: SEQUENCE title_catalog_title_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.title_catalog_title_id_seq TO anon;
GRANT ALL ON SEQUENCE public.title_catalog_title_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.title_catalog_title_id_seq TO service_role;


--
-- Name: TABLE user_armors; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.user_armors TO anon;
GRANT ALL ON TABLE public.user_armors TO authenticated;
GRANT ALL ON TABLE public.user_armors TO service_role;


--
-- Name: TABLE user_character; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.user_character TO anon;
GRANT ALL ON TABLE public.user_character TO authenticated;
GRANT ALL ON TABLE public.user_character TO service_role;


--
-- Name: TABLE user_cosmetics; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.user_cosmetics TO anon;
GRANT ALL ON TABLE public.user_cosmetics TO authenticated;
GRANT ALL ON TABLE public.user_cosmetics TO service_role;


--
-- Name: TABLE user_deities; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.user_deities TO anon;
GRANT ALL ON TABLE public.user_deities TO authenticated;
GRANT ALL ON TABLE public.user_deities TO service_role;


--
-- Name: SEQUENCE user_deities_user_deity_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.user_deities_user_deity_id_seq TO anon;
GRANT ALL ON SEQUENCE public.user_deities_user_deity_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.user_deities_user_deity_id_seq TO service_role;


--
-- Name: TABLE user_guild_activity; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.user_guild_activity TO anon;
GRANT ALL ON TABLE public.user_guild_activity TO authenticated;
GRANT ALL ON TABLE public.user_guild_activity TO service_role;


--
-- Name: TABLE user_runes; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.user_runes TO anon;
GRANT ALL ON TABLE public.user_runes TO authenticated;
GRANT ALL ON TABLE public.user_runes TO service_role;


--
-- Name: TABLE user_titles; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.user_titles TO anon;
GRANT ALL ON TABLE public.user_titles TO authenticated;
GRANT ALL ON TABLE public.user_titles TO service_role;


--
-- Name: TABLE user_weapons; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.user_weapons TO anon;
GRANT ALL ON TABLE public.user_weapons TO authenticated;
GRANT ALL ON TABLE public.user_weapons TO service_role;


--
-- Name: TABLE users; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.users TO anon;
GRANT ALL ON TABLE public.users TO authenticated;
GRANT ALL ON TABLE public.users TO service_role;


--
-- Name: TABLE users_bag; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.users_bag TO anon;
GRANT ALL ON TABLE public.users_bag TO authenticated;
GRANT ALL ON TABLE public.users_bag TO service_role;


--
-- Name: TABLE wager_logs; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.wager_logs TO anon;
GRANT ALL ON TABLE public.wager_logs TO authenticated;
GRANT ALL ON TABLE public.wager_logs TO service_role;


--
-- Name: SEQUENCE wager_logs_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.wager_logs_id_seq TO anon;
GRANT ALL ON SEQUENCE public.wager_logs_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.wager_logs_id_seq TO service_role;


--
-- Name: TABLE weapon_roster; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.weapon_roster TO anon;
GRANT ALL ON TABLE public.weapon_roster TO authenticated;
GRANT ALL ON TABLE public.weapon_roster TO service_role;


--
-- Name: SEQUENCE weapon_roster_weapon_roster_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.weapon_roster_weapon_roster_id_seq TO anon;
GRANT ALL ON SEQUENCE public.weapon_roster_weapon_roster_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.weapon_roster_weapon_roster_id_seq TO service_role;


--
-- Name: TABLE weekly_grand; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.weekly_grand TO anon;
GRANT ALL ON TABLE public.weekly_grand TO authenticated;
GRANT ALL ON TABLE public.weekly_grand TO service_role;


--
-- Name: TABLE weekly_quests; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.weekly_quests TO anon;
GRANT ALL ON TABLE public.weekly_quests TO authenticated;
GRANT ALL ON TABLE public.weekly_quests TO service_role;


--
-- Name: SEQUENCE weekly_quests_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.weekly_quests_id_seq TO anon;
GRANT ALL ON SEQUENCE public.weekly_quests_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.weekly_quests_id_seq TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- PostgreSQL database dump complete
--

\unrestrict R7Lkhr1cdkdChgQGbV5BWmFz7BKIJcIM8AN54Pa3iHJNU8NlUedYWg4N4yU6eOR
