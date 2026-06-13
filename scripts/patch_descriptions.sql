-- =====================================================================
-- PATCH — grammar-corrected passive / blessing / skill descriptions
-- Generated from passive_registry_keys.md by scripts/gen_description_patch.js
-- Run by hand in Supabase. Keyed by registry key; names are untouched.
-- =====================================================================

BEGIN;

-- weapon_roster.passive_description
UPDATE weapon_roster SET passive_description = '10% chance to apply flat Bleed on hit.' WHERE passive_key = 'cutlass';
UPDATE weapon_roster SET passive_description = 'The first hit deals +20% ATK.' WHERE passive_key = 'kampilan';
UPDATE weapon_roster SET passive_description = '10% chance to stun the enemy for 1 turn.' WHERE passive_key = 'war_club';
UPDATE weapon_roster SET passive_description = 'The first hit deals +20% ATK.' WHERE passive_key = 'bone_crusher';
UPDATE weapon_roster SET passive_description = '10% chance to deal a +15% ATK bonus hit.' WHERE passive_key = 'crystal_wand';
UPDATE weapon_roster SET passive_description = 'The first hit deals +20% ATK.' WHERE passive_key = 'carved_totem';
UPDATE weapon_roster SET passive_description = '10% chance to block 15% of incoming damage.' WHERE passive_key = 'steel_kite_shield';
UPDATE weapon_roster SET passive_description = 'The first hit deals +20% ATK.' WHERE passive_key = 'reinforced_targe';
UPDATE weapon_roster SET passive_description = '10% chance to deal a +20% ATK bonus hit.' WHERE passive_key = 'recurve_bow';
UPDATE weapon_roster SET passive_description = 'The first hit deals +20% ATK and ignores 25% of enemy DEF.' WHERE passive_key = 'crossbow';
UPDATE weapon_roster SET passive_description = 'Critical hits deal +30% bonus damage on top of the ×2.0 multiplier (×2.30 total).' WHERE passive_key = 'katana';
UPDATE weapon_roster SET passive_description = '30% chance to deal +50% bonus ATK.' WHERE passive_key = 'gladius';
UPDATE weapon_roster SET passive_description = 'ATK +3% every turn, stacking up to 15%.' WHERE passive_key = 'scimitar';
UPDATE weapon_roster SET passive_description = 'Deals 50% more damage to stunned enemies.' WHERE passive_key = 'roman_cestus';
UPDATE weapon_roster SET passive_description = 'Applies flat Bleed on hit (30% ATK per turn for 2 turns).' WHERE passive_key = 'pata';
UPDATE weapon_roster SET passive_description = 'ATK +5% every turn, stacking up to 25%.' WHERE passive_key = 'bagh_nakh';
UPDATE weapon_roster SET passive_description = '25% chance to heal for 50% of the damage dealt.' WHERE passive_key = 'japanese_bo';
UPDATE weapon_roster SET passive_description = '20% chance to deal +50% bonus ATK.' WHERE passive_key = 'english_quarterstaff';
UPDATE weapon_roster SET passive_description = 'Ignores an extra 3% of enemy DEF every turn, stacking up to 15%.' WHERE passive_key = 'egyptian_asa';
UPDATE weapon_roster SET passive_description = '50% chance to reduce enemy DEF by 15% for 1 turn.' WHERE passive_key = 'pilgrims_bordone';
UPDATE weapon_roster SET passive_description = 'Reduces all damage taken by 10% and grants +10% ATK.' WHERE passive_key = 'vatican_aspis';
UPDATE weapon_roster SET passive_description = 'DEF +25% for the first 2 turns.' WHERE passive_key = 'battersea_shield';
UPDATE weapon_roster SET passive_description = '10% chance to reflect 30% of incoming damage back to the attacker.' WHERE passive_key = 'enderby_shield';
UPDATE weapon_roster SET passive_description = 'ATK +3% every turn, stacking up to 15%.' WHERE passive_key = 'holmegaard_bow';
UPDATE weapon_roster SET passive_description = '10% chance to take another turn.' WHERE passive_key = 'scandinavian_glacial_wooden_bow';
UPDATE weapon_roster SET passive_description = '20% chance to deal +50% bonus ATK.' WHERE passive_key = 'scythian_composite_bow';
UPDATE weapon_roster SET passive_description = 'ATK +4% every turn, stacking up to 20%.' WHERE passive_key = 'xiphos';
UPDATE weapon_roster SET passive_description = '25% chance to deal +60% bonus ATK.' WHERE passive_key = 'kopis';
UPDATE weapon_roster SET passive_description = '35% chance to deal +40% bonus ATK.' WHERE passive_key = 'caestus';
UPDATE weapon_roster SET passive_description = 'Deals 40% more damage to stunned enemies.' WHERE passive_key = 'myrmex';
UPDATE weapon_roster SET passive_description = 'ATK +6% every 2 turns, stacking up to 18%.' WHERE passive_key = 'dory';
UPDATE weapon_roster SET passive_description = '20% chance each turn to apply flat Bleed (ATK×0.30 per turn for 2 turns).' WHERE passive_key = 'thyrsus';
UPDATE weapon_roster SET passive_description = 'DEF +20% for the first 3 turns.' WHERE passive_key = 'dipylon_shield';
UPDATE weapon_roster SET passive_description = '15% chance to block 25% of incoming damage.' WHERE passive_key = 'pelte';
UPDATE weapon_roster SET passive_description = '30% chance to deal +45% bonus ATK.' WHERE passive_key = 'arrow_of_eros';
UPDATE weapon_roster SET passive_description = 'ATK +4% every turn, stacking up to 20%.' WHERE passive_key = 'cretan_bow';
UPDATE weapon_roster SET passive_description = 'Deals 30% more damage to bleeding enemies.' WHERE passive_key = 'juru_pakal';
UPDATE weapon_roster SET passive_description = 'Ignores 20% of enemy DEF.' WHERE passive_key = 'gram';
UPDATE weapon_roster SET passive_description = 'ATK +10% every turn, stacking up to 30%.' WHERE passive_key = 'tyrfing';
UPDATE weapon_roster SET passive_description = 'Reduces enemy DEF by 10% every turn, stacking up to 30%.' WHERE passive_key = 'laevateinn_sword';
UPDATE weapon_roster SET passive_description = 'Stunning an enemy triggers Bash for +60% bonus damage.' WHERE passive_key = 'jarngreipr';
UPDATE weapon_roster SET passive_description = '20% chance to ignore incoming damage entirely.' WHERE passive_key = 'gridr_iron_gloves';
UPDATE weapon_roster SET passive_description = 'Immune to all status effects.' WHERE passive_key = 'alans_reversed_hands';
UPDATE weapon_roster SET passive_description = '5% chance to instantly kill the opponent (Bosses excluded).' WHERE passive_key = 'knuckle_charm_anting_anting';
UPDATE weapon_roster SET passive_description = 'Attacks ignore 15% of enemy DEF.' WHERE passive_key = 'laevateinn_staff';
UPDATE weapon_roster SET passive_description = '50% chance to reduce enemy DEF by 30% for 1 turn.' WHERE passive_key = 'galdrastafir';
UPDATE weapon_roster SET passive_description = 'Cleanses all debuffs every turn; whenever a cleanse removes at least one debuff, grants +100% ATK for 1 turn.' WHERE passive_key = 'babaylans_ritual_staff';
UPDATE weapon_roster SET passive_description = '30% chance to Rupture for 10% of the enemy''s max HP (blocked by all bosses).' WHERE passive_key = 'badiang_stalk';
UPDATE weapon_roster SET passive_description = 'Each hit taken grants +5% DEF and +5% ATK, stacking up to 30% each.' WHERE passive_key = 'shield_of_the_valkyrie';
UPDATE weapon_roster SET passive_description = '15% chance to ignore incoming damage entirely.' WHERE passive_key = 'skjaldmaer';
UPDATE weapon_roster SET passive_description = 'While debuffed, gains +40% DEF until the debuff expires.' WHERE passive_key = 'luzon_tribal_shield';
UPDATE weapon_roster SET passive_description = '50% chance to Hemorrhage for 10% of the enemy''s max HP for 1 turn, with -15% DEF while it lasts (blocked by all bosses).' WHERE passive_key = 'gusisnautar';
UPDATE weapon_roster SET passive_description = '50% chance to auto-fire for 100% ATK damage.' WHERE passive_key = 'freyrs_arrow';
UPDATE weapon_roster SET passive_description = 'Ignores 30% of enemy DEF.' WHERE passive_key = 'harpe';
UPDATE weapon_roster SET passive_description = 'ATK +5% every turn, stacking up to +100%; in exchange, takes 5% more damage.' WHERE passive_key = 'sword_of_damocles';
UPDATE weapon_roster SET passive_description = 'Every 3rd turn, the attack hits twice; the second hit deals 70% ATK and both can CRIT.' WHERE passive_key = 'labrys';
UPDATE weapon_roster SET passive_description = 'DEF +20% for the whole battle; every 4th turn, lands a 150% ATK forge strike.' WHERE passive_key = 'hephaestus_hammer';
UPDATE weapon_roster SET passive_description = 'Every 3rd turn, cleanses all debuffs and restores 8% max HP.' WHERE passive_key = 'caduceus';
UPDATE weapon_roster SET passive_description = 'ATK +8% every 2 turns, stacking up to 40%.' WHERE passive_key = 'spear_of_ares';
UPDATE weapon_roster SET passive_description = '25% chance each turn to make the enemy miss its next attack entirely.' WHERE passive_key = 'helm_of_darkness';
UPDATE weapon_roster SET passive_description = '20% chance on hit to add a Stone stack; at 3 stacks, stuns for 1 turn, then resets.' WHERE passive_key = 'aegis';
UPDATE weapon_roster SET passive_description = 'Ignores 25% of enemy DEF; every 4th turn, the attack is a guaranteed CRIT.' WHERE passive_key = 'apollos_silver_bow';
UPDATE weapon_roster SET passive_description = 'Deals +20% bonus ATK every turn; every 4th turn, lands a 200% ATK crush.' WHERE passive_key = 'mjolnir';
UPDATE weapon_roster SET passive_description = 'Ignores 40% of enemy DEF; 30% chance to pierce all DEF (zero mitigation) and reduce enemy DEF by 25% for 1 turn.' WHERE passive_key = 'gungnir';
UPDATE weapon_roster SET passive_description = '30% chance to deal +80% bonus ATK and paralyze for 1 turn; also triggers automatically on a CRIT.' WHERE passive_key = 'thunderbolt_of_zeus';
UPDATE weapon_roster SET passive_description = 'Every 3rd turn, deals +100% bonus ATK and reduces enemy DEF by 20% for 1 turn, with a 25% chance to stun for 1 turn.' WHERE passive_key = 'trident_of_poseidon';
-- (66 rows)

-- deity_roster.blessing_description
UPDATE deity_roster SET blessing_description = 'All stats +20% for the first 3 turns.' WHERE blessing_key = 'bathala_divine_vessel';
UPDATE deity_roster SET blessing_description = 'Once per battle, survive lethal damage at 1 HP.' WHERE blessing_key = 'sidapa_deaths_reprieve';
UPDATE deity_roster SET blessing_description = 'Each attack steals 10% of the damage dealt as HP.' WHERE blessing_key = 'magwayen_soul_drain';
UPDATE deity_roster SET blessing_description = 'ATK +10% every turn, up to 30% (reached by turn 3).' WHERE blessing_key = 'mandarangan_war_frenzy';
UPDATE deity_roster SET blessing_description = 'Every 3rd turn, ignites the enemy with flat Burn (15% ATK per turn for 2 turns).' WHERE blessing_key = 'apolaki_solar_burn';
UPDATE deity_roster SET blessing_description = 'While HP is below 50%, DEF +30%.' WHERE blessing_key = 'mayari_lunar_veil';
UPDATE deity_roster SET blessing_description = 'While HP is below 30%, ATK +25%.' WHERE blessing_key = 'dian_masalanta_devotion';
UPDATE deity_roster SET blessing_description = '20% chance to evade any incoming attack.' WHERE blessing_key = 'amihan_tailwind';
UPDATE deity_roster SET blessing_description = 'Every turn, a 25% chance to unleash a storm strike for +50% bonus ATK.' WHERE blessing_key = 'habagat_monsoon_fury';
UPDATE deity_roster SET blessing_description = 'Regenerates 3% max HP at the start of each turn.' WHERE blessing_key = 'lakapati_abundance';
UPDATE deity_roster SET blessing_description = 'Every 5 turns, the next attack deals double damage.' WHERE blessing_key = 'idiyanale_persistence';
UPDATE deity_roster SET blessing_description = 'On every even turn (2, 4, 6…), takes 50% reduced damage.' WHERE blessing_key = 'odin_all_fathers_wisdom';
UPDATE deity_roster SET blessing_description = 'Every 3rd turn, deals +50% bonus ATK and stuns the enemy for 1 turn.' WHERE blessing_key = 'thor_mjolnirs_wrath';
UPDATE deity_roster SET blessing_description = 'Once per battle, at 40% HP or below, restores 20% max HP and grants +15% ATK for 2 turns.' WHERE blessing_key = 'freya_valkyries_embrace';
UPDATE deity_roster SET blessing_description = '20% chance each turn to evade an attack and counter for 50% ATK.' WHERE blessing_key = 'loki_illusory_double';
UPDATE deity_roster SET blessing_description = 'DEF +20% for the whole battle; while HP is below 50%, reflects 15% of incoming damage.' WHERE blessing_key = 'tyr_oathkeeper';
UPDATE deity_roster SET blessing_description = 'Every 3rd turn, gains +40% ATK and applies Freeze (the enemy skips its next turn).' WHERE blessing_key = 'skadi_winters_hunt';
UPDATE deity_roster SET blessing_description = 'Every attack applies flat Burn (25% ATK per turn for 2 turns); Burn deals +50% against already-burning enemies.' WHERE blessing_key = 'surt_muspells_flame';
UPDATE deity_roster SET blessing_description = 'The first hit taken each battle is reduced by 50%.' WHERE blessing_key = 'heimdall_eternal_vigilance';
UPDATE deity_roster SET blessing_description = 'Once per battle, on the first turn Baldur is debuffed or drops below 50% HP, removes all debuffs and restores 10% max HP.' WHERE blessing_key = 'baldur_invulnerability';
UPDATE deity_roster SET blessing_description = 'While HP is below 50%, DEF +15% and ATK +15%.' WHERE blessing_key = 'hel_half_dead';
UPDATE deity_roster SET blessing_description = 'Every 4 turns, the next attack deals 65% more damage.' WHERE blessing_key = 'mimir_runic_knowledge';
UPDATE deity_roster SET blessing_description = 'Restores 5% max HP every 2 turns.' WHERE blessing_key = 'freyr_harvest_bounty';
UPDATE deity_roster SET blessing_description = '15% chance each turn to reduce incoming damage by 30%.' WHERE blessing_key = 'njord_seas_favor';
UPDATE deity_roster SET blessing_description = 'Every 3 turns, grants +8% ATK for 2 turns.' WHERE blessing_key = 'bragi_battle_hymn';
UPDATE deity_roster SET blessing_description = 'Once per battle, at 50% HP or below, restores 15% max HP.' WHERE blessing_key = 'idunn_golden_apple';
UPDATE deity_roster SET blessing_description = 'When hit by a critical, the next attack automatically crits in return.' WHERE blessing_key = 'vidar_silent_vengeance';
UPDATE deity_roster SET blessing_description = 'ATK +5% for every 10% of HP lost, up to 25%.' WHERE blessing_key = 'magni_might_of_magni';
UPDATE deity_roster SET blessing_description = 'Every 3rd turn, deals +80% bonus ATK and reduces enemy DEF by 20% for 1 turn.' WHERE blessing_key = 'zeus_thunder_sovereign';
UPDATE deity_roster SET blessing_description = 'ATK +8% every 2 turns, stacking up to 40% (reached by turn 10).' WHERE blessing_key = 'ares_blood_frenzy';
UPDATE deity_roster SET blessing_description = 'Every 4 turns, deals +60% bonus ATK with a 40% chance to stun for 1 turn.' WHERE blessing_key = 'poseidon_tidal_force';
UPDATE deity_roster SET blessing_description = 'While the enemy''s HP is below 30%, ATK +35% for the rest of the battle.' WHERE blessing_key = 'hades_soul_harvest';
UPDATE deity_roster SET blessing_description = 'When hit by a critical, gains +10% DEF and +10% ATK, stacking up to 3 times.' WHERE blessing_key = 'hera_divine_wrath';
UPDATE deity_roster SET blessing_description = 'The first 2 hits taken each battle are reduced by 40%.' WHERE blessing_key = 'athena_aegis_shield';
UPDATE deity_roster SET blessing_description = 'ATK +20% for the whole battle.' WHERE blessing_key = 'apollo_solar_radiance';
UPDATE deity_roster SET blessing_description = 'The first attack each battle always crits; afterward, every 4 turns the next attack automatically crits.' WHERE blessing_key = 'artemis_huntress_precision';
UPDATE deity_roster SET blessing_description = 'DEF +20% for the whole battle; when HP drops below 50%, ATK +15%.' WHERE blessing_key = 'hephaestus_forged_armor';
UPDATE deity_roster SET blessing_description = '20% chance each turn to charm the enemy, making it skip its attack.' WHERE blessing_key = 'aphrodite_enchanting_aura';
UPDATE deity_roster SET blessing_description = 'Once per battle, when HP drops below 50%, restores 20% max HP.' WHERE blessing_key = 'persephone_cycle_of_renewal';
UPDATE deity_roster SET blessing_description = '30% chance each turn to make the enemy attack itself for 30% of its own ATK.' WHERE blessing_key = 'dionysus_drunken_haze';
UPDATE deity_roster SET blessing_description = 'ATK +25% for the whole battle.' WHERE blessing_key = 'nike_wings_of_victory';
-- (41 rows)

-- mob_roster.skill_description
UPDATE mob_roster SET skill_description = '25% chance to reduce the player''s ATK by 15% for 1 turn.' WHERE skill_key = 'dwende_black_hex';
UPDATE mob_roster SET skill_description = '20% chance to reduce the player''s CRIT by 50% for 1 turn.' WHERE skill_key = 'dwende_white_daze';
UPDATE mob_roster SET skill_description = '30% chance on hit to inflict Rot (5% max HP per turn for 2 turns).' WHERE skill_key = 'amalanhig_infectious_bite';
UPDATE mob_roster SET skill_description = 'Every 3rd turn, deals 150% ATK.' WHERE skill_key = 'amomongo_rend';
UPDATE mob_roster SET skill_description = 'While the player''s HP is below 30%, ATK +20%.' WHERE skill_key = 'bal_bal_carrion_sense';
UPDATE mob_roster SET skill_description = '20% chance each turn to make the player skip their next attack.' WHERE skill_key = 'santelmo_will_o_wisp';
UPDATE mob_roster SET skill_description = 'Every 3 turns, drains 15% of the player''s max HP and heals itself.' WHERE skill_key = 'manananggal_viscera_drain';
UPDATE mob_roster SET skill_description = 'Every 4 turns, copies the player''s current ATK for 2 turns.' WHERE skill_key = 'aswang_shape_shift';
UPDATE mob_roster SET skill_description = 'Every 3 turns, reduces the player''s ATK by 20% for 1 turn.' WHERE skill_key = 'tikbalang_disorientation';
UPDATE mob_roster SET skill_description = 'Every 4 turns, reduces the player''s CRIT by 30% and ATK by 10% for 1 turn.' WHERE skill_key = 'kapre_smoke_cloud';
UPDATE mob_roster SET skill_description = '20% chance to evade any incoming attack.' WHERE skill_key = 'sigbin_shadow_step';
UPDATE mob_roster SET skill_description = 'Every 4 turns, paralyzes the player for 1 turn (guaranteed skip).' WHERE skill_key = 'batibat_sleep_paralysis';
UPDATE mob_roster SET skill_description = 'Recovers 5% max HP at the start of each turn.' WHERE skill_key = 'troll_regeneration';
UPDATE mob_roster SET skill_description = 'Every 4 turns, absorbs the next hit, up to 20% max HP.' WHERE skill_key = 'dwarves_stone_skin';
UPDATE mob_roster SET skill_description = '25% chance on hit to reduce the player''s DEF by 10% for 1 turn.' WHERE skill_key = 'dark_elves_curse_of_decay';
UPDATE mob_roster SET skill_description = '20% chance to blind the player (CRIT reduced to 0% for 1 turn).' WHERE skill_key = 'light_elves_radiant_strike';
UPDATE mob_roster SET skill_description = 'Every 3 turns, reduces the player''s ATK by 20% for 1 turn.' WHERE skill_key = 'ratatoskr_slander';
UPDATE mob_roster SET skill_description = 'Every 4 turns, the player skips their next turn.' WHERE skill_key = 'fossegrim_enchanting_melody';
UPDATE mob_roster SET skill_description = 'Every 3 turns, reduces the player''s DEF by 20% for 1 turn.' WHERE skill_key = 'nokken_luring_form';
UPDATE mob_roster SET skill_description = 'Every 4 turns, its next attack deals 200% ATK.' WHERE skill_key = 'valkyrie_battle_judgment';
UPDATE mob_roster SET skill_description = '25% chance each turn to reduce the player''s ATK by 15% for 1 turn.' WHERE skill_key = 'satyr_wild_revelry';
UPDATE mob_roster SET skill_description = 'Every 3rd turn, deals 150% ATK and reduces the player''s DEF by 10% for 1 turn.' WHERE skill_key = 'harpy_swooping_talons';
UPDATE mob_roster SET skill_description = 'While its HP is below 30%, DEF +25% for the rest of the battle.' WHERE skill_key = 'skeleton_warrior_undying_resolve';
UPDATE mob_roster SET skill_description = '30% chance on hit to apply flat Bleed (ATK×0.35 per turn for 2 turns).' WHERE skill_key = 'lamia_serpent_bite';
UPDATE mob_roster SET skill_description = 'Every 3 turns, deals 180% ATK — or 220% ATK if the player''s HP is above 70%.' WHERE skill_key = 'minotaur_labyrinth_charge';
UPDATE mob_roster SET skill_description = 'Every 4 turns, deals 160% ATK and stuns for 1 turn.' WHERE skill_key = 'cyclops_boulder_throw';
UPDATE mob_roster SET skill_description = 'Rotates each attack — Lion Claw (140% ATK) → Goat Ram (DEF -20%) → Serpent Bite (Burn, ATK×0.30 per turn for 2 turns).' WHERE skill_key = 'chimera_tri_form_assault';
UPDATE mob_roster SET skill_description = 'Regenerates 5% max HP every 3rd turn (local instance; only NET damage commits to the shared pool).' WHERE skill_key = 'hydra_regen';
UPDATE mob_roster SET skill_description = 'Every 3rd turn, petrifies the player for 1 turn, then resets the counter.' WHERE skill_key = 'stone_stare';
-- (29 rows)

COMMIT;
