-- Read-only verification for 20260803_01_user_presets.sql.
-- Run after the additive migration and before 20260803_05_drop_legacy_loadout.sql.
BEGIN;
SET TRANSACTION READ ONLY;

-- Both slots must exist for every character.
SELECT count(*) AS missing_preset_rows
  FROM public.user_character c
 WHERE NOT EXISTS (
         SELECT 1 FROM public.user_presets p
          WHERE p.discord_id = c.discord_id AND p.slot = 1
       )
    OR NOT EXISTS (
         SELECT 1 FROM public.user_presets p
          WHERE p.discord_id = c.discord_id AND p.slot = 2
       );

-- Slot 1 must match the legacy loadout immediately after backfill.
SELECT count(*) AS slot1_mismatches
  FROM public.user_character c
  JOIN public.user_presets p
    ON p.discord_id = c.discord_id AND p.slot = 1
 WHERE p.equipped_deity_1_id IS DISTINCT FROM c.active_deity_id
    OR p.equipped_deity_2_id IS DISTINCT FROM c.active_deity_id_2
    OR p.equipped_deity_3_id IS DISTINCT FROM c.active_deity_id_3
    OR p.equipped_echo_deity_id IS DISTINCT FROM c.active_echo_deity_id
    OR p.equipped_armor_id   IS DISTINCT FROM c.equipped_armor_id
    OR p.equipped_weapon_id  IS DISTINCT FROM c.equipped_weapon_id;

-- The active pointer must resolve to an existing preset row.
SELECT count(*) AS broken_active_pointers
  FROM public.user_character c
 WHERE NOT EXISTS (
         SELECT 1 FROM public.user_presets p
          WHERE p.discord_id = c.discord_id
            AND p.slot = c.active_preset_slot
       );

-- Echo may only point to deity slot 2 or 3 of the same preset.
SELECT count(*) AS invalid_echo_sources
  FROM public.user_presets
 WHERE equipped_echo_deity_id IS NOT NULL
   AND equipped_echo_deity_id IS DISTINCT FROM equipped_deity_2_id
   AND equipped_echo_deity_id IS DISTINCT FROM equipped_deity_3_id;

-- Existing foreign keys do not enforce same-owner gear/deity references.
SELECT count(*) AS cross_owner_references
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

COMMIT;
