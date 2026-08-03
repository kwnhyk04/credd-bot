-- Remove level scaling from all bosses
UPDATE public.mob_roster SET
  hp_per_level = 0, atk_per_level = 0, def_per_level = 0
WHERE mob_type = 'boss';

-- Fixed ATK / DEF / crit
UPDATE public.mob_roster SET base_atk = 6200, base_def = 5900, base_crit = 5.0  WHERE name = 'Jotun';
UPDATE public.mob_roster SET base_atk = 6600, base_def = 6000, base_crit = 8.0  WHERE name = 'Fafnir';
UPDATE public.mob_roster SET base_atk = 7000, base_def = 5200, base_crit = 15.0 WHERE name = 'Cerberus';
UPDATE public.mob_roster SET base_atk = 6400, base_def = 5800, base_crit = 8.0  WHERE name = 'Berberoka';
UPDATE public.mob_roster SET base_atk = 6800, base_def = 5700, base_crit = 10.0 WHERE name = 'Hydra';
UPDATE public.mob_roster SET base_atk = 6800, base_def = 5400, base_crit = 12.0 WHERE name = 'Anggitay';
UPDATE public.mob_roster SET base_atk = 7000, base_def = 5500, base_crit = 20.0 WHERE name = 'Dalaketnon';
UPDATE public.mob_roster SET base_atk = 7200, base_def = 5400, base_crit = 20.0 WHERE name = 'Medusa';
UPDATE public.mob_roster SET base_atk = 7600, base_def = 5100, base_crit = 10.0 WHERE name = 'Bungisngis';
UPDATE public.mob_roster SET base_atk = 7800, base_def = 5000, base_crit = 30.0 WHERE name = 'Sleipnir';

-- Medusa: strip immunities
UPDATE public.mob_roster SET
  immunity_tags = '[]'::jsonb,
  special_flags = '{"retune_v6": true, "no_immunities": true}'::jsonb
WHERE mob_id = 38 AND name = 'Medusa';

-- Fenrir: calamity stats, immunities removed
UPDATE public.mob_roster SET
  base_atk      = 13500,
  base_def      = 5200,
  base_crit     = 25.0,
  immunity_tags = '[]'::jsonb,
  special_flags = '{"retune_v6": true, "no_immunities": true}'::jsonb
WHERE mob_id = 33 AND name = 'Fenrir';

-- Bakunawa
INSERT INTO public.mob_roster (
    name, mythology, mob_type,
    base_hp, base_atk, base_def, base_crit,
    hp_per_level, atk_per_level, def_per_level,
    skill_key, skill_name, skill_description,
    immunity_tags, special_flags
) VALUES (
    'Bakunawa', 'PH', 'boss',
    500000, 13000, 5500, 20.0,
    0, 0, 0,
    'bakunawa_seven_moons',
    'Seven Moons',
    'Devours a moon at 85%, 70%, 55%, 40%, 25%, and 10% HP, gaining +10% ATK permanently each time. Every 4th turn, swallows the light, leaving the player Darkened for 1 turn with 0 crit chance.',
    '[]'::jsonb,
    '{"retune_v6": true, "no_immunities": true}'::jsonb
);


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