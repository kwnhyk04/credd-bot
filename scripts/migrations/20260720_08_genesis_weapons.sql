-- ============================================================================
-- 20260720_08_genesis_weapons.sql
-- Purpose: seed the five Genesis-tier weapons and their exact passive registry
--          keys: Kiri/kiri, Moira/moira, Sophia/sophia, Atlas/atlas,
--          Titan/titan.
--          Base stats are fixed in code (1600 ATK / 20% crit / +50% damage);
--          weapon_roster has no stat columns.
-- Affected objects:
--   * public.weapon_roster tier/type CHECK constraints
--   * public.weapon_roster rows 78-82 (inserted or repaired by upsert)
-- Safe to rerun: YES. Exact id/name collisions abort the transaction; rows with
--                the expected ids and names are restored to canonical values,
--                including passive_key.
-- Run BEFORE enabling Genesis Chest opening in code.
-- ============================================================================

-- Preview: review ids/names and the existing constrained values before running.
SELECT MAX(weapon_roster_id) AS max_id FROM public.weapon_roster;
SELECT weapon_roster_id, name, type, tier, passive_key, passive_name
  FROM public.weapon_roster
 WHERE weapon_roster_id BETWEEN 78 AND 82
    OR lower(name) IN ('kiri', 'moira', 'sophia', 'atlas', 'titan')
 ORDER BY weapon_roster_id;
SELECT DISTINCT tier FROM public.weapon_roster ORDER BY tier;
SELECT DISTINCT type FROM public.weapon_roster ORDER BY type;
SELECT conname, pg_get_constraintdef(oid) AS definition
  FROM pg_constraint
 WHERE conrelid = 'public.weapon_roster'::regclass
   AND contype = 'c'
 ORDER BY conname;

BEGIN;

-- The checked-in base schema predates these two values. Live constraint names
-- may have drifted, so drop every CHECK that actually references tier or type,
-- then install the two canonical constraints. Run this complete DO statement.
DO $genesis_weapon_constraints$
DECLARE
  constraint_row record;
BEGIN
  FOR constraint_row IN
    SELECT c.conname
      FROM pg_constraint AS c
     WHERE c.conrelid = 'public.weapon_roster'::regclass
       AND c.contype = 'c'
       AND EXISTS (
         SELECT 1
           FROM unnest(c.conkey) AS constrained_column(attnum)
           JOIN pg_attribute AS a
             ON a.attrelid = c.conrelid
            AND a.attnum = constrained_column.attnum
          WHERE a.attname IN ('tier', 'type')
       )
  LOOP
    EXECUTE format(
      'ALTER TABLE public.weapon_roster DROP CONSTRAINT %I',
      constraint_row.conname
    );
  END LOOP;

  ALTER TABLE public.weapon_roster
    ADD CONSTRAINT weapon_roster_tier_check
    CHECK (tier IN ('Common', 'Rare', 'Mythic', 'Legendary', 'Supreme', 'Genesis'));

  ALTER TABLE public.weapon_roster
    ADD CONSTRAINT weapon_roster_type_check
    CHECK (type IN ('Sword', 'Staff', 'Gloves', 'Bow', 'Greatsword'));
END
$genesis_weapon_constraints$;

-- Never overwrite an unrelated row or create a second row for a Genesis name.
-- An expected id/name pair is safe and will be repaired by the upsert below.
-- IMPORTANT: execute this entire DO statement, starting at DO and ending at
-- $genesis_collision_guard$;. Running only the inner BEGIN block is invalid SQL.
DO $genesis_collision_guard$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.weapon_roster AS w
      JOIN (VALUES
        (78, 'Kiri'),
        (79, 'Moira'),
        (80, 'Sophia'),
        (81, 'Atlas'),
        (82, 'Titan')
      ) AS expected(weapon_roster_id, name)
        ON w.weapon_roster_id = expected.weapon_roster_id
        OR lower(w.name) = lower(expected.name)
     WHERE w.weapon_roster_id IS DISTINCT FROM expected.weapon_roster_id
        OR lower(w.name) IS DISTINCT FROM lower(expected.name)
  ) THEN
    RAISE EXCEPTION
      'Genesis weapon migration aborted: ids 78-82 or Genesis names collide with unrelated weapon_roster rows';
  END IF;
END
$genesis_collision_guard$;

-- Explicit passive_key values are the authoritative keys exported by
-- src/engine/passiveRegistry.js and listed in passive_registry_keys.md.
INSERT INTO public.weapon_roster
  (weapon_roster_id, name, type, tier, mythology, passive_key, passive_name,
   passive_description, lore, image_filename, is_available)
VALUES
  (78, 'Kiri', 'Sword', 'Genesis', 'Japanese', 'kiri', 'Thousand Partings',
   'Each attack increases damage by 20%, stacking up to +120%. Every attack has a 25% chance to strike twice.',
   'From the Japanese word for both "cut" and "mist." When nothing yet had edges, Kiri made the first one. It divided light from dark, sky from sea. The blade has no true form, only the memory of separation itself, wrapped in mist. Those who wield it do not swing a sword. They remind the world where things end.',
   'kiri.png', true),
  (79, 'Moira', 'Bow', 'Genesis', 'Greek', 'moira', 'Fate Ignores Iron',
   'All attacks reduce the target''s defense by 10%, stacking up to 50%. Ignores 50% of defense against targets with a defense buff active. Attacks cannot miss.',
   'From the Greek word for "fate." The Moirai were the three Fates who spun, measured, and cut the thread of every mortal life. The Forger strung this bow with a single thread pulled from the tapestry of fate. Every arrow fired is a destiny fulfilled. Moira never misses, because Moira never aims. It remembers.',
   'moira.png', true),
  (80, 'Sophia', 'Staff', 'Genesis', 'Greek', 'sophia', 'The Price of Knowing',
   'All damage dealt is increased by 75%, but the wielder takes 20% more damage. When the wielder drops below 30% HP, damage dealt increases to +150% for the rest of the battle.',
   'From the Greek word for "wisdom," the root of "philosophy." The first question ever asked was answered by Sophia. It holds everything the Forger learned while building the world. It does not cast magic. It explains to reality, patiently, why things should be otherwise. And reality, humbled, obeys.',
   'sophia.png', true),
  (81, 'Atlas', 'Gloves', 'Genesis', 'Greek', 'atlas', 'Worldbreaker''s Grip',
   'Base attack increased by 50%. Every 3rd turn is a guaranteed critical strike. Enemies hit by a critical strike have their attack reduced by 30% for 1 turn.',
   'From the Greek Titan condemned to hold up the heavens, whose name means "to bear." When the newborn sky threatened to collapse back into the void, the Forger shaped gauntlets strong enough to hold it up until creation could stand on its own. Atlas has carried the weight of the world once already. No burden since has ever felt heavy.',
   'atlas.png', true),
  (82, 'Titan', 'Greatsword', 'Genesis', 'Greek', 'titan', 'Forgefire Veins',
   'The wielder heals for 30% of all damage dealt. Healing increases to 50% while below 50% HP. Once per battle, upon taking fatal damage, survive at 1 HP and gain +100% damage until the end of battle.',
   'From the Greek primordial giants who ruled before the gods, the raw first draft of divinity. The last weapon the Forger made, and the only one never completed. It still burns with unfinished creation fire at its core. Legends say the blade grows closer to completion with every worthy Knight who carries it.',
   'titan.png', true)
ON CONFLICT (weapon_roster_id) DO UPDATE SET
  name = EXCLUDED.name,
  type = EXCLUDED.type,
  tier = EXCLUDED.tier,
  mythology = EXCLUDED.mythology,
  passive_key = EXCLUDED.passive_key,
  passive_name = EXCLUDED.passive_name,
  passive_description = EXCLUDED.passive_description,
  lore = EXCLUDED.lore,
  image_filename = EXCLUDED.image_filename,
  is_available = EXCLUDED.is_available;

-- Fail before commit unless every database row has the exact registry mapping.
-- IMPORTANT: execute the complete named DO statement as one query.
DO $genesis_key_validation$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM (VALUES
        (78, 'Kiri', 'kiri'),
        (79, 'Moira', 'moira'),
        (80, 'Sophia', 'sophia'),
        (81, 'Atlas', 'atlas'),
        (82, 'Titan', 'titan')
      ) AS expected(weapon_roster_id, name, passive_key)
      LEFT JOIN public.weapon_roster AS w
        ON w.weapon_roster_id = expected.weapon_roster_id
     WHERE w.weapon_roster_id IS NULL
        OR w.name IS DISTINCT FROM expected.name
        OR w.tier IS DISTINCT FROM 'Genesis'
        OR w.passive_key IS DISTINCT FROM expected.passive_key
  ) THEN
    RAISE EXCEPTION
      'Genesis weapon migration validation failed: expected passive_key registry mappings were not stored';
  END IF;
END
$genesis_key_validation$;

-- Keep the id sequence ahead of the explicit ids so future serial inserts
-- cannot collide.
SELECT setval('weapon_roster_weapon_roster_id_seq',
              GREATEST((SELECT MAX(weapon_roster_id) FROM public.weapon_roster), 82));

COMMIT;

-- Validation: all five rows must report passive_key_ok = true.
SELECT w.weapon_roster_id,
       w.name,
       w.type,
       w.tier,
       w.passive_key,
       expected.passive_key AS expected_passive_key,
       (w.passive_key = expected.passive_key) AS passive_key_ok,
       w.is_available
  FROM (VALUES
    (78, 'Kiri', 'kiri'),
    (79, 'Moira', 'moira'),
    (80, 'Sophia', 'sophia'),
    (81, 'Atlas', 'atlas'),
    (82, 'Titan', 'titan')
  ) AS expected(weapon_roster_id, name, passive_key)
  LEFT JOIN public.weapon_roster AS w
    ON w.weapon_roster_id = expected.weapon_roster_id
 ORDER BY expected.weapon_roster_id;

-- Notes:
-- * A rerun repairs a missing or incorrect passive_key on the expected rows.
-- * If the preview exposes an id/name collision, the transaction aborts without
--   overwriting unrelated data; resolve the collision before rerunning.
-- * The CHECK constraints now admit Genesis and Greatsword. If unexpected live
--   tier/type values exist, adding the constraints fails and rolls back; review
--   the preview instead of silently broadening the allowed catalog.
-- * items.txt: upload the five weapon emojis and replace their placeholder ids.
-- * Rollback: see 20260720_09_rollback.sql.

BEGIN;

ALTER TABLE public.user_weapons
  DROP CONSTRAINT IF EXISTS user_weapons_enhancement_check;

ALTER TABLE public.user_weapons
  ADD CONSTRAINT user_weapons_enhancement_check
  CHECK (enhancement >= 1 AND enhancement <= 21);

COMMIT;