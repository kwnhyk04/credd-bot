-- Synchronize player-facing roster descriptions with the current production
-- glossary. Echo-type deity rows retain their historical roster keys and their
-- separate runtime_key mapping for combat resolution.
--
-- This migration changes descriptions only. It does not alter passive keys,
-- stats, ownership, equipment, ascension, or combat state.

BEGIN;

DO $passive_audit_descriptions$
DECLARE
    target RECORD;
    affected INTEGER;
BEGIN
    CREATE TEMP TABLE _passive_audit_descriptions (
        roster_type TEXT NOT NULL CHECK (roster_type IN ('deity', 'weapon')),
        roster_name TEXT NOT NULL,
        roster_key TEXT NOT NULL,
        runtime_key TEXT NOT NULL,
        description TEXT NOT NULL,
        PRIMARY KEY (roster_type, roster_key),
        UNIQUE (roster_type, roster_name)
    ) ON COMMIT DROP;

    INSERT INTO _passive_audit_descriptions
        (roster_type, roster_name, roster_key, runtime_key, description)
    VALUES
        ('deity', 'Magwayen', 'magwayen_soul_drain', 'echo_magwayen', 'Heals 30% of all damage actually dealt after mitigation, up to max HP.'),
        ('deity', 'Mandarangan', 'mandarangan_war_frenzy', 'echo_mandarangan', 'End of each turn: +10% ATK, stacking up to +50% (reached turn 5). Stacks persist all battle.'),
        ('deity', 'Apolaki', 'apolaki_solar_burn', 'echo_apolaki', 'Each attack burns the enemy for 10% of the user''s base ATK for 1 turn.'),
        ('deity', 'Dian Masalanta', 'dian_masalanta_devotion', 'echo_dian_masalanta', 'While below 50% HP, ATK +30% and heal 4% max HP each turn.'),
        ('deity', 'Mayari', 'mayari_lunar_veil', 'echo_mayari', 'While below 50% HP, DEF +30% and reflect 15% of damage taken.'),
        ('deity', 'Habagat', 'habagat_monsoon_fury', 'echo_habagat', 'At the start of each turn, 25% chance to empower this turn''s attack, causing it to deal +50% bonus damage.'),
        ('deity', 'Idiyanale', 'idiyanale_persistence', 'echo_idiyanale', 'Every 3rd turn, the next attack deals +75% more damage.'),
        ('deity', 'Lakapati', 'lakapati_abundance', 'echo_lakapati', 'Regenerates 3% max HP at the start of each turn.'),
        ('deity', 'Freya', 'freya_valkyries_embrace', 'echo_freya', 'ATK +30% for the whole battle. Once per battle, at 40% HP or below, restore 20% max HP.'),
        ('deity', 'Surt', 'surt_muspells_flame', 'echo_surt', 'Each attack adds Burn equal to 3% of the user''s base ATK per turn for 2 turns, stacking up to 15%. Attacks deal 50% more damage to enemies that are already burning.'),
        ('deity', 'Tyr', 'tyr_oathkeeper', 'echo_tyr', 'DEF +30% for the whole battle; while below 50% HP, reflects 20% of incoming damage.'),
        ('deity', 'Hel', 'hel_half_dead', 'echo_hel', 'While below 50% HP, ATK +30% and DEF +30%.'),
        ('deity', 'Mimir', 'mimir_runic_knowledge', 'echo_mimir', 'Every 3rd turn, the next attack deals +90% more damage.'),
        ('deity', 'Bragi', 'bragi_battle_hymn', 'echo_bragi', 'ATK +15% for the whole battle.'),
        ('deity', 'Freyr', 'freyr_harvest_bounty', 'echo_freyr', 'Restores 6% max HP every 2 turns.'),
        ('deity', 'Idunn', 'idunn_golden_apple', 'echo_idunn', 'Once per battle, at 50% HP or below, restore 15% max HP.'),
        ('deity', 'Magni', 'magni_might_of_magni', 'echo_magni', '+5% ATK for every 10% max HP missing, up to +25%.'),
        ('deity', 'Njord', 'njord_seas_favor', 'echo_njord', '15% chance each turn to reduce incoming damage by 30%.'),
        ('deity', 'Vidar', 'vidar_silent_vengeance', 'echo_vidar', 'When hit by a critical, Vidar''s next attack is a guaranteed critical. The first time he drops below 50% HP, his next attack also crits.'),
        ('deity', 'Ares', 'ares_blood_frenzy', 'echo_ares', 'At the end of each turn, gain +10% ATK, stacking up to +50%.'),
        ('deity', 'Hades', 'hades_soul_harvest', 'echo_hades', 'While the enemy is below 30% HP, ATK +50% for the rest of the battle.'),
        ('deity', 'Hera', 'hera_divine_wrath', 'echo_hera', 'DEF +30% for the whole battle. When hit by a critical, gain +10% ATK, stacking up to 3 times.'),
        ('deity', 'Apollo', 'apollo_solar_radiance', 'echo_apollo', 'ATK +25% for the whole battle.'),
        ('deity', 'Hephaestus', 'hephaestus_forged_armor', 'echo_hephaestus', 'DEF +25% for the whole battle; while below 50% HP, ATK +20%.'),
        ('deity', 'Nike', 'nike_wings_of_victory', 'echo_nike', 'ATK +15% for the whole battle.'),
        ('deity', 'Persephone', 'persephone_cycle_of_renewal', 'echo_persephone', 'Once per battle, when HP drops below 50%, restore 15% max HP.'),
        ('weapon', 'Alan''s Reversed Hands', 'alans_reversed_hands', 'alans_reversed_hands', 'Increases outgoing damage by 20% and grants immunity to status effects; damage-over-time effects still apply.');

    IF (SELECT COUNT(*) FROM _passive_audit_descriptions WHERE roster_type = 'deity') <> 26
       OR (SELECT COUNT(*) FROM _passive_audit_descriptions WHERE roster_type = 'weapon') <> 1 THEN
        RAISE EXCEPTION 'Expected 26 deity and 1 weapon passive-description updates';
    END IF;

    FOR target IN
        SELECT roster_type, roster_name, roster_key, description
          FROM _passive_audit_descriptions
         ORDER BY roster_type, roster_name
    LOOP
        IF target.roster_type = 'deity' THEN
            UPDATE deity_roster
               SET blessing_description = target.description
             WHERE name = target.roster_name
               AND blessing_key = target.roster_key;
        ELSE
            UPDATE weapon_roster
               SET passive_description = target.description
             WHERE name = target.roster_name
               AND passive_key = target.roster_key;
        END IF;

        GET DIAGNOSTICS affected = ROW_COUNT;
        IF affected <> 1 THEN
            RAISE EXCEPTION 'Expected exactly one % row for % (%), got %',
                target.roster_type, target.roster_name, target.roster_key, affected;
        END IF;
    END LOOP;

    IF EXISTS (
        SELECT 1
          FROM _passive_audit_descriptions AS expected
          LEFT JOIN deity_roster AS actual
            ON actual.name = expected.roster_name
           AND actual.blessing_key = expected.roster_key
         WHERE expected.roster_type = 'deity'
           AND actual.blessing_description IS DISTINCT FROM expected.description
    ) THEN
        RAISE EXCEPTION 'One or more deity descriptions failed exact verification';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM _passive_audit_descriptions AS expected
          LEFT JOIN weapon_roster AS actual
            ON actual.name = expected.roster_name
           AND actual.passive_key = expected.roster_key
         WHERE expected.roster_type = 'weapon'
           AND actual.passive_description IS DISTINCT FROM expected.description
    ) THEN
        RAISE EXCEPTION 'The weapon description failed exact verification';
    END IF;
END;
$passive_audit_descriptions$;

COMMIT;
