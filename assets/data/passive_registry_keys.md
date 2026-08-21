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
- `katana` — Lethal Edge: Each attack deals 30% additional damage (×1.30 on a normal hit; ×2.30 on a critical hit).
- `gladius` — Brutal Swing: 30% chance to deal +50% bonus ATK.
- `scimitar` — Rising Slash: ATK +3% every turn, stacking up to 15%.
- `roman_cestus` — Executioner: Deals 50% more damage to stunned enemies.
- `pata` — Rending Claws: Each attack makes the enemy Bleed for 5% of the user's base ATK per turn for 2 turns.
- `bagh_nakh` — Frenzied Claws: ATK +5% every turn, stacking up to 25%.
- `japanese_bo` — Vital Siphon: 25% chance to heal for 50% of the damage dealt.
- `english_quarterstaff` — Sweeping Strike: 20% chance to deal +50% bonus ATK.
- `egyptian_asa` — Armor Breaker: Ignores an extra 3% of enemy DEF every turn, stacking up to 15%.
- `pilgrims_bordone` — Sundering Blow: 50% chance to reduce enemy DEF by 15% for 1 turn.
- `vatican_aspis` — Sacred Guard: Reduces damage taken by 8% and increases outgoing damage by 12%.
- `battersea_shield` — Iron Stance: Gains 3% damage reduction at the start of each turn, stacking up to 15%.
- `enderby_shield` — Thornward: Reflects 12% of post-mitigation damage taken back to the attacker.
- `holmegaard_bow` — Steady Aim: ATK +3% every turn, stacking up to 15%.
- `scandinavian_glacial_wooden_bow` — Frostwind Volley: 10% chance to take another turn.
- `scythian_composite_bow` — Power Draw: 20% chance to deal +50% bonus ATK.
- `xiphos` — Honed Edge: ATK +4% every turn, stacking up to 20%.
- `kopis` — Cleaving Blow: 25% chance to deal +60% bonus ATK.
- `caestus` — Hammer Fists: 35% chance to deal +40% bonus ATK.
- `myrmex` — Predator's Grip: Deals 40% more damage to stunned enemies.
- `dory` — Phalanx Momentum: ATK +6% every 2 turns, stacking up to 18%.
- `thyrsus` — Maddening Touch: Each turn has a 20% chance to make the enemy Bleed for 5% of the user's base ATK per turn for 2 turns.
- `dipylon_shield` — Hoplite Wall: DEF +30% during turns 1 through 3.
- `pelte` — Deflection: 20% chance per incoming hit to halve that hit's damage.
- `arrow_of_eros` — Love's Arrow: 30% chance to deal +45% bonus ATK.
- `cretan_bow` — Hunter's Focus: ATK +4% every turn, stacking up to 20%.
- `juru_pakal` — Bloodhunter: Increases outgoing damage by 10% and deals 50% more damage to targets affected by Bleed, Hemorrhage, Rupture, or Venom.
- `gram` — Dragonbane: Ignores 25% of enemy DEF and deals 30% more damage while the target is above 50% max HP.
- `tyrfing` — Cursed Edge: ATK +10% at the start of each turn, stacking up to +30%. Attacks execute non-boss targets below 10% max HP.
- `laevateinn_sword` — Sundering Flame: Reduces enemy DEF by 10% every turn, stacking up to 30%.
- `jarngreipr` — Thunder Grip: Increases outgoing damage by 20%. Applying Stun immediately triggers Bash for 50% bonus damage on that attack.
- `gridr_iron_gloves` — Ironhide: Increases outgoing damage by 20% and has a 20% chance per incoming hit to ignore that hit entirely.
- `alans_reversed_hands` — Untouchable: Increases outgoing damage by 20% and grants immunity to status effects; damage-over-time effects still apply.
- `knuckle_charm_anting_anting` — Death Charm: Increases outgoing damage by 10% and has a 5% chance on attack to instantly kill a non-boss target.
- `laevateinn_staff` — Flickering Flame: Attacks ignore 15% of enemy DEF and apply Burn equal to 10% of ATK for 2 turns.
- `galdrastafir` — Runebreaker: Increases damage by 10%. Every successful attack reduces the target's DEF by 20% for 1 turn, refreshing rather than stacking.
- `babaylans_ritual_staff` — Sacred Cleansing: Each turn has a 50% chance to remove all status and damage-over-time debuffs. If at least one debuff is removed, grants +100% ATK for 1 turn.
- `badiang_stalk` — Venom Burst: 30% chance on attack to Rupture for 10% of the target's max HP, then apply Venom for 10% ATK per turn for 2 turns. Bosses block both effects.
- `shield_of_the_valkyrie` — Valkyrie's Resolve: Each hit taken grants 5% damage reduction and +5% ATK, stacking up to 25% each for the battle.
- `skjaldmaer` — Shieldmaiden's Guard: Reflects 20% of damage taken. Each hit also has a 10% chance to be fully negated and reflect 60% of its would-be damage instead — the two reflects never double-dip.
- `luzon_tribal_shield` — Tribal Ward: Gains +45% DEF while debuffed and heals 8% max HP whenever a debuff expires or is cleansed.
- `gusisnautar` — Hemorrhaging Shot: 50% chance on attack to deal 5% of the target's max HP and reduce its DEF by 15% for 1 turn. Bosses block both effects.
- `freyrs_arrow` — Auto-Fire: 30% chance on attack to fire one additional shot for 100% ATK damage.
- `harpe` — Gorgon Slayer: Ignores 30% of enemy DEF.
- `sword_of_damocles` — Impending Doom: ATK +5% every turn, stacking up to +100%. While any stacks are active, you take +10% damage.
- `labrys` — Double Strike: Every 3rd eligible turn, the primary attack is followed by one 70% ATK additional strike. Both attacks can CRIT and trigger eligible attack effects.
- `hephaestus_hammer` — Forged Armor: DEF +20% for the whole battle; every 4th turn, lands a 150% ATK forge strike.
- `caduceus` — Herald's Touch: Increases damage by 10%. Incoming damage-over-time reduced by 10%.
- `spear_of_ares` — Bloodlust: ATK +10% at the start of each turn, stacking up to +50% for the battle.
- `helm_of_darkness` — Veil of Hades: 30% chance to evade each incoming hit. A successful evade grants Unseen, causing the next attack to ignore 50% of the target's DEF.
- `aegis` — Medusa's Gaze: Each hit taken adds a Stone stack, each granting 10% damage reduction. At 3 stacks the attacker is Petrified for 1 turn and takes 50% more damage while petrified, then the stacks reset. The third stack becomes the Petrify rather than more reduction, so the effective maximum is 2 stacks (20%).
- `apollos_silver_bow` — Unerring Arrow: Ignores 25% of enemy DEF. Every 3rd turn, the attack is a guaranteed CRIT — counted in the wielder's own attack turns, so a turn lost to crowd control does not burn a count. Resets each battle.
- `mjolnir` — Crushing Force: Normal attacks deal +50% damage. Every 3rd turn, the primary attack gains +200% ATK instead; the +50% damage bonus does not apply to that burst.
- `gungnir` — Never Misses: Each attack ignores 30% of enemy DEF and has a 20% chance to use 60% total DEF penetration for that attack.
- `thunderbolt_of_zeus` — Divine Thunder: Each critical attack deals +100% bonus ATK and applies Paralyze for 1 turn.
- `trident_of_poseidon` — Tidal Wrath: Every 2nd turn, deals +100% bonus ATK and reduces enemy DEF by 20% for 1 turn, with a 30% chance to stun for 1 turn.
- `kiri` — Thousand Partings: [Divine] Each attack increases damage by 20%, stacking up to +120%. Each attack has a 25% chance to strike twice as two separate hits.
- `moira` — Fate Ignores Iron: [Divine] All attacks reduce the target's DEF by 10%, stacking up to 50%. Ignores 50% of DEF against targets with a defense buff active. Attacks cannot miss.
- `sophia` — The Price of Knowing: [Divine] All damage dealt is increased by 75%, but the wielder takes 20% more damage. Below 30% HP the damage bonus rises to +150% for the rest of the battle.
- `atlas` — Worldbreaker's Grip: [Divine] Base attack increased by 50%. Every 3rd turn is a guaranteed critical strike. Enemies hit by a critical strike have their attack reduced by 50% for 1 turn.
- `titan` — Forgefire Veins: [Divine] Damage dealt is increased by 50%. The wielder heals for 30% of all damage dealt (50% while below 50% HP). Once per battle, upon taking fatal damage, survives at 1 HP and gains +100% damage until the end of battle.

## ARMOR passives (armor_roster.passive_key) — [v5]

Migrated-shield keys (steel_kite_shield, reinforced_targe, vatican_aspis, battersea_shield,
dipylon_shield, enderby_shield, pelte, shield_of_the_valkyrie, skjaldmaer, luzon_tribal_shield,
aegis, helm_of_darkness) are listed once under WEAPON above and reused here. The eight below are
new and defensive:

- `kalasag` — Bulwark Hide: reduces incoming damage by 3% (post-DEF).
- `hoplite_panoply` — Phalanx Wall: Reduces damage taken by 20%; the first hit taken each battle gains another 30% reduction.
- `mail_of_brokkr` — Dwarven Forge: Reduces damage taken by 30%, caps each hit at 15% max HP, then reflects 20% of the final post-mitigation damage. Order is reduction, then cap, then reflect.
- `wolfskin_cloak` — Wolf's Vigor: Heals 3% max HP at the start of each turn, or 6% while below 50% max HP.
- `salakot_ward` — Spirit Ward: Has a 35% chance per application to negate an incoming debuff or crowd-control effect.
- `anting_anting_sash` — Charmed Hide: Takes 10% less damage. The first crowd-control effect each battle is fully nullified, of any type. Afterward, a 40% chance to resist Stun, Petrify, or Freeze specifically.
- `valkyrie_mantle` — Chooser's Grace: Starts with a 22% evade chance, gains 8 percentage points after each consecutive hit taken, and resets to 22% after evading.
- `mantle_of_bathala` — Divine Aegis: Gains 6% max HP and 4% damage reduction each turn, stacking to 30% and 20%. At max stacks, also heals 8% max HP each turn.

## DEITY blessings (deity_roster.blessing_key)

Only the 15 deities in `DIVINE_BLESSING_DEITIES` execute these stored keys directly.
The other 26 roster rows are Echo-type deities: their stored keys remain for database
compatibility, but live combat maps them through `ECHO_BLESSING_KEY_MAP` to the `echo_*`
entries in the next section in both the Primary and Secondary channels.

- `bathala_divine_vessel` — Divine Vessel: At the start of each turn before attacking, gains 10% of base battle ATK and 4% of base battle DEF, stacking additively up to 10 times (+100% ATK and +40% DEF). Resets after battle.
- `sidapa_deaths_reprieve` — Death's Reprieve: Once per battle, the first lethal hit leaves the user at 1 HP. The user then heals 30% max HP and gains +50% ATK for the rest of the battle.
- `magwayen_soul_drain` — Soul Drain: Heals 30% of all damage actually dealt after mitigation, up to max HP.
- `mandarangan_war_frenzy` — War Frenzy: End of each turn: +10% ATK, stacking up to +50% (reached turn 5). Stacks persist all battle.
- `apolaki_solar_burn` — Solar Burn: Each attack burns the enemy for 10% of the user's base ATK for 1 turn.
- `mayari_lunar_veil` — Lunar Veil: While below 50% HP, DEF +30% and reflect 15% of damage taken.
- `dian_masalanta_devotion` — Devotion: While below 50% HP, ATK +30% and heal 4% max HP each turn.
- `amihan_tailwind` — Tailwind: 20% chance to evade any incoming attack. Each successful evade grants +20% ATK to her next attack.
- `habagat_monsoon_fury` — Monsoon Fury: At the start of each turn, 25% chance to empower this turn's attack, causing it to deal +50% bonus damage.
- `lakapati_abundance` — Abundance: Regenerates 3% max HP at the start of each turn.
- `idiyanale_persistence` — Persistence: Every 3rd turn, the next attack deals +75% more damage.
- `odin_all_fathers_wisdom` — All-Father's Foresight: Increase ATK by +50%. On even-numbered battle turns, takes 25% less damage and stores the damage prevented. On the immediately following odd-numbered turn, adds the stored amount to the next attack, then clears it. Resets after battle.
- `thor_mjolnirs_wrath` — Mjolnir's Wrath: Each attack has a 30% chance to Stun the enemy and Paralyze it for 3 turns. While Paralyzed, the enemy takes damage equal to 20% of the user's base ATK each turn and has a 10% chance to skip its turn.
- `freya_valkyries_embrace` — Valkyrie's Embrace: ATK +30% for the whole battle. Once per battle, at 40% HP or below, restore 20% max HP.
- `loki_illusory_double` — Illusory Double: 25% chance each turn to evade an attack and counter for 100% ATK.
- `tyr_oathkeeper` — Oathkeeper: DEF +30% for the whole battle; while below 50% HP, reflects 20% of incoming damage.
- `skadi_winters_hunt` — Winter's Hunt: Each attack has a 30% chance to Freeze the enemy, causing it to skip its next turn. After Freeze ends, the enemy suffers Frostbite, taking 50% more damage for 1 turn.
- `surt_muspells_flame` — Muspell's Flame: Each attack adds Burn equal to 3% of the user's base ATK per turn for 2 turns, stacking up to 15%. Attacks deal 50% more damage to enemies that are already burning.
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
- `zeus_thunder_sovereign` — Chain Lightning: Increase ATK by +50%. Each attack has a 50% chance to deal 50% additional damage and add a 5% DEF shred. The DEF shred stacks up to 6 times (30%) and resets after battle.
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
- `echo_hades` — Echo · Hades: While the enemy is below 30% HP, ATK +15%.
- `echo_hera` — Echo · Hera: When hit by a critical, gain DEF +15% for 2 turns.
- `echo_ares` — Echo · Ares: At the end of each turn, gain +10% ATK, stacking up to +50%.
- `echo_hephaestus` — Echo · Hephaestus: DEF +15% for the whole battle.
- `echo_apollo` — Echo · Apollo: ATK +10% for the whole battle.
- `echo_bragi` — Echo · Bragi: Every 4 turns, gain +10% ATK for that turn.
- `echo_idunn` — Echo · Idunn: Regenerates 2% max HP every 2 turns.
- `echo_freyr` — Echo · Freyr: Regenerates 3% max HP every 3 turns.
- `echo_vidar` — Echo · Vidar: When hit by a critical, the next attack gains +30% ATK.
- `echo_magni` — Echo · Magni: ATK +3% for every 10% of HP lost, up to 15%.
- `echo_njord` — Echo · Njord: 10% chance each turn to reduce incoming damage by 20%.
- `echo_freya` — Echo · Freya: While HP is below 40%, DEF +20%.
- `echo_tyr` — Echo · Tyr: DEF +10% for the whole battle.
- `echo_surt` — Echo · Surt: Each attack adds Burn equal to 3% of the user's base ATK per turn for 2 turns, stacking up to 15%. Attacks deal 50% more damage to enemies that are already burning.
- `echo_hel` — Echo · Hel: While HP is below 50%, ATK +8% and DEF +8%.
- `echo_mimir` — Echo · Mimir: Every 5 turns, gain +30% ATK for that turn.
- `echo_idiyanale` — Echo · Idiyanale: Every 6 turns, the next attack deals double damage.
- `echo_lakapati` — Echo · Lakapati: Regenerates 2% max HP every turn.
- `echo_habagat` — Echo · Habagat: Each attack has a 15% chance to deal +30% bonus ATK.
- `echo_mandarangan` — Echo · Mandarangan: ATK +5% per turn, stacking up to 15%.
- `echo_magwayen` — Echo · Magwayen: Heals 30% of all damage actually dealt after mitigation, up to max HP.
- `echo_dian_masalanta` — Echo · Dian Masalanta: While HP is below 30%, ATK +12%.
- `echo_mayari` — Echo · Mayari: While HP is below 50%, DEF +15%.
- `echo_apolaki` — Echo · Apolaki: Each attack burns the enemy for 10% of the user's base ATK for 1 turn.

## MOB / BOSS skills (mob_roster.skill_key)

- `dwende_black_hex` — Hex: 25% chance to reduce the player's ATK by 15% for 1 turn.
- `dwende_white_daze` — Daze: 20% chance to reduce the player's CRIT by 50% for 1 turn.
- `amalanhig_infectious_bite` — Infectious Bite: Each attack has a 30% chance to inflict Rot equal to 5% of the player's max HP per turn for 2 turns.
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
- `dark_elves_curse_of_decay` — Curse of Decay: Each attack has a 25% chance to reduce the player's DEF by 10% for 1 turn.
- `light_elves_radiant_strike` — Radiant Strike: 20% chance to blind the player (CRIT reduced to 0% for 1 turn).
- `ratatoskr_slander` — Slander: Every 3 turns, reduces the player's ATK by 20% for 1 turn.
- `fossegrim_enchanting_melody` — Enchanting Melody: Every 4 turns, the player skips their next turn.
- `nokken_luring_form` — Luring Form: Every 3 turns, reduces the player's DEF by 20% for 1 turn.
- `valkyrie_battle_judgment` — Battle Judgment: Every 4 turns, its next attack deals 200% ATK.
- `satyr_wild_revelry` — Wild Revelry: 25% chance each turn to reduce the player's ATK by 15% for 1 turn.
- `harpy_swooping_talons` — Swooping Talons: Every 3rd turn, deals 150% ATK and reduces the player's DEF by 10% for 1 turn.
- `skeleton_warrior_undying_resolve` — Undying Resolve: While its HP is below 30%, DEF +25% for the rest of the battle.
- `lamia_serpent_bite` — Serpent Bite: Each attack has a 30% chance to add Bleed equal to 15% of Lamia's ATK per turn for 2 turns.
- `minotaur_labyrinth_charge` — Labyrinth Charge: Every 3 turns, deals 180% ATK — or 220% ATK if the player's HP is above 70%.
- `cyclops_boulder_throw` — Boulder Throw: Every 4 turns, deals 160% ATK and stuns for 1 turn.
- `chimera_tri_form_assault` — Tri-Form Assault: Each phase cycles through Lion Claw, which deals 140% ATK; Goat Ram, which reduces the player's DEF by 20% for 1 turn; and Serpent Bite, which adds Burn equal to 20% of Chimera's ATK per turn for 2 turns.
- `none` — (shared no-op)
- `hydra_regen` — Regeneration: Regenerates 1% max HP every 3rd turn (local instance; only NET damage commits to the shared pool).
- `stone_stare` — Stone Stare: Every 3rd turn, petrifies the player for 1 turn, then resets the counter.
- `bakunawa_seven_moons` — Seven Moons: Every 4th turn, Eclipse reduces the player's CRIT to 0% for 1 turn.
- `fenrir_gleipnirs_doom` — Gleipnir's Doom: As Fenrir's HP falls, seal phases grant +10%/+20%/+35% outgoing damage and +5%/+10%/+15% armor penetration; bonuses are total, not cumulative.
