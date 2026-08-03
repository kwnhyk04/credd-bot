-- Deferred cleanup migration for Monthsary Phase 2 A.
-- NEVER run this with 20260803_01_user_presets.sql.
-- Run only after the A runtime cutover is deployed, the verification file returns
-- zero for its integrity checks, and the old-column code/catalog sweep is clean.
BEGIN;

DO $drop_legacy_loadout_guard$
DECLARE
    missing_preset_rows bigint;
    broken_active_pointers bigint;
    invalid_echo_sources bigint;
    cross_owner_references bigint;
BEGIN
    IF to_regclass('public.user_presets') IS NULL THEN
        RAISE EXCEPTION 'Refusing legacy-loadout drop: public.user_presets does not exist';
    END IF;

    SELECT count(*)
      INTO missing_preset_rows
      FROM public.user_character c
     WHERE NOT EXISTS (
             SELECT 1 FROM public.user_presets p
              WHERE p.discord_id = c.discord_id AND p.slot = 1
           )
        OR NOT EXISTS (
             SELECT 1 FROM public.user_presets p
              WHERE p.discord_id = c.discord_id AND p.slot = 2
           );

    SELECT count(*)
      INTO broken_active_pointers
      FROM public.user_character c
     WHERE NOT EXISTS (
             SELECT 1 FROM public.user_presets p
              WHERE p.discord_id = c.discord_id
                AND p.slot = c.active_preset_slot
           );

    SELECT count(*)
      INTO invalid_echo_sources
      FROM public.user_presets
     WHERE equipped_echo_deity_id IS NOT NULL
       AND equipped_echo_deity_id IS DISTINCT FROM equipped_deity_2_id
       AND equipped_echo_deity_id IS DISTINCT FROM equipped_deity_3_id;

    SELECT count(*)
      INTO cross_owner_references
      FROM public.user_presets p
      LEFT JOIN public.user_weapons uw ON uw.weapon_id = p.equipped_weapon_id
      LEFT JOIN public.user_armors ua ON ua.armor_id = p.equipped_armor_id
      LEFT JOIN public.user_deities d1 ON d1.user_deity_id = p.equipped_deity_1_id
      LEFT JOIN public.user_deities d2 ON d2.user_deity_id = p.equipped_deity_2_id
      LEFT JOIN public.user_deities d3 ON d3.user_deity_id = p.equipped_deity_3_id
      LEFT JOIN public.user_deities de ON de.user_deity_id = p.equipped_echo_deity_id
     WHERE (uw.weapon_id IS NOT NULL AND uw.discord_id <> p.discord_id)
        OR (ua.armor_id IS NOT NULL AND ua.discord_id <> p.discord_id)
        OR (d1.user_deity_id IS NOT NULL AND d1.discord_id <> p.discord_id)
        OR (d2.user_deity_id IS NOT NULL AND d2.discord_id <> p.discord_id)
        OR (d3.user_deity_id IS NOT NULL AND d3.discord_id <> p.discord_id)
        OR (de.user_deity_id IS NOT NULL AND de.discord_id <> p.discord_id);

    IF missing_preset_rows <> 0
       OR broken_active_pointers <> 0
       OR invalid_echo_sources <> 0
       OR cross_owner_references <> 0 THEN
        RAISE EXCEPTION
          'Refusing legacy-loadout drop: missing=%, broken_active=%, invalid_echo=%, cross_owner=%',
          missing_preset_rows, broken_active_pointers,
          invalid_echo_sources, cross_owner_references;
    END IF;
END;
$drop_legacy_loadout_guard$;

ALTER TABLE public.user_character
  DROP COLUMN active_deity_id,
  DROP COLUMN active_deity_id_2,
  DROP COLUMN active_deity_id_3,
  DROP COLUMN active_echo_deity_id,
  DROP COLUMN equipped_armor_id,
  DROP COLUMN equipped_weapon_id;

COMMIT;
