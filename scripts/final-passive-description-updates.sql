-- Final passive-description synchronization for the balance patch.
-- PostgreSQL only. The transaction aborts unless every expected roster row
-- matches exactly one name/key pair and all 43 descriptions verify exactly.
-- The requested weapon name "Laevateinn" is stored as "Laevateinn Staff".

BEGIN;

CREATE TEMP TABLE _final_passive_updates (
    roster_type TEXT NOT NULL CHECK (roster_type IN ('deity', 'weapon')),
    roster_name TEXT NOT NULL,
    registry_key TEXT NOT NULL,
    description TEXT NOT NULL,
    PRIMARY KEY (roster_type, registry_key),
    UNIQUE (roster_type, roster_name)
) ON COMMIT DROP;

INSERT INTO _final_passive_updates (roster_type, roster_name, registry_key, description)
VALUES
    ('deity', 'Magwayen', 'magwayen_soul_drain', 'Heals 15% of all damage dealt. When an enemy is defeated, recover 20% max HP as their soul is claimed.'),
    ('deity', 'Mandarangan', 'mandarangan_war_frenzy', 'End of each turn: +10% ATK, stacking up to +50% (reached turn 5). Stacks persist all battle.'),
    ('deity', 'Sidapa', 'sidapa_deaths_reprieve', 'Once per battle, the first lethal hit leaves Sidapa at 1 HP. He then heals 30% max HP and gains +50% ATK for the rest of the battle.'),
    ('deity', 'Apolaki', 'apolaki_solar_burn', 'Each of Apolaki''s attacks applies Burn to the enemy equal to 10% of Apolaki''s ATK. The Burn deals its damage at the end of the enemy''s next turn, then expires. Each hit refreshes it.'),
    ('deity', 'Dian Masalanta', 'dian_masalanta_devotion', 'While below 50% HP, ATK +30% and heal 4% max HP each turn.'),
    ('deity', 'Mayari', 'mayari_lunar_veil', 'While below 50% HP, DEF +30% and reflect 15% of damage taken.'),
    ('deity', 'Amihan', 'amihan_tailwind', '20% chance to evade any incoming attack. Each successful evade grants +20% ATK to her next attack.'),
    ('deity', 'Habagat', 'habagat_monsoon_fury', 'At the start of each turn, 25% chance to empower this turn''s attack, causing it to deal +50% bonus damage.'),
    ('deity', 'Idiyanale', 'idiyanale_persistence', 'Every 3rd turn, the next attack deals +75% more damage.'),
    ('deity', 'Lakapati', 'lakapati_abundance', 'Regenerates 3% max HP at the start of each turn.'),
    ('deity', 'Freya', 'freya_valkyries_embrace', 'ATK +30% for the whole battle. Once per battle, at 40% HP or below, restore 20% max HP.'),
    ('deity', 'Loki', 'loki_illusory_double', '25% chance each turn to evade an attack and counter for 50% ATK.'),
    ('deity', 'Skadi', 'skadi_winters_hunt', 'Each turn, Skadi''s attack has a 30% chance to Freeze the enemy (skips its next turn). After the Freeze ends, the enemy suffers Frostbite, taking +50% damage from all sources for 1 turn.'),
    ('deity', 'Surt', 'surt_muspells_flame', 'Every attack applies Burn equal to 5% of ATK per turn for 2 turns. Burn stacks with each hit, up to a maximum of 30% ATK per turn. Against an already-burning enemy, attacks deal +50% bonus damage.'),
    ('deity', 'Thor', 'thor_mjolnirs_wrath', 'Each attack has a 30% chance to Stun the enemy (skips its next turn) and applies Paralyze for 3 turns. While paralyzed, the enemy takes paralysis damage equal to 20% of Thor''s ATK each turn and has a 10% chance per turn to skip that turn.'),
    ('deity', 'Tyr', 'tyr_oathkeeper', 'DEF +30% for the whole battle; while below 50% HP, reflects 20% of incoming damage.'),
    ('deity', 'Baldur', 'baldur_invulnerability', 'Once per battle, the first time Baldur is debuffed or drops below 50% HP, remove all debuffs, restore 15% max HP, and reduce damage taken by 50% for 1 turn.'),
    ('deity', 'Heimdall', 'heimdall_eternal_vigilance', 'The first hit taken each battle is reduced by 50%. For the rest of the battle, damage from incoming critical hits is reduced by 30%.'),
    ('deity', 'Hel', 'hel_half_dead', 'While below 50% HP, ATK +30% and DEF +30%.'),
    ('deity', 'Mimir', 'mimir_runic_knowledge', 'Every 3rd turn, the next attack deals +90% more damage.'),
    ('deity', 'Bragi', 'bragi_battle_hymn', 'ATK +15% for the whole battle.'),
    ('deity', 'Freyr', 'freyr_harvest_bounty', 'Restores 6% max HP every 2 turns.'),
    ('deity', 'Idunn', 'idunn_golden_apple', 'Once per battle, at 50% HP or below, restore 15% max HP.'),
    ('deity', 'Magni', 'magni_might_of_magni', '+5% ATK for every 10% max HP missing, up to +25%.'),
    ('deity', 'Njord', 'njord_seas_favor', '15% chance each turn to reduce incoming damage by 30%.'),
    ('deity', 'Vidar', 'vidar_silent_vengeance', 'When hit by a critical, Vidar''s next attack is a guaranteed critical. The first time he drops below 50% HP, his next attack also crits.'),
    ('deity', 'Ares', 'ares_blood_frenzy', 'At the end of each turn, gain +10% ATK, stacking up to +50%.'),
    ('deity', 'Hades', 'hades_soul_harvest', 'While the enemy is below 30% HP, ATK +50% for the rest of the battle.'),
    ('deity', 'Hera', 'hera_divine_wrath', 'DEF +30% for the whole battle. When hit by a critical, gain +10% ATK, stacking up to 3 times.'),
    ('deity', 'Poseidon', 'poseidon_tidal_force', 'Each attack has a 30% chance to Stun the enemy (skips its next turn) and shred its DEF by 30% for 2 turns. The shred refreshes on each proc but does not stack.'),
    ('deity', 'Aphrodite', 'aphrodite_enchanting_aura', '25% chance each turn to Charm the enemy, making it skip its attack.'),
    ('deity', 'Apollo', 'apollo_solar_radiance', 'ATK +25% for the whole battle.'),
    ('deity', 'Artemis', 'artemis_huntress_precision', 'The first attack each battle always crits; afterward, every 3rd turn the next attack automatically crits.'),
    ('deity', 'Athena', 'athena_aegis_shield', 'The first 2 hits taken each battle are reduced by 40%. Afterward, incoming damage is reduced by 10% for the rest of the battle.'),
    ('deity', 'Hephaestus', 'hephaestus_forged_armor', 'DEF +25% for the whole battle; while below 50% HP, ATK +20%.'),
    ('deity', 'Dionysus', 'dionysus_drunken_haze', '30% chance each turn to make the enemy attack itself for 30% of its own ATK.'),
    ('deity', 'Nike', 'nike_wings_of_victory', 'ATK +15% for the whole battle.'),
    ('deity', 'Persephone', 'persephone_cycle_of_renewal', 'Once per battle, when HP drops below 50%, restore 15% max HP.'),
    ('weapon', 'Gram', 'gram', 'Ignores 25% of enemy DEF. Deals +30% bonus damage to enemies above 80% HP.'),
    ('weapon', 'Laevateinn Staff', 'laevateinn_staff', 'Attacks ignore 15% of enemy DEF and apply Burn equal to 10% of ATK for 2 turns.'),
    ('weapon', 'Spear of Ares', 'spear_of_ares', 'ATK +10% every turn, stacking up to +40%. Whenever you defeat an enemy, immediately gain a stack.'),
    ('weapon', 'Sword of Damocles', 'sword_of_damocles', 'ATK +5% every turn, stacking up to +100%. While any stacks are active, you take +10% damage.'),
    ('weapon', 'Tyrfing', 'tyrfing', 'ATK +10% every turn, stacking up to +30%. Once the enemy drops below 30% HP, the curse takes hold: your attacks can no longer miss or be evaded.');

DO $passive_updates$
DECLARE
    target RECORD;
    affected INTEGER;
BEGIN
    IF (SELECT COUNT(*) FROM _final_passive_updates WHERE roster_type = 'deity') <> 38
       OR (SELECT COUNT(*) FROM _final_passive_updates WHERE roster_type = 'weapon') <> 5 THEN
        RAISE EXCEPTION 'Expected 38 deity and 5 weapon passive updates';
    END IF;

    FOR target IN
        SELECT roster_type, roster_name, registry_key, description
          FROM _final_passive_updates
         ORDER BY roster_type, roster_name
    LOOP
        IF target.roster_type = 'deity' THEN
            UPDATE deity_roster
               SET blessing_description = target.description
             WHERE name = target.roster_name
               AND blessing_key = target.registry_key;
        ELSE
            UPDATE weapon_roster
               SET passive_description = target.description
             WHERE name = target.roster_name
               AND passive_key = target.registry_key;
        END IF;

        GET DIAGNOSTICS affected = ROW_COUNT;
        RAISE NOTICE '% % (%): % row(s)',
            target.roster_type, target.roster_name, target.registry_key, affected;

        IF affected <> 1 THEN
            RAISE EXCEPTION
                'Expected exactly one % row for % with key %, got %',
                target.roster_type, target.roster_name, target.registry_key, affected;
        END IF;
    END LOOP;
END
$passive_updates$;

DO $passive_verification$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM _final_passive_updates AS update_row
          LEFT JOIN deity_roster AS roster
            ON roster.name = update_row.roster_name
           AND roster.blessing_key = update_row.registry_key
         WHERE update_row.roster_type = 'deity'
           AND roster.blessing_description IS DISTINCT FROM update_row.description
    ) THEN
        RAISE EXCEPTION 'One or more deity passive descriptions failed exact verification';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM _final_passive_updates AS update_row
          LEFT JOIN weapon_roster AS roster
            ON roster.name = update_row.roster_name
           AND roster.passive_key = update_row.registry_key
         WHERE update_row.roster_type = 'weapon'
           AND roster.passive_description IS DISTINCT FROM update_row.description
    ) THEN
        RAISE EXCEPTION 'One or more weapon passive descriptions failed exact verification';
    END IF;
END
$passive_verification$;

-- Updated rows, for review before COMMIT is returned to the client.
SELECT 'deity' AS roster_type,
       roster.name AS roster_name,
       roster.blessing_key AS registry_key,
       roster.blessing_description AS description
  FROM deity_roster AS roster
  JOIN _final_passive_updates AS update_row
    ON update_row.roster_type = 'deity'
   AND update_row.roster_name = roster.name
   AND update_row.registry_key = roster.blessing_key
UNION ALL
SELECT 'weapon' AS roster_type,
       roster.name AS roster_name,
       roster.passive_key AS registry_key,
       roster.passive_description AS description
  FROM weapon_roster AS roster
  JOIN _final_passive_updates AS update_row
    ON update_row.roster_type = 'weapon'
   AND update_row.roster_name = roster.name
   AND update_row.registry_key = roster.passive_key
ORDER BY roster_type, roster_name;

-- Roster entries intentionally untouched by this patch.
SELECT 'deity' AS roster_type, roster.name AS roster_name, roster.blessing_key AS registry_key
  FROM deity_roster AS roster
 WHERE NOT EXISTS (
       SELECT 1
         FROM _final_passive_updates AS update_row
        WHERE update_row.roster_type = 'deity'
          AND update_row.roster_name = roster.name
          AND update_row.registry_key = roster.blessing_key
 )
UNION ALL
SELECT 'weapon' AS roster_type, roster.name AS roster_name, roster.passive_key AS registry_key
  FROM weapon_roster AS roster
 WHERE NOT EXISTS (
       SELECT 1
         FROM _final_passive_updates AS update_row
        WHERE update_row.roster_type = 'weapon'
          AND update_row.roster_name = roster.name
          AND update_row.registry_key = roster.passive_key
 )
ORDER BY roster_type, roster_name;

COMMIT;
