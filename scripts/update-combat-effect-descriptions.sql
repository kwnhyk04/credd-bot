-- Manual PostgreSQL update for the combat-effect categorization patch.
-- Echo Apolaki and Echo Surt reuse the canonical deity rows and need no separate rows.

BEGIN;

CREATE TEMP TABLE _combat_description_updates (
    roster_type TEXT NOT NULL CHECK (roster_type IN ('weapon', 'deity')),
    registry_key TEXT NOT NULL,
    description TEXT NOT NULL,
    PRIMARY KEY (roster_type, registry_key)
) ON COMMIT DROP;

INSERT INTO _combat_description_updates (roster_type, registry_key, description)
VALUES
    ('weapon', 'cutlass', 'Each landed hit has a 10% chance to apply Bleed equal to 5% of the user''s base ATK per turn for 2 turns.'),
    ('weapon', 'pata', 'Every landed hit applies Bleed equal to 5% of the user''s base ATK per turn for 2 turns.'),
    ('weapon', 'thyrsus', 'Each turn has a 20% chance to apply Bleed equal to 5% of the user''s base ATK per turn for 2 turns.'),
    ('weapon', 'alans_reversed_hands', 'Immune to all status effects. Does not prevent damage-over-time effects.'),
    ('weapon', 'babaylans_ritual_staff', 'Each turn has a 50% chance to remove all active debuffs, including status and damage-over-time effects. If at least one debuff is removed, gain +100% ATK for 1 turn. Positive buffs are not removed.'),
    ('deity', 'apolaki_solar_burn', 'Every landed hit applies Burn equal to 10% of the user''s base ATK. The Burn deals 1 tick, then expires; later landed hits refresh it.'),
    ('deity', 'surt_muspells_flame', 'Every landed hit adds Burn equal to 5% of the user''s base ATK per turn for 2 turns, stacking up to 30%. Against an already-burning enemy, attacks deal +50% bonus damage.');

DO $combat_descriptions$
DECLARE
    target RECORD;
    affected INTEGER;
BEGIN
    IF (SELECT COUNT(*) FROM _combat_description_updates WHERE roster_type = 'weapon') <> 5
       OR (SELECT COUNT(*) FROM _combat_description_updates WHERE roster_type = 'deity') <> 2 THEN
        RAISE EXCEPTION 'Expected 5 weapon and 2 deity description updates';
    END IF;

    FOR target IN
        SELECT roster_type, registry_key, description
          FROM _combat_description_updates
         ORDER BY roster_type, registry_key
    LOOP
        IF target.roster_type = 'weapon' THEN
            UPDATE weapon_roster
               SET passive_description = target.description
             WHERE passive_key = target.registry_key;
        ELSE
            UPDATE deity_roster
               SET blessing_description = target.description
             WHERE blessing_key = target.registry_key;
        END IF;

        GET DIAGNOSTICS affected = ROW_COUNT;
        IF affected <> 1 THEN
            RAISE EXCEPTION 'Expected one % row for key %, got %',
                target.roster_type, target.registry_key, affected;
        END IF;
    END LOOP;

    IF EXISTS (
        SELECT 1
          FROM _combat_description_updates expected
          LEFT JOIN weapon_roster weapon
            ON expected.roster_type = 'weapon'
           AND weapon.passive_key = expected.registry_key
           AND weapon.passive_description = expected.description
          LEFT JOIN deity_roster deity
            ON expected.roster_type = 'deity'
           AND deity.blessing_key = expected.registry_key
           AND deity.blessing_description = expected.description
         WHERE (expected.roster_type = 'weapon' AND weapon.passive_key IS NULL)
            OR (expected.roster_type = 'deity' AND deity.blessing_key IS NULL)
    ) THEN
        RAISE EXCEPTION 'Description verification failed';
    END IF;
END;
$combat_descriptions$;

COMMIT;
