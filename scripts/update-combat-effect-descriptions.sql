-- Manual PostgreSQL update for the combat-effect categorization patch.
-- Echo Apolaki and Echo Surt reuse the canonical deity rows and need no separate rows.

BEGIN;

DO $combat_descriptions$
DECLARE
    target RECORD;
    affected INTEGER;
    weapon_count INTEGER := 0;
    deity_count INTEGER := 0;
BEGIN
    FOR target IN
        SELECT updates.roster_type, updates.registry_key, updates.description
          FROM (VALUES
              ('weapon', 'cutlass', 'Each landed hit has a 10% chance to apply Bleed equal to 5% of the user''s base ATK per turn for 2 turns.'),
              ('weapon', 'pata', 'Every landed hit applies Bleed equal to 5% of the user''s base ATK per turn for 2 turns.'),
              ('weapon', 'thyrsus', 'Each turn has a 20% chance to apply Bleed equal to 5% of the user''s base ATK per turn for 2 turns.'),
              ('weapon', 'alans_reversed_hands', 'Immune to all status effects. Does not prevent damage-over-time effects.'),
              ('weapon', 'babaylans_ritual_staff', 'Each turn has a 50% chance to remove all active debuffs, including status and damage-over-time effects. If at least one debuff is removed, gain +100% ATK for 1 turn. Positive buffs are not removed.'),
              ('deity', 'apolaki_solar_burn', 'Every landed hit applies Burn equal to 10% of the user''s base ATK. The Burn deals 1 tick, then expires; later landed hits refresh it.'),
              ('deity', 'surt_muspells_flame', 'Every landed hit adds Burn equal to 5% of the user''s base ATK per turn for 2 turns, stacking up to 30%. Against an already-burning enemy, attacks deal +50% bonus damage.')
          ) AS updates(roster_type, registry_key, description)
         ORDER BY updates.roster_type, updates.registry_key
    LOOP
        IF target.roster_type = 'weapon' THEN
            UPDATE weapon_roster
               SET passive_description = target.description
             WHERE passive_key = target.registry_key;
            weapon_count := weapon_count + 1;
        ELSE
            UPDATE deity_roster
               SET blessing_description = target.description
             WHERE blessing_key = target.registry_key;
            deity_count := deity_count + 1;
        END IF;

        GET DIAGNOSTICS affected = ROW_COUNT;
        IF affected <> 1 THEN
            RAISE EXCEPTION 'Expected one % row for key %, got %',
                target.roster_type, target.registry_key, affected;
        END IF;
    END LOOP;

    IF weapon_count <> 5 OR deity_count <> 2 THEN
        RAISE EXCEPTION 'Expected 5 weapon and 2 deity description updates, got % and %',
            weapon_count, deity_count;
    END IF;
END;
$combat_descriptions$;

COMMIT;
