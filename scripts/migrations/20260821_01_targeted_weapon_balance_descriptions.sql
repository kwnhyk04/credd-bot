-- Targeted weapon balance description synchronization.
--
-- This migration records the player-facing descriptions for the 2026-08-21
-- Atlas, Kiri, Titan, and Gungnir balance correction. It supersedes the
-- descriptions seeded by 20260720_08_genesis_weapons.sql without editing that
-- historical migration. Apply after 20260818_02_divine_weapon_tier.sql.
--
-- Safe to rerun: YES. No schema, stats, passive keys, or combat state changes.

BEGIN;

DO $targeted_weapon_balance_descriptions$
DECLARE
    target RECORD;
    affected INTEGER;
BEGIN
    CREATE TEMP TABLE _targeted_weapon_balance_descriptions (
        weapon_name TEXT NOT NULL,
        passive_key TEXT NOT NULL,
        tier TEXT NOT NULL,
        description TEXT NOT NULL,
        PRIMARY KEY (weapon_name, passive_key)
    ) ON COMMIT DROP;

    INSERT INTO _targeted_weapon_balance_descriptions
        (weapon_name, passive_key, tier, description)
    VALUES
        (
            'Atlas',
            'atlas',
            'Divine',
            'Base attack increased by 50%. Every 3rd turn is a guaranteed critical strike. Enemies hit by a critical strike have their attack reduced by 50% for 1 turn.'
        ),
        (
            'Kiri',
            'kiri',
            'Divine',
            'Each attack increases damage by 20%, stacking up to +120%. Each attack has a 25% chance to strike twice as two separate hits.'
        ),
        (
            'Titan',
            'titan',
            'Divine',
            'Damage dealt is increased by 50%. The wielder heals for 30% of all damage dealt. Healing increases to 50% while below 50% HP. Once per battle, upon taking fatal damage, survives at 1 HP and gains +100% damage until the end of battle.'
        ),
        (
            'Gungnir',
            'gungnir',
            'Supreme',
            'Gains +10% ATK at the start of each turn, stacking up to +50%; all stacks reset after battle. Each attack ignores 30% of enemy DEF and has a 20% chance to use 60% total DEF penetration for that attack.'
        );

    IF (SELECT COUNT(*) FROM _targeted_weapon_balance_descriptions) <> 4 THEN
        RAISE EXCEPTION 'Expected exactly 4 targeted weapon descriptions';
    END IF;

    FOR target IN
        SELECT weapon_name, passive_key, tier, description
          FROM _targeted_weapon_balance_descriptions
         ORDER BY weapon_name
    LOOP
        UPDATE public.weapon_roster
           SET passive_description = target.description
         WHERE name = target.weapon_name
           AND passive_key = target.passive_key
           AND tier = target.tier;

        GET DIAGNOSTICS affected = ROW_COUNT;
        IF affected <> 1 THEN
            RAISE EXCEPTION
                'Expected exactly one % weapon row for key %, got %',
                target.weapon_name, target.passive_key, affected;
        END IF;
    END LOOP;

    IF EXISTS (
        SELECT 1
          FROM _targeted_weapon_balance_descriptions AS expected
          LEFT JOIN public.weapon_roster AS actual
            ON actual.name = expected.weapon_name
           AND actual.passive_key = expected.passive_key
           AND actual.tier = expected.tier
         WHERE actual.weapon_roster_id IS NULL
            OR actual.passive_description IS DISTINCT FROM expected.description
    ) THEN
        RAISE EXCEPTION 'Targeted weapon description verification failed';
    END IF;
END;
$targeted_weapon_balance_descriptions$;

COMMIT;

SELECT name, tier, passive_key, passive_description
  FROM public.weapon_roster
 WHERE passive_key IN ('atlas', 'kiri', 'titan', 'gungnir')
 ORDER BY name;
