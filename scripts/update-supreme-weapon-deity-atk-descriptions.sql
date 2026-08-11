-- Manual PostgreSQL data update for the Supreme weapon, Odin, and Zeus descriptions.
-- Idempotent: the six keyed descriptions are set to their exact canonical text.
-- The temporary table is transaction-local; this script makes no persistent schema change.

BEGIN;

DO $supreme_deity_descriptions$
DECLARE
    target RECORD;
    affected INTEGER;
    supreme_count INTEGER;
    weapon_count INTEGER := 0;
    deity_count INTEGER := 0;
BEGIN
    CREATE TEMP TABLE _supreme_deity_description_targets (
        roster_type TEXT NOT NULL CHECK (roster_type IN ('weapon', 'deity')),
        registry_key TEXT NOT NULL,
        description TEXT NOT NULL,
        PRIMARY KEY (roster_type, registry_key)
    ) ON COMMIT DROP;

    INSERT INTO _supreme_deity_description_targets (roster_type, registry_key, description)
    VALUES
        ('weapon', 'mjolnir', 'Gains +10% ATK at the start of each turn, stacking up to +50%; all stacks reset after battle. Attacks deal +30% ATK; every 3rd turn, the primary attack deals an additional +200% ATK.'),
        ('weapon', 'gungnir', 'Gains +10% ATK at the start of each turn, stacking up to +50%; all stacks reset after battle. Each attack ignores 30% of enemy DEF and has a 10% chance to pierce all DEF (zero mitigation).'),
        ('weapon', 'thunderbolt_of_zeus', 'Gains +10% ATK at the start of each turn, stacking up to +50%; all stacks reset after battle. Each critical attack deals +100% bonus ATK and applies Paralyze for 1 turn.'),
        ('weapon', 'trident_of_poseidon', 'Gains +10% ATK at the start of each turn, stacking up to +50%; all stacks reset after battle. Every 2nd turn, deals +100% bonus ATK and reduces enemy DEF by 20% for 1 turn, with a 30% chance to stun for 1 turn.'),
        ('deity', 'odin_all_fathers_wisdom', 'Increase ATK by +50%. On even-numbered battle turns, takes 25% less damage and stores the damage prevented. On the immediately following odd-numbered turn, adds the stored amount to the next attack, then clears it. Resets after battle.'),
        ('deity', 'zeus_thunder_sovereign', 'Increase ATK by +50%. Each attack has a 50% chance to deal 50% additional damage and add a 5% DEF shred. The DEF shred stacks up to 6 times (30%) and resets after battle.');

    SELECT COUNT(*)
      INTO supreme_count
      FROM weapon_roster
     WHERE tier = 'Supreme';

    IF supreme_count <> 4 THEN
        RAISE EXCEPTION 'Expected exactly 4 Supreme weapon rows, found %', supreme_count;
    END IF;

    FOR target IN
        SELECT roster_type, registry_key, description
          FROM _supreme_deity_description_targets
         ORDER BY roster_type, registry_key
    LOOP
        IF target.roster_type = 'weapon' THEN
            UPDATE weapon_roster
               SET passive_description = target.description
             WHERE passive_key = target.registry_key
               AND tier = 'Supreme'
               AND NULLIF(BTRIM(passive_description), '') IS NOT NULL;
            weapon_count := weapon_count + 1;
        ELSE
            UPDATE deity_roster
               SET blessing_description = target.description
             WHERE blessing_key = target.registry_key
               AND NULLIF(BTRIM(blessing_description), '') IS NOT NULL;
            deity_count := deity_count + 1;
        END IF;

        GET DIAGNOSTICS affected = ROW_COUNT;
        IF affected <> 1 THEN
            RAISE EXCEPTION 'Expected one % row for key %, got %',
                target.roster_type, target.registry_key, affected;
        END IF;
    END LOOP;

    IF weapon_count <> 4 OR deity_count <> 2 THEN
        RAISE EXCEPTION 'Expected 4 weapon and 2 deity updates, got % and %',
            weapon_count, deity_count;
    END IF;

    IF EXISTS (
        SELECT 1
          FROM _supreme_deity_description_targets target
         WHERE target.roster_type = 'weapon'
           AND 1 <> (
               SELECT COUNT(*)
                 FROM weapon_roster roster
                WHERE roster.passive_key = target.registry_key
                  AND roster.tier = 'Supreme'
                  AND roster.passive_description IS NOT DISTINCT FROM target.description
           )
    ) THEN
        RAISE EXCEPTION 'Supreme weapon description verification failed';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM _supreme_deity_description_targets target
         WHERE target.roster_type = 'deity'
           AND 1 <> (
               SELECT COUNT(*)
                 FROM deity_roster roster
                WHERE roster.blessing_key = target.registry_key
                  AND roster.blessing_description IS NOT DISTINCT FROM target.description
           )
    ) THEN
        RAISE EXCEPTION 'Odin or Zeus description verification failed';
    END IF;
END;
$supreme_deity_descriptions$;

COMMIT;

SELECT name, tier, passive_key, passive_description
  FROM weapon_roster
 WHERE tier = 'Supreme'
 ORDER BY name;

SELECT name, blessing_key, blessing_description
  FROM deity_roster
 WHERE blessing_key IN ('odin_all_fathers_wisdom', 'zeus_thunder_sovereign')
 ORDER BY name;
