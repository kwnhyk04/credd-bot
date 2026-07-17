-- Incremental PostgreSQL patch for user-worded deity passive descriptions.
-- Only deity_roster.blessing_description is modified.

BEGIN;

UPDATE deity_roster
   SET blessing_description = 'Once per battle, the first lethal hit leaves the user at 1 HP. The user then heals 30% max HP and gains +50% ATK for the rest of the battle.'
 WHERE name = 'Sidapa'
   AND blessing_key = 'sidapa_deaths_reprieve';

UPDATE deity_roster
   SET blessing_description = 'Each turn, the user''s attack has a 30% chance to Freeze the enemy (skips its next turn). After the Freeze ends, the enemy suffers Frostbite, taking +50% damage from all sources for 1 turn.'
 WHERE name = 'Skadi'
   AND blessing_key = 'skadi_winters_hunt';

UPDATE deity_roster
   SET blessing_description = 'Each attack has a 30% chance to Stun the enemy (skips its next turn) and applies Paralyze for 3 turns. While paralyzed, the enemy takes paralysis damage equal to 20% of the user''s base ATK each turn and has a 10% chance per turn to skip that turn.'
 WHERE name = 'Thor'
   AND blessing_key = 'thor_mjolnirs_wrath';

UPDATE deity_roster
   SET blessing_description = 'Every landed hit applies Burn equal to 10% of the user''s base ATK. The Burn deals 1 tick, then expires; later landed hits refresh it.'
 WHERE name = 'Apolaki'
   AND blessing_key = 'apolaki_solar_burn';

UPDATE deity_roster
   SET blessing_description = 'Once per battle, the first time the user is debuffed or drops below 50% HP, remove all debuffs, restore 15% max HP, and reduce damage taken by 50% for 1 turn.'
 WHERE name = 'Baldur'
   AND blessing_key = 'baldur_invulnerability';

DO $verify_user_wording$
DECLARE
    exact_matches INTEGER;
BEGIN
    SELECT COUNT(*)
      INTO exact_matches
      FROM (VALUES
        ('Sidapa', 'sidapa_deaths_reprieve', 'Once per battle, the first lethal hit leaves the user at 1 HP. The user then heals 30% max HP and gains +50% ATK for the rest of the battle.'),
        ('Skadi', 'skadi_winters_hunt', 'Each turn, the user''s attack has a 30% chance to Freeze the enemy (skips its next turn). After the Freeze ends, the enemy suffers Frostbite, taking +50% damage from all sources for 1 turn.'),
        ('Thor', 'thor_mjolnirs_wrath', 'Each attack has a 30% chance to Stun the enemy (skips its next turn) and applies Paralyze for 3 turns. While paralyzed, the enemy takes paralysis damage equal to 20% of the user''s base ATK each turn and has a 10% chance per turn to skip that turn.'),
        ('Apolaki', 'apolaki_solar_burn', 'Every landed hit applies Burn equal to 10% of the user''s base ATK. The Burn deals 1 tick, then expires; later landed hits refresh it.'),
        ('Baldur', 'baldur_invulnerability', 'Once per battle, the first time the user is debuffed or drops below 50% HP, remove all debuffs, restore 15% max HP, and reduce damage taken by 50% for 1 turn.')
      ) AS expected(name, blessing_key, description)
      JOIN deity_roster AS roster
        ON roster.name = expected.name
       AND roster.blessing_key = expected.blessing_key
       AND roster.blessing_description = expected.description;

    IF exact_matches <> 5 THEN
        RAISE EXCEPTION 'Expected 5 exact deity passive-description matches, found %', exact_matches;
    END IF;
END
$verify_user_wording$;

SELECT name, blessing_key, blessing_description
  FROM deity_roster
 WHERE blessing_key IN (
    'sidapa_deaths_reprieve',
    'skadi_winters_hunt',
    'thor_mjolnirs_wrath',
    'apolaki_solar_burn',
    'baldur_invulnerability'
 )
 ORDER BY name;

COMMIT;
