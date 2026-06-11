# Phase 6 — Passive Registry Audit Matrix

Per-key audit of `src/engine/passiveRegistry.js` (factory build) against
`passive_registry_keys.md` + Master §35.1–§35.4 + ENGINE_HOOKS.md, under the
approved rulings R1–R9. Coverage (exact set equality with the key list, both
directions, 137 keys incl. `none`) is asserted by `scripts/battle-selftest.js`.

**Status legend**
- `✓` conforms — only change from the Phase 1 body is `Math.random()` → `bs.rng()`
  (global, all keys) and/or mechanical restructuring into a factory with identical behavior.
- `✓*` conforms with a documented interpretation/note (see Notes column or §Global notes).
- `Δ` behavior changed in Phase 6, with reason.

**Factories** (see file header): `firstHitBonus`, `chanceRider`, `stackingAtk`,
`chanceEnemyDebuff`, `onHitEnemyDot`, `bonusVsState`, `flatPierce`, `timedSelfBuff`,
`constantSelfBuff`, `chanceFlag`, `everyNthRider`, `hpThresholdBuff`,
`oncePerBattleHeal`, `regenSelf`, `regenEnemy`, `chancePlayerDebuff`,
`everyNthPlayerDebuff`, `everyNthEnemyNuke` — 18 factories covering 110 keys;
27 keys are bespoke (incl. `none`).

---

## Global timing semantics (engine-side, affect every key)

1. **Round-start invocation + pre-roll latch (R1).** Per-round scratch is reset,
   input flags latched, then each active passive runs exactly once per round
   (weapon → deity → mob skill; in duels each side's weapon → deity in actor
   order), then actions. `crit_landed_this_hit` and `stun_just_applied` are
   pre-rolled at round start and refer to THIS round's main hit; pre-rolls are
   voided if the actor is skip-CC'd at round start.
2. **Latches.** `hit_received_this_turn` = "took an attack hit in the *previous*
   round" (valkyrie shield). `player_was_critted` is set when a crit lands and
   cleared after the next passive phase (vidar consumes it itself; hera does not).
3. **Defensive check flags are round-scoped.** A successful evade/block check
   (amihan, loki, gridr, skjaldmaer, sigbin, steel kite, pelte, njord, odin)
   covers every hit that round, including Cerberus sub-hits — one proc, one round.
4. **Riders are post-mitigation, pre-crit** (approved plan §4): added to the
   mitigated main hit, then the crit multiplier applies to the sum. The Mage
   Overcharge rider is the exception: flat, added after crit, cannot crit.
5. **Durations.** Skip-CCs (stun/paralyze/freeze/petrify/charm/confuse/miss)
   consume one charge at the afflicted actor's next action attempt — including
   actions later in the same round they were applied. Stat debuffs
   (atk/def/crit_down) expire at end of the round they were applied (1 turn).
   DOTs tick at end of round, 2 ticks, refresh-don't-stack, highest value wins.
6. **R8.** All `def_down` sources combine highest-wins (the debuff entry itself
   merges by max value; the engine then takes `max(debuff, laevateinn stack)`).
   Armor pierce is its own highest-wins lane, fully gated by `armor_pierce`
   immunity (incl. Gungnir full pierce and Archer class pierce).
7. **Accepted edges** (deterministic, documented):
   - Auto-crits granted during the same passive phase (Artemis/Vidar/Apollo's bow)
     upgrade the hit but are invisible to Thunderbolt's on-crit trigger that round
     (its independent 30% still rolls) — R1 as approved.
   - An armed rider is wasted if the owner's attack that round is CC-skipped
     (mimir/mjolnir/zeus riders sit in per-round scratch; valkyrie's nuke sits in
     `enemy_bonus_damage`). CC'd on your power round = power lost.
   - A 1-turn stun applied during the player's attack is consumed by the enemy's
     skip later that same round (when the enemy acts second), so the
     `enemy_is_stunned` window for cestus/myrmex reliably opens via 2-turn Fighter
     stuns or when the enemy acts first. Emergent from §35.1 durations.
   - Babaylan/Luzon in practice only interact with DOTs: 1-turn stat debuffs
     expire before the next passive phase and skip-CCs are consumed at the
     action, so they are never visible to a round-start cleanse/check.
   - `stun_just_applied` is latched before the passive phase; in a duel vs an
     Alan's-Reversed-Hands defender the latch can read true while the stun is
     blocked at apply time (jarngreipr would bash without the stun landing).
     Cosmetic, single edge, deterministic.

---

## WEAPON passives (70)

| Key | Impl | Effect (abridged) | Status |
|---|---|---|---|
| `none` | bespoke (no-op) | shared sentinel | ✓ |
| `cutlass` | chanceEnemyDebuff(10%, bleed 2t) | 10% flat Bleed on hit | ✓* value = 100% ATK/tick, kept from Phase 1 (text gives no number) |
| `kampilan` | firstHitBonus(20%) | first hit +20% ATK | ✓ |
| `war_club` | chanceEnemyDebuff(10%, stun 1t) | 10% stun 1 turn | ✓ |
| `bone_crusher` | firstHitBonus(20%) | first hit +20% ATK | ✓ |
| `crystal_wand` | chanceRider(10%, 15%) | 10% +15% ATK bonus hit | ✓ |
| `carved_totem` | firstHitBonus(20%) | first hit +20% ATK | ✓ |
| `steel_kite_shield` | chanceFlag(10%) | 10% block 15% incoming | ✓ engine applies ×0.85 in R3 stack |
| `reinforced_targe` | firstHitBonus(20%) | first hit +20% ATK | ✓ |
| `recurve_bow` | chanceRider(10%, 20%) | 10% +20% ATK bonus hit | ✓ |
| `crossbow` | bespoke | first hit +20% ATK ignoring 25% DEF | ✓ pierce flag consumed on the first main hit |
| `katana` | bespoke | crit ×2.30 instead of ×2.00 | ✓ engine reads `flags.katana` |
| `gladius` | chanceRider(30%, 50%) | 30% +50% ATK | ✓ |
| `scimitar` | stackingAtk(3%, 15%) | ATK +3%/turn to 15% | ✓ |
| `roman_cestus` | bonusVsState(stunned, 50%) | +50% vs stunned | ✓* see Global note 7 (stun windows) |
| `pata` | onHitEnemyDot(bleed, 30%) | flat Bleed 30% ATK, 2t, every hit | ✓ |
| `bagh_nakh` | stackingAtk(5%, 25%) | ATK +5%/turn to 25% | ✓ |
| `japanese_bo` | chanceFlag(25%) | 25% heal 50% of damage dealt | ✓ engine heals per damage instance |
| `english_quarterstaff` | chanceRider(20%, 50%) | 20% +50% ATK | ✓ |
| `egyptian_asa` | bespoke | +3% DEF-ignore/turn to 15% | ✓ merged into ignoreDefPct (highest wins) |
| `pilgrims_bordone` | chanceEnemyDebuff(50%, def_down 15%) | 50% enemy DEF −15% 1t | ✓ |
| `vatican_aspis` | constantSelfBuff(+10% ATK, −10% incoming) | constant | ✓ |
| `battersea_shield` | timedSelfBuff(2t, +25% DEF) | DEF +25% first 2 turns | ✓ |
| `enderby_shield` | chanceFlag(10%) | 10% reflect 30% incoming | ✓ reflect on FINAL applied dmg (R3), skipped on lethal (R5) |
| `holmegaard_bow` | stackingAtk(3%, 15%) | ATK +3%/turn to 15% | ✓ |
| `scandinavian_glacial_wooden_bow` | bespoke | 10% take another turn | ✓ rider: one extra attack, clock untouched |
| `scythian_composite_bow` | chanceRider(20%, 50%) | 20% +50% ATK | ✓ |
| `xiphos` | stackingAtk(4%, 20%) | ATK +4%/turn to 20% | ✓ |
| `kopis` | chanceRider(25%, 60%) | 25% +60% ATK | ✓ |
| `caestus` | chanceRider(35%, 40%) | 35% +40% ATK | ✓ |
| `myrmex` | bonusVsState(stunned, 40%) | +40% vs stunned | ✓* see Global note 7 |
| `dory` | stackingAtk(6%, 18%, every 2) | ATK +6%/2 turns to 18% | ✓ |
| `thyrsus` | chanceEnemyDebuff(20%, bleed 30% ATK 2t) | 20% Bleed | ✓ |
| `dipylon_shield` | timedSelfBuff(3t, +20% DEF) | DEF +20% first 3 turns | ✓ |
| `pelte` | chanceFlag(15%, +pct 0.25) | 15% block 25% | ✓ |
| `arrow_of_eros` | chanceRider(30%, 45%) | 30% +45% ATK | ✓ |
| `cretan_bow` | stackingAtk(4%, 20%) | ATK +4%/turn to 20% | ✓ |
| `juru_pakal` | bonusVsState(bleeding, 30%) | +30% vs bleeding | ✓ |
| `gram` | flatPierce(20%) | ignore 20% DEF | ✓ gated by armor_pierce immunity engine-side |
| `tyrfing` | stackingAtk(10%, 30%) | ATK +10%/turn to 30% | ✓ |
| `laevateinn_sword` | bespoke | enemy DEF −10%/turn stack to 30% | ✓* ONE def_down source, highest-wins vs others (R8); gated by def_down immunity |
| `jarngreipr` | bespoke | stun → Bash +60% | ✓* fires on the class-stun pre-roll latch (R1), same hit |
| `gridr_iron_gloves` | chanceFlag(20%) | 20% ignore incoming | ✓ negation consumes nothing (R3) |
| `alans_reversed_hands` | bespoke | immune to all status | ✓ engine + applyPlayerDebuff + duel-defender path all honor it |
| `knuckle_charm_anting_anting` | bespoke | 5% instakill | ✓ engine blocks vs bosses, disables in duels |
| `laevateinn_staff` | flatPierce(15%) | ignore 15% DEF | ✓ |
| `galdrastafir` | chanceEnemyDebuff(50%, def_down 30%) | 50% enemy DEF −30% 1t | ✓ |
| `babaylans_ritual_staff` | bespoke | cleanse every turn; +100% ATK on non-empty cleanse | ✓* R9 explicit: empty cleanse grants nothing (selftested); see Global note 7 |
| `badiang_stalk` | bespoke | 30% Rupture 10% max HP | ✓ boss-blocked via hp_pct_dot auto-immunity (registry + engine) |
| `shield_of_the_valkyrie` | bespoke | per hit received: +5% DEF/ATK to 30% | ✓* keyed on previous-round hit latch (Global note 2) |
| `skjaldmaer` | chanceFlag(15%) | 15% ignore incoming | ✓ |
| `luzon_tribal_shield` | bespoke | +40% DEF while debuffed | ✓* see Global note 7 (effectively DOT-window) |
| `gusisnautar` | bespoke | 50% Hemorrhage 10% + DEF −15% | ✓ boss-blocked; def_down part separately immune-gated |
| `freyrs_arrow` | chanceRider(50%, 100%) | 50% auto-fire 100% ATK | ✓ |
| `harpe` | flatPierce(30%) | ignore 30% DEF | ✓ |
| `sword_of_damocles` | bespoke | ATK +5%/turn to +100%; +5% damage taken | ✓ simplified (constant +0.05 incoming re-applied per round; identical behavior to the Phase 1 flag dance) |
| `labrys` | bespoke | every 3rd turn hits twice (2nd 70%, both crit) | ✓ 2nd hit rolls its own crit; riders not re-added |
| `hephaestus_hammer` | bespoke | +20% DEF battle; every 4th 150% forge strike | ✓ |
| `caduceus` | bespoke | every 3rd: cleanse + heal 8% | ✓ |
| `spear_of_ares` | stackingAtk(8%, 40%, every 2) | ATK +8%/2 turns to 40% | ✓ |
| `helm_of_darkness` | chanceEnemyDebuff(25%, miss 1t) | 25% enemy misses next attack | ✓ skip-CC consumed at the enemy's action |
| `aegis` | bespoke | 20% Stone Stack; 3 → stun, reset | ✓ |
| `apollos_silver_bow` | bespoke | ignore 25% DEF; every 4th auto-crit | ✓ |
| `mjolnir` | bespoke | +20% rider every turn; every 4th +200% crush | ✓ |
| `gungnir` | bespoke | ignore 40%; 30% full pierce + DEF −25% | ✓ full pierce = main hit, armor_pierce-immune gated |
| `thunderbolt_of_zeus` | bespoke | 30% or on-crit: +80% + paralyze | ✓* on-crit uses the R1 pre-roll latch (same hit); same-phase auto-crits invisible (Global note 7) |
| `trident_of_poseidon` | bespoke | every 3rd: +100%, 25% stun, DEF −20% | ✓ |

## DEITY blessings (41)

| Key | Impl | Effect (abridged) | Status |
|---|---|---|---|
| `bathala_divine_vessel` | bespoke | all stats +20% first 3 turns | Δ engine now applies AND REMOVES the +20% HP window (flag is reset each round and re-checked; Phase 1 never cleared `bathala_hp_bonus`) |
| `sidapa_deaths_reprieve` | bespoke | once: survive lethal at 1 HP | ✓ engine consumes before lethal damage |
| `magwayen_soul_drain` | bespoke | heal 10% of damage dealt | ✓ per damage instance |
| `mandarangan_war_frenzy` | bespoke | ATK +10%/turn cap 30% (turn 3) | ✓ |
| `apolaki_solar_burn` | bespoke | every 3rd: Burn 15% ATK 2t | ✓ |
| `mayari_lunar_veil` | hpThresholdBuff(<50%, +30% DEF) | | ✓ |
| `dian_masalanta_devotion` | hpThresholdBuff(<30%, +25% ATK) | | ✓ |
| `amihan_tailwind` | chanceFlag(20%) | 20% evade incoming | ✓ round-scoped (Global note 3) |
| `habagat_monsoon_fury` | chanceRider(25%, 50%) | 25% storm strike | ✓ |
| `lakapati_abundance` | regenSelf(1, 3%) | regen 3%/turn | ✓ |
| `idiyanale_persistence` | bespoke | every 5 turns next attack ×2 | ✓ rides this round's attack (passives precede actions) |
| `odin_all_fathers_wisdom` | bespoke | even turns: −50% incoming | ✓ |
| `thor_mjolnirs_wrath` | everyNthRider(3, 50%, stun) | | ✓ |
| `freya_valkyries_embrace` | bespoke | once ≤40%: heal 20% + ATK +15% 2t | ✓ |
| `loki_illusory_double` | bespoke | 20% evade + counter 50% ATK | ✓ counter can kill (R5-ordered) |
| `tyr_oathkeeper` | bespoke | +20% DEF; <50% HP reflect 15% | ✓ reflect on final applied dmg |
| `skadi_winters_hunt` | everyNthRider(3, 40%, freeze) | | ✓ |
| `surt_muspells_flame` | bespoke | Burn every attack; +50% vs burning | ✓ uses round-start `enemy_is_burning` |
| `heimdall_eternal_vigilance` | bespoke | first hit taken −50% | ✓ not consumed by evaded hits (R3, selftested) |
| `baldur_invulnerability` | bespoke | once: cleanse + heal 10% when debuffed/<50% | ✓ |
| `hel_half_dead` | hpThresholdBuff(<50%, +15/+15) | | ✓ |
| `mimir_runic_knowledge` | bespoke | every 4 turns next attack +65% | ✓* self-consumes per ENGINE_HOOKS; under round-start invocation the round-4 attack IS the next attack; wasted if that attack is CC-skipped (Global note 7) |
| `freyr_harvest_bounty` | regenSelf(2, 5%) | | ✓ |
| `njord_seas_favor` | chanceFlag(15%, pct 0.30) | 15% −30% incoming | ✓ |
| `bragi_battle_hymn` | bespoke | every 3: ATK +8% for 2 turns | ✓ |
| `idunn_golden_apple` | oncePerBattleHeal(≤50%, 15%) | | ✓ |
| `vidar_silent_vengeance` | bespoke | crit received → auto-crit back | ✓ consumes the latch (hera does not — both engine-supported) |
| `magni_might_of_magni` | bespoke | +5% ATK per 10% HP lost, cap 25% | ✓ |
| `zeus_thunder_sovereign` | everyNthRider(3, 80%, def_down 20%) | | ✓ R8 highest-wins with other def_down |
| `ares_blood_frenzy` | stackingAtk(8%, 40%, every 2) | | ✓ |
| `poseidon_tidal_force` | everyNthRider(4, 60%, 40% stun) | | ✓ |
| `hades_soul_harvest` | bespoke | enemy <30% HP: +35% ATK latched | ✓ reads live enemy HP% — for bosses the engine mirrors the shared pool via poolHp/poolMaxHp (§35.4) |
| `hera_divine_wrath` | bespoke | crit received: +10/+10 stack ×3 | ✓ |
| `athena_aegis_shield` | bespoke | first 2 hits −40% | ✓ engine owns the counter; evaded hits don't increment (R3, selftested) |
| `apollo_solar_radiance` | constantSelfBuff(+20% ATK) | | ✓ |
| `artemis_huntress_precision` | bespoke | first attack + every 4th auto-crit | ✓ |
| `hephaestus_forged_armor` | bespoke | +20% DEF; <50% HP +15% ATK | ✓ |
| `aphrodite_enchanting_aura` | bespoke | 20% charm (enemy skips) | Δ `aphrodite_charm_check` now only set when the charm actually applies (Phase 1 set it even vs charm-immune; engine acts on the debuff, so observable behavior unchanged — the flag no longer lies) |
| `persephone_cycle_of_renewal` | oncePerBattleHeal(<50%, 20%) | | ✓ |
| `dionysus_drunken_haze` | bespoke | 30% enemy self-hits 30% own ATK | ✓ death-checked in the passive phase |
| `nike_wings_of_victory` | constantSelfBuff(+25% ATK) | | ✓ |

## MOB / BOSS skills (31)

| Key | Impl | Effect (abridged) | Status |
|---|---|---|---|
| `dwende_black_hex` | chancePlayerDebuff(25%, atk_down 15%) | | ✓ |
| `dwende_white_daze` | chancePlayerDebuff(20%, crit_down 50%) | | ✓ crit_down is relative (crit × (1−v)) |
| `amalanhig_infectious_bite` | chancePlayerDebuff(30%, hp_pct_dot 5% 2t) | | ✓ |
| `amomongo_rend` | everyNthEnemyNuke(3, 150%) | | ✓ rider once per round (R4) |
| `bal_bal_carrion_sense` | bespoke | player <30% HP: enemy ATK +20% | ✓ per-round derived flag (engine resets) |
| `santelmo_will_o_wisp` | chancePlayerDebuff(20%, miss) | | ✓ |
| `manananggal_viscera_drain` | bespoke | every 3: drain 15% player max HP | ✓ can kill in the passive phase (death-checked) |
| `aswang_shape_shift` | bespoke | every 4: copy player ATK 2 turns | ✓ override reset each round, re-asserted by the countdown |
| `tikbalang_disorientation` | everyNthPlayerDebuff(3, atk_down 20%) | | ✓ |
| `kapre_smoke_cloud` | everyNthPlayerDebuff(4, crit_down 30% + atk_down 10%) | | ✓ |
| `sigbin_shadow_step` | chanceFlag(20%) | 20% evade player attack | ✓ round-scoped; rupture/instakill bursts still resolve (not attack damage) |
| `batibat_sleep_paralysis` | everyNthPlayerDebuff(4, paralyze) | | ✓ skips the player's action that same round |
| `troll_regeneration` | regenEnemy(1, 5%) | | ✓ |
| `dwarves_stone_skin` | bespoke | every 4: absorb next hit ≤20% max HP | ✓ consumed by the next player hit |
| `dark_elves_curse_of_decay` | chancePlayerDebuff(25%, def_down 10%) | | ✓ |
| `light_elves_radiant_strike` | chancePlayerDebuff(20%, crit_down 100%) | blind | ✓ |
| `ratatoskr_slander` | everyNthPlayerDebuff(3, atk_down 20%) | | ✓ |
| `fossegrim_enchanting_melody` | everyNthPlayerDebuff(4, miss) | | ✓ |
| `nokken_luring_form` | everyNthPlayerDebuff(3, def_down 20%) | | ✓ |
| `valkyrie_battle_judgment` | everyNthEnemyNuke(4, 200%) | | ✓ simplified from the Phase 1 arm/fire flag pair — observable behavior identical (fires the round it arms); wasted if the mob is CC-skipped that round (Global note 7) |
| `satyr_wild_revelry` | chancePlayerDebuff(25%, atk_down 15%) | | ✓ |
| `harpy_swooping_talons` | everyNthEnemyNuke(3, 150%, def_down 10%) | | ✓ |
| `skeleton_warrior_undying_resolve` | bespoke | <30% HP: DEF +25% latched | ✓ |
| `lamia_serpent_bite` | chancePlayerDebuff(30%, bleed 35% ATK 2t) | | ✓ |
| `minotaur_labyrinth_charge` | everyNthEnemyNuke(3, 180/220%) | conditional on player HP | ✓ |
| `cyclops_boulder_throw` | everyNthEnemyNuke(4, 160%, stun) | | ✓ |
| `chimera_tri_form_assault` | bespoke | rotates Lion/Goat/Serpent per round | ✓ |
| `hydra_regen` | bespoke | every 3rd: 5% regen LOCAL only | ✓ engine heals the local mirror; `totals.netDamage` excludes regen (selftested) |
| `stone_stare` | everyNthPlayerDebuff(3, petrify) | | ✓ |
| `none` | (shared) | immunity-only bosses | ✓ |

---

## Engine-side items (not registry, for completeness)

- Class passives (§11/§12): Swordsman bleed (ATK × rand(0.30–0.50), 2t, refresh,
  every landed attack), Fighter stun (one draw: <0.10 → 2-turn, <0.35 → 1-turn —
  R2 authored exception to the 1-turn CC rule; refresh-don't-extend), Mage
  Overcharge (+50%/round, fires +200% flat non-crit, resets), Knight ×0.80 after
  mitigation, Archer 25% pierce (armor_pierce-gated).
- `special_flags`: `first_strike` (no order roll), `multi_attack`/`multi_attack_pct`
  (sub-hits are riders; each crit-able; `enemy_bonus_damage` rides the first
  sub-hit only — R4).
- Boss auto-immunity to `hp_pct_dot`; per-row `immunity_tags` cover ALL sources
  of a tag (class + weapon + deity).
- §35.3: death check after every damage instance and DOT tick (R5 causal order;
  lethal hits end the battle before reflects); sudden death 10% max HP/round from
  round 30 (mutual → mob/challenged); hard cap 50 (raid/duel HP% — tie → b;
  boss → `boss_timeout`).
