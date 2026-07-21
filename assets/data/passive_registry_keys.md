# CREDD — PASSIVE REGISTRY KEY LIST (authoritative)

Every key below MUST have a function in `/engine/passiveRegistry.js`, implemented per its
effect text under Master §35.1 (one round clock; CC + stat-debuffs = 1 turn; Bleed/Burn
DOTs = 2 ticks; first-hit = first-action flag; stacks per turn; bonus hits are riders).
`none` is the shared no-op. Generated from the three seed files — regenerate if seeds change.

## WEAPON passives (weapon_roster.passive_key)

- `none` — (shared no-op)
- `cutlass` — Serrated Edge: Each attack has a 10% chance to make the enemy Bleed for 5% of the user's base ATK per turn for 2 turns.
- `kampilan` — Opening Strike: The first hit deals +20% ATK.
- `war_club` — Concussive Blow: 10% chance to stun the enemy for 1 turn.
- `bone_crusher` — Opening Strike: The first hit deals +20% ATK.
- `crystal_wand` — Arcane Surge: 10% chance to deal a +15% ATK bonus hit.
- `carved_totem` — Opening Strike: The first hit deals +20% ATK.
- `steel_kite_shield` — Bulwark: 10% chance to block 15% of incoming damage.
- `reinforced_targe` — Opening Strike: The first hit deals +20% ATK.
- `recurve_bow` — Precise Shot: 10% chance to deal a +20% ATK bonus hit.
- `crossbow` — Piercing Opener: The first hit deals +20% ATK and ignores 25% of enemy DEF.
- `katana` — Lethal Edge: Deals +30% damage to every attack (×1.30 on a normal hit; ×2.30 on a critical hit).
- `gladius` — Brutal Swing: 30% chance to deal +50% bonus ATK.
- `scimitar` — Rising Slash: ATK +3% every turn, stacking up to 15%.
- `roman_cestus` — Executioner: Deals 50% more damage to stunned enemies.
- `pata` — Rending Claws: Each attack makes the enemy Bleed for 5% of the user's base ATK per turn for 2 turns.
- `bagh_nakh` — Frenzied Claws: ATK +5% every turn, stacking up to 25%.
- `japanese_bo` — Vital Siphon: 25% chance to heal for 50% of the damage dealt.
- `english_quarterstaff` — Sweeping Strike: 20% chance to deal +50% bonus ATK.
- `egyptian_asa` — Armor Breaker: Ignores an extra 3% of enemy DEF every turn, stacking up to 15%.
- `pilgrims_bordone` — Sundering Blow: 50% chance to reduce enemy DEF by 15% for 1 turn.
- `vatican_aspis` — Sacred Guard: Reduces all damage taken by 10% and grants +10% ATK.
- `battersea_shield` — Iron Stance: DEF +25% for the first 2 turns.
- `enderby_shield` — Thornward: 10% chance to reflect 30% of incoming damage back to the attacker.
- `holmegaard_bow` — Steady Aim: ATK +3% every turn, stacking up to 15%.
- `scandinavian_glacial_wooden_bow` — Frostwind Volley: 10% chance to take another turn.
- `scythian_composite_bow` — Power Draw: 20% chance to deal +50% bonus ATK.
- `xiphos` — Honed Edge: ATK +4% every turn, stacking up to 20%.
- `kopis` — Cleaving Blow: 25% chance to deal +60% bonus ATK.
- `caestus` — Hammer Fists: 35% chance to deal +40% bonus ATK.
- `myrmex` — Predator's Grip: Deals 40% more damage to stunned enemies.
- `dory` — Phalanx Momentum: ATK +6% every 2 turns, stacking up to 18%.
- `thyrsus` — Maddening Touch: Each turn has a 20% chance to make the enemy Bleed for 5% of the user's base ATK per turn for 2 turns.
- `dipylon_shield` — Hoplite Wall: DEF +20% for the first 3 turns.
- `pelte` — Deflection: 15% chance to block 25% of incoming damage.
- `arrow_of_eros` — Love's Arrow: 30% chance to deal +45% bonus ATK.
- `cretan_bow` — Hunter's Focus: ATK +4% every turn, stacking up to 20%.
- `juru_pakal` — Bloodhunter: Deals 50% more damage to bleeding enemies.
- `gram` — Dragonbane: Ignores 25% of enemy DEF. Deals +30% bonus damage to enemies above 80% HP.
- `tyrfing` — Cursed Edge: ATK +10% every turn, stacking up to +30%. Once the enemy drops below 30% HP, the curse takes hold: your attacks can no longer miss or be evaded.
- `laevateinn_sword` — Sundering Flame: Reduces enemy DEF by 10% every turn, stacking up to 30%.
- `jarngreipr` — Thunder Grip: Stunning an enemy triggers Bash for +60% bonus damage.
- `gridr_iron_gloves` — Ironhide: 20% chance to ignore incoming damage entirely.
- `alans_reversed_hands` — Untouchable: Immune to all status effects. Does not prevent damage-over-time effects.
- `knuckle_charm_anting_anting` — Death Charm: 5% chance to instantly kill the opponent (Bosses excluded).
- `laevateinn_staff` — Flickering Flame: Attacks ignore 15% of enemy DEF and apply Burn equal to 10% of ATK for 2 turns.
- `galdrastafir` — Runebreaker: 50% chance to reduce enemy DEF by 30% for 1 turn.
- `babaylans_ritual_staff` — Sacred Cleansing: Each turn has a 50% chance to remove all status and damage-over-time debuffs. If at least one debuff is removed, grants +100% ATK for 1 turn.
- `badiang_stalk` — Venom Burst: 30% chance to Rupture for 10% of the enemy's max HP (blocked by all bosses).
- `shield_of_the_valkyrie` — Valkyrie's Resolve: Each hit taken grants +5% DEF and +5% ATK, stacking up to 30% each.
- `skjaldmaer` — Shieldmaiden's Guard: 15% chance to ignore incoming damage entirely.
- `luzon_tribal_shield` — Tribal Ward: While debuffed, gains +40% DEF until the debuff expires.
- `gusisnautar` — Hemorrhaging Shot: 50% chance to Hemorrhage for 10% of the enemy's max HP for 1 turn, with -15% DEF while it lasts (blocked by all bosses).
- `freyrs_arrow` — Auto-Fire: 50% chance to auto-fire for 100% ATK damage.
- `harpe` — Gorgon Slayer: Ignores 30% of enemy DEF.
- `sword_of_damocles` — Impending Doom: ATK +5% every turn, stacking up to +100%. While any stacks are active, you take +10% damage.
- `labrys` — Double Strike: Every 3rd turn, the attack hits twice; the second hit deals 70% ATK and both can CRIT.
- `hephaestus_hammer` — Forged Armor: DEF +20% for the whole battle; every 4th turn, lands a 150% ATK forge strike.
- `caduceus` — Herald's Touch: Every 3rd turn, cleanses all debuffs and restores 8% max HP.
- `spear_of_ares` — Bloodlust: ATK +10% every turn, stacking up to +40%. Whenever you defeat an enemy, immediately gain a stack.
- `helm_of_darkness` — Invisibility: [v5 Supreme armor] 30% chance each turn to reduce enemy DEF by 50% for 2 turns.
- `aegis` — Medusa's Gaze: [v5 Supreme armor] 50% chance on hit to add a Stone stack; at 3 stacks, stuns for 1 turn, then resets.
- `apollos_silver_bow` — Unerring Arrow: Ignores 25% of enemy DEF; every 4th turn, the attack is a guaranteed CRIT.
- `mjolnir` — Crushing Force: Attacks deal +30% ATK; every 3rd turn, the attack deals an additional +200% ATK.
- `gungnir` — Never Misses: Ignores 40% of enemy DEF; 25% chance to pierce all DEF (zero mitigation).
- `thunderbolt_of_zeus` — Divine Thunder: on a CRIT, deal +100% bonus ATK and paralyze for 1 turn.
- `trident_of_poseidon` — Tidal Wrath: Every 2nd turn, deals +100% bonus ATK and reduces enemy DEF by 20% for 1 turn, with a 30% chance to stun for 1 turn.
- `kiri` — Thousand Partings: [Genesis] Each attack increases damage by 20%, stacking up to +120%. Every attack has a 25% chance to strike twice.
- `moira` — Fate Ignores Iron: [Genesis] All attacks reduce the target's DEF by 10%, stacking up to 50%. Ignores 50% of DEF against targets with a defense buff active. Attacks cannot miss.
- `sophia` — The Price of Knowing: [Genesis] All damage dealt is increased by 75%, but the wielder takes 20% more damage. Below 30% HP the damage bonus rises to +150% for the rest of the battle.
- `atlas` — Worldbreaker's Grip: [Genesis] Base attack increased by 50%. Every 3rd turn is a guaranteed critical strike. Enemies hit by a critical strike have their ATK reduced by 30% for 1 turn.
- `titan` — Forgefire Veins: [Genesis] Heals for 30% of all damage dealt (50% while below 50% HP). Once per battle, upon taking fatal damage, survives at 1 HP and gains +100% damage until the end of battle.

## ARMOR passives (armor_roster.passive_key) — [v5]

Migrated-shield keys (steel_kite_shield, reinforced_targe, vatican_aspis, battersea_shield,
dipylon_shield, enderby_shield, pelte, shield_of_the_valkyrie, skjaldmaer, luzon_tribal_shield,
aegis, helm_of_darkness) are listed once under WEAPON above and reused here. The eight below are
new and defensive:

- `kalasag` — Bulwark Hide: reduces incoming damage by 3% (post-DEF).
- `hoplite_panoply` — Phalanx Wall: reduces incoming damage by 15% (post-DEF).
- `mail_of_brokkr` — Dwarven Forge: reduces incoming damage by 30% and reflects 15% of damage taken.
- `wolfskin_cloak` — Wolf's Vigor: regenerates 10% max HP at the start of each round.
- `salakot_ward` — Spirit Ward: 20% chance to negate an incoming debuff.
- `anting_anting_sash` — Charmed Hide: immune to Stun, Petrify, and Freeze.
- `valkyrie_mantle` — Chooser's Grace: 20% chance to evade an incoming attack (total evade capped at 40%).
- `mantle_of_bathala` — Divine Aegis: +5% HP and +5% DEF every turn, stacking up to +50% each.

## DEITY blessings (deity_roster.blessing_key)

- `bathala_divine_vessel` — Divine Vessel: All stats +20% for the first 3 turns.
- `sidapa_deaths_reprieve` — Death's Reprieve: Once per battle, the first lethal hit leaves the user at 1 HP. The user then heals 30% max HP and gains +50% ATK for the rest of the battle.
- `magwayen_soul_drain` — Soul Drain: Heals 15% of all damage dealt. When an enemy is defeated, recover 20% max HP as their soul is claimed.
- `mandarangan_war_frenzy` — War Frenzy: End of each turn: +10% ATK, stacking up to +50% (reached turn 5). Stacks persist all battle.
- `apolaki_solar_burn` — Solar Burn: Each attack burns the enemy for 10% of the user's base ATK for 1 turn.
- `mayari_lunar_veil` — Lunar Veil: While below 50% HP, DEF +30% and reflect 15% of damage taken.
- `dian_masalanta_devotion` — Devotion: While below 50% HP, ATK +30% and heal 4% max HP each turn.
- `amihan_tailwind` — Tailwind: 20% chance to evade any incoming attack. Each successful evade grants +20% ATK to her next attack.
- `habagat_monsoon_fury` — Monsoon Fury: At the start of each turn, 25% chance to empower this turn's attack, causing it to deal +50% bonus damage.
- `lakapati_abundance` — Abundance: Regenerates 3% max HP at the start of each turn.
- `idiyanale_persistence` — Persistence: Every 3rd turn, the next attack deals +75% more damage.
- `odin_all_fathers_wisdom` — All-Father's Wisdom: On every even turn (2, 4, 6…), takes 50% reduced damage.
- `thor_mjolnirs_wrath` — Mjolnir's Wrath: Each attack has a 30% chance to Stun the enemy and Paralyze it for 3 turns. While Paralyzed, the enemy takes damage equal to 20% of the user's base ATK each turn and has a 10% chance to skip its turn.
- `freya_valkyries_embrace` — Valkyrie's Embrace: ATK +30% for the whole battle. Once per battle, at 40% HP or below, restore 20% max HP.
- `loki_illusory_double` — Illusory Double: 25% chance each turn to evade an attack and counter for 100% ATK.
- `tyr_oathkeeper` — Oathkeeper: DEF +30% for the whole battle; while below 50% HP, reflects 20% of incoming damage.
- `skadi_winters_hunt` — Winter's Hunt: Each attack has a 30% chance to Freeze the enemy, causing it to skip its next turn. After Freeze ends, the enemy suffers Frostbite, taking 50% more damage for 1 turn.
- `surt_muspells_flame` — Muspell's Flame: Each attack adds Burn equal to 5% of the user's base ATK per turn for 2 turns, stacking up to 30%. Attacks deal 50% more damage to enemies that are already burning.
- `heimdall_eternal_vigilance` — Eternal Vigilance: The first hit taken each battle is reduced by 50%. For the rest of the battle, damage from incoming critical hits is reduced by 30%.
- `baldur_invulnerability` — Invulnerability: Once per battle, the first time the user is debuffed or drops below 50% HP, remove all debuffs, restore 15% max HP, and reduce damage taken by 50% for 1 turn.
- `hel_half_dead` — Half-Dead: While below 50% HP, ATK +30% and DEF +30%.
- `mimir_runic_knowledge` — Runic Knowledge: Every 3rd turn, the next attack deals +90% more damage.
- `freyr_harvest_bounty` — Harvest Bounty: Restores 6% max HP every 2 turns.
- `njord_seas_favor` — Sea's Favor: 15% chance each turn to reduce incoming damage by 30%.
- `bragi_battle_hymn` — Battle Hymn: ATK +15% for the whole battle.
- `idunn_golden_apple` — Golden Apple: Once per battle, at 50% HP or below, restore 15% max HP.
- `vidar_silent_vengeance` — Silent Vengeance: When hit by a critical, Vidar's next attack is a guaranteed critical. The first time he drops below 50% HP, his next attack also crits.
- `magni_might_of_magni` — Might of Magni: +5% ATK for every 10% max HP missing, up to +25%.
- `zeus_thunder_sovereign` — Thunder Sovereign: Every 3rd turn, deals +80% bonus ATK and reduces enemy DEF by 20% for 1 turn.
- `ares_blood_frenzy` — Blood Frenzy: At the end of each turn, gain +10% ATK, stacking up to +50%.
- `poseidon_tidal_force` — Tidal Force: Each attack has a 30% chance to Stun the enemy (skips its next turn) and shred its DEF by 30% for 2 turns. The shred refreshes on each proc but does not stack.
- `hades_soul_harvest` — Soul Harvest: While the enemy is below 30% HP, ATK +50% for the rest of the battle.
- `hera_divine_wrath` — Divine Wrath: DEF +30% for the whole battle. When hit by a critical, gain +10% ATK, stacking up to 3 times.
- `athena_aegis_shield` — Aegis Shield: The first 2 hits taken each battle are reduced by 40%. Afterward, incoming damage is reduced by 10% for the rest of the battle.
- `apollo_solar_radiance` — Solar Radiance: ATK +25% for the whole battle.
- `artemis_huntress_precision` — Huntress Precision: The first attack each battle always crits; afterward, every 3rd turn the next attack automatically crits.
- `hephaestus_forged_armor` — Forged Armor: DEF +25% for the whole battle; while below 50% HP, ATK +20%.
- `aphrodite_enchanting_aura` — Enchanting Aura: 25% chance each turn to Charm the enemy, making it skip its attack.
- `persephone_cycle_of_renewal` — Cycle of Renewal: Once per battle, when HP drops below 50%, restore 15% max HP.
- `dionysus_drunken_haze` — Drunken Haze: 30% chance each turn to make the enemy attack itself for 30% of its own ATK.
- `nike_wings_of_victory` — Wings of Victory: ATK +15% for the whole battle.

## ECHO blessings (active_echo_deity_id via ECHO_BLESSING_KEY_MAP)

- `echo_nike` — Echo · Nike: ATK +12% for the whole battle.
- `echo_persephone` — Echo · Persephone: Regenerates 3% max HP every 3 turns.
- `echo_hades` — Echo · Hades: While the enemy's HP is below 30%, ATK +15%.
- `echo_hera` — Echo · Hera: When hit by a critical, gains DEF +15% for 2 turns.
- `echo_ares` — Echo · Ares: ATK +4% every 2 turns, stacking up to 16%.
- `echo_hephaestus` — Echo · Hephaestus: DEF +15% for the whole battle.
- `echo_apollo` — Echo · Apollo: ATK +10% for the whole battle.
- `echo_bragi` — Echo · Bragi: Every 4 turns, ATK +10% for that turn.
- `echo_idunn` — Echo · Idunn: Regenerates 2% max HP every 2 turns.
- `echo_freyr` — Echo · Freyr: Regenerates 3% max HP every 3 turns.
- `echo_vidar` — Echo · Vidar: When hit by a critical, the next attack gains +30% ATK.
- `echo_magni` — Echo · Magni: ATK +3% for every 10% of HP lost, up to 15%.
- `echo_njord` — Echo · Njord: 10% chance each turn to reduce incoming damage by 20%.
- `echo_freya` — Echo · Freya: While HP is below 40%, DEF +20%.
- `echo_tyr` — Echo · Tyr: DEF +10% for the whole battle.
- `echo_surt` — Echo · Surt: Inherits Muspell's Flame exactly: every landed hit adds 5% base ATK Burn for 2 turns, stacking up to 30%.
- `echo_hel` — Echo · Hel: While HP is below 50%, ATK +8% and DEF +8%.
- `echo_mimir` — Echo · Mimir: Every 5 turns, gains +30% ATK for that turn.
- `echo_idiyanale` — Echo · Idiyanale: Every 6 turns, the next attack deals double damage.
- `echo_lakapati` — Echo · Lakapati: Regenerates 2% max HP every turn.
- `echo_habagat` — Echo · Habagat: 15% chance to deal +30% bonus ATK.
- `echo_mandarangan` — Echo · Mandarangan: ATK +5% per turn, stacking up to 15%.
- `echo_magwayen` — Echo · Magwayen: Each attack steals 5% of the damage dealt as HP.
- `echo_dian_masalanta` — Echo · Dian Masalanta: While HP is below 30%, ATK +12%.
- `echo_mayari` — Echo · Mayari: While HP is below 50%, DEF +15%.
- `echo_apolaki` — Echo · Apolaki: Inherits Solar Burn exactly: every landed hit applies 10% base ATK Burn for 1 tick.

## MOB / BOSS skills (mob_roster.skill_key)

- `dwende_black_hex` — Hex: 25% chance to reduce the player's ATK by 15% for 1 turn.
- `dwende_white_daze` — Daze: 20% chance to reduce the player's CRIT by 50% for 1 turn.
- `amalanhig_infectious_bite` — Infectious Bite: 30% chance on hit to inflict Rot (5% max HP per turn for 2 turns).
- `amomongo_rend` — Rend: Every 3rd turn, deals 150% ATK.
- `bal_bal_carrion_sense` — Carrion Sense: While the player's HP is below 30%, ATK +20%.
- `santelmo_will_o_wisp` — Will-o-Wisp: 20% chance each turn to make the player skip their next attack.
- `manananggal_viscera_drain` — Viscera Drain: Every 3 turns, drains 15% of the player's max HP and heals itself.
- `aswang_shape_shift` — Shape Shift: Every 4 turns, copies the player's current ATK for 2 turns.
- `tikbalang_disorientation` — Disorientation: Every 3 turns, reduces the player's ATK by 20% for 1 turn.
- `kapre_smoke_cloud` — Smoke Cloud: Every 4 turns, reduces the player's CRIT by 30% and ATK by 10% for 1 turn.
- `sigbin_shadow_step` — Shadow Step: 20% chance to evade any incoming attack.
- `batibat_sleep_paralysis` — Sleep Paralysis: Every 4 turns, paralyzes the player for 1 turn (guaranteed skip).
- `troll_regeneration` — Regeneration: Recovers 5% max HP at the start of each turn.
- `dwarves_stone_skin` — Stone Skin: Every 4 turns, absorbs the next hit, up to 20% max HP.
- `dark_elves_curse_of_decay` — Curse of Decay: 25% chance on hit to reduce the player's DEF by 10% for 1 turn.
- `light_elves_radiant_strike` — Radiant Strike: 20% chance to blind the player (CRIT reduced to 0% for 1 turn).
- `ratatoskr_slander` — Slander: Every 3 turns, reduces the player's ATK by 20% for 1 turn.
- `fossegrim_enchanting_melody` — Enchanting Melody: Every 4 turns, the player skips their next turn.
- `nokken_luring_form` — Luring Form: Every 3 turns, reduces the player's DEF by 20% for 1 turn.
- `valkyrie_battle_judgment` — Battle Judgment: Every 4 turns, its next attack deals 200% ATK.
- `satyr_wild_revelry` — Wild Revelry: 25% chance each turn to reduce the player's ATK by 15% for 1 turn.
- `harpy_swooping_talons` — Swooping Talons: Every 3rd turn, deals 150% ATK and reduces the player's DEF by 10% for 1 turn.
- `skeleton_warrior_undying_resolve` — Undying Resolve: While its HP is below 30%, DEF +25% for the rest of the battle.
- `lamia_serpent_bite` — Serpent Bite: 30% chance on hit to apply Bleed equal to 15% of the enemy's ATK per turn for 2 turns.
- `minotaur_labyrinth_charge` — Labyrinth Charge: Every 3 turns, deals 180% ATK — or 220% ATK if the player's HP is above 70%.
- `cyclops_boulder_throw` — Boulder Throw: Every 4 turns, deals 160% ATK and stuns for 1 turn.
- `chimera_tri_form_assault` — Tri-Form Assault: Rotates each phase — Lion Claw (140% ATK) → Goat Ram (DEF -20%) → Serpent Bite (Burn equal to 20% of enemy ATK per turn for 2 turns).
- `none` — (shared no-op)
- `hydra_regen` — Regeneration: Regenerates 5% max HP every 3rd turn (local instance; only NET damage commits to the shared pool).
- `stone_stare` — Stone Stare: Every 3rd turn, petrifies the player for 1 turn, then resets the counter.
