# ENGINE_HOOKS.md — Phase 6 Battle-Engine Contract

The passive registry (`src/engine/passiveRegistry.js`) is **pure state-mutation** — it reads
and writes a single `bs` (battle-state) object. It never deals damage, applies mitigation,
ends the battle, or commits to the DB. **The Phase 6 battle engine must implement everything
below.** Every field a registry function touches is listed here.

This file is the source of truth for what the engine owes the registry. If a registry function
is added/changed, update this file.

---

## 1. Invocation rules (§35.1)

- Call each active passive **exactly once per round**, in §13.1 priority order:
  `PASSIVE_REGISTRY[weapon.passive_key](bs)` → `PASSIVE_REGISTRY[deity.blessing_key](bs)`
  (active deity only) → `PASSIVE_REGISTRY[mob.skill_key](bs)`.
- `bs.currentTurn` is the **round counter** and the only periodic clock. Increment it once per
  round, never per attack.
- **Riders never advance the round counter and never re-fire per-turn passive stacking.**
  `extra_turn` (Glacial Bow), `labrys_double_hit`, `mjolnir` crush, `loki_counter_dmg`,
  Cerberus `multi_attack` (special_flags) all resolve as extra damage/actions within the same
  round.
- `bs.flags` **persists for the whole battle**. The per-turn scratch fields below must be
  **reset by the engine at the start of every round** (before calling passives):
  `bonusDamage = 0`, `bonusIncomingDmgMult = 0`, `playerAtkMult = 0`, `playerDefMult = 0`,
  `ignoreDefPct = 0`, `nextAttackAutoCrit = false`, `nextAttackDouble = false`, `log = []`.
  Anything in `bs.flags.*` is intentionally durable.

## 2. Durations (§35.1)

- CC + stat debuffs (`stun`, `paralyze`, `freeze`, `petrify`, `charm`, `confuse`, `miss`,
  `atk_down`, `def_down`, `crit_down`) = **1 turn**.
- DOTs (`bleed`, `burn`, `hp_pct_dot`) = **2 ticks**. New application **refreshes**, does not
  stack; highest value wins (§13.1).

---

## 3. Core `bs` fields the registry expects

| Field | Type | Engine responsibility |
|---|---|---|
| `currentTurn` | int | Round counter; provide before calling passives. |
| `playerATK/playerHP/playerMaxHP/playerDEF/playerCrit` | int | Current live player stats. Registry mutates `playerHP` for heals/drains — clamp + read back. |
| `enemyATK/enemyHP/enemyMaxHP/enemyDEF` | int | Current live enemy stats. Registry mutates `enemyHP` (Dionysus, Manananggal, Troll). |
| `bonusDamage` | number | **Per-turn, reset to 0.** Sum of all rider damage to add to the player's hit this round. |
| `bonusIncomingDmgMult` | number | **Per-turn, reset to 0.** Additive delta to the incoming-damage multiplier (`0` = normal). Final incoming = baseIncoming × (1 + bonusIncomingDmgMult). Damocles `+= 0.05`, Vatican Aspis `-= 0.10`. |
| `playerAtkMult` | number | **Per-turn, reset to 0.** Additive ATK % delta this round. Effective ATK = playerATK × (1 + playerAtkMult). |
| `playerDefMult` | number | **Per-turn, reset to 0.** Additive DEF % delta this round. |
| `ignoreDefPct` | number | **Per-turn, reset to 0.** Armor-pierce fraction; **highest wins** (registry only raises it). Apply to enemy effective DEF. Gate vs `armor_pierce`-immune bosses. |
| `nextAttackAutoCrit` | bool | **Per-turn, reset.** Force this round's player attack to crit. |
| `nextAttackDouble` | bool | **Per-turn, reset.** This round's player attack deals double damage. |
| `playerStatusImmune` | bool | Set by `alans_reversed_hands`. Engine must block ALL player-targeted debuffs when true. (Registry also guards, but enforce engine-side too.) |
| `log` | string[] | **Per-turn, reset to [].** Append to battle log after the round. |

### Functions the engine must provide on `bs`

| Function | Behavior |
|---|---|
| `enemyImmune(tag)` | True if the mob's `immunity_tags` includes `tag` or `all_debuffs`; **always true for `hp_pct_dot` on any boss**. |
| `applyDebuff(tag, turns, value?)` | Add/refresh an **enemy** debuff (refresh, highest value wins). |
| `applyPlayerDebuff(tag, turns, value?)` | Add/refresh a **player** debuff. Must no-op if `playerStatusImmune`. |
| `hasPlayerDebuff(tag)` | True if player has the tag active. **`hasPlayerDebuff('any')` must return true if the player has ANY active debuff** (used by Babaylan, Baldur, Luzon Tribal Shield). |
| `clearPlayerDebuffs()` | Remove all player debuffs (cleanse). |

---

## 4. `bs.flags.*` — engine must SET these before passives run (inputs to registry)

The registry reads these; the engine is responsible for setting them correctly each round/hit.

| Flag | Engine must set it to… | Read by |
|---|---|---|
| `enemy_is_stunned` | true if the enemy currently has a `stun` debuff | roman_cestus, myrmex |
| `enemy_is_bleeding` | true if the enemy currently has a `bleed` debuff | juru_pakal |
| `enemy_is_burning` | true if the enemy currently has a `burn` debuff | surt_muspells_flame |
| `stun_just_applied` | true on the hit where the player's attack just landed a stun | jarngreipr |
| `crit_landed_this_hit` | true if the player's attack this hit was a crit | thunderbolt_of_zeus |
| `player_was_critted` | true if the player took a crit since last round | vidar_silent_vengeance, hera_divine_wrath |
| `hit_received_this_turn` | true if the player took a hit this round | shield_of_the_valkyrie |

> Note: `vidar` clears `player_was_critted` after consuming it; `hera` does not. The engine should
> set `player_was_critted` when a crit is received and clear it at round start so both behave correctly.

## 5. `bs.flags.*` — registry SETS these; engine must ACT on them (outputs from registry)

| Flag | Engine action |
|---|---|
| `crossbow_pierce` | Ignore 25% of enemy DEF on this (first) hit. |
| `katana` | Player crits use ×2.30 instead of ×2.00 (§35.2 exception). |
| `japanese_bo_active` | After computing damage dealt, heal player 50% of it. |
| `steel_kite_shield_block` | Reduce this round's incoming damage by 15%. (Re-rolled each round.) |
| `enderby_reflect_check` | If true, reflect 30% of the incoming hit back to the enemy. |
| `pelte_block_check` / `pelte_block_pct` | If check true, reduce incoming by `pelte_block_pct` (0.25). |
| `gridr_ignore_check` | If true, negate the incoming hit entirely. |
| `skjaldmaer_ignore_check` | If true, negate the incoming hit entirely. |
| `extra_turn` | Player takes another attack action this round (rider — do NOT increment `currentTurn`, do NOT re-run per-turn stacking passives). |
| `instakill_check` | 5% Death Charm proc — kill enemy instantly **unless boss**; **disabled entirely in duels** (Knuckle Charm). |
| `rupture_check` / `rupture_pct` | Deal `rupture_pct` × enemy max HP as burst (hp_pct_dot — blocked by all bosses). |
| `hemorrhage_check` / `hemorrhage_pct` | Deal `hemorrhage_pct` × enemy max HP (hp_pct_dot — blocked by all bosses). |
| `gungnir_full_pierce` | Set enemy effective DEF to 0 for this hit (zero mitigation). |
| `laevateinn_sword_def_stack` | Reduce enemy **effective DEF** by this fraction (accumulates to 0.30, persists, gated by `def_down` immunity). |
| `egyptian_asa_pierce` | Contributes to `ignoreDefPct` (already merged via highest-wins). |
| `labrys_double_hit` / `labrys_second_hit_pct` | Player attacks twice this round; 2nd hit = `labrys_second_hit_pct` (0.70) × ATK; both crit-eligible. |
| `mimir_next_attack_bonus` | (Registry self-consumes into `bonusDamage`; no engine action needed.) |
| `odin_wisdom_block` | If true this round, halve incoming damage (50% reduction). |
| `tyr_reflect` | Fraction (0 or 0.15) of incoming damage to reflect to enemy. |
| `loki_evade_check` / `loki_counter_dmg` | If evade true, negate the incoming hit and deal `loki_counter_dmg` back. |
| `amihan_evade_check` | If true, negate the incoming attack (evasion). |
| `njord_block_check` / `njord_block_pct` | If check true, reduce incoming by `njord_block_pct` (0.30). |
| `sigbin_evade_check` | If true, the enemy evaded the player's attack (negate player's hit). |
| `aphrodite_charm_check` | (Registry applies the `charm` debuff; engine makes charmed enemy skip its attack.) |
| `athena_shield_active` / `athena_hits_absorbed` | If `athena_shield_active`, reduce this incoming hit by 40% and **increment `athena_hits_absorbed`** (engine owns the counter; cap 2). |
| `heimdall_first_hit_available` / `heimdall_first_hit_used` | On the first incoming hit, negate 50% of it, then set `heimdall_first_hit_used = true` and clear `_available`. |
| `sidapa_reprieve_available` / `sidapa_reprieve_used` | Before applying lethal damage, if `_available` and not `_used`, set player HP to 1 instead and set `_used = true`. |
| `bathala_hp_bonus` | First 3 rounds, also treat effective max/eff HP as +20% (stat buff, not a debuff). |
| `soul_drain_active` | Heal player 10% of damage dealt this hit (Magwayen). |
| `dwarf_shield_active` / `dwarf_shield_cap` | Absorb the next incoming hit up to `dwarf_shield_cap` (Stone Skin). |
| `hydra_local_regen` | Heal the **local** enemy-HP mirror by this amount; **never** commit to the shared `boss_state` pool; only NET damage commits. |
| `enemy_bonus_damage` | Extra enemy damage to add to the enemy's attack this round (Amomongo, Valkyrie, Harpy, Minotaur, Cyclops, Chimera Lion). |
| `enemy_atk_mult` | Multiply enemy ATK this round (Bal-Bal ×1.20). |
| `enemy_def_mult` | Multiply enemy DEF this round (Skeleton Warrior +0.25 → ×1.25). |
| `enemy_atk_override` | If non-null, the enemy uses this ATK value this round (Aswang copied ATK); null = normal. |

## 6. special_flags (boss only — engine-handled, NOT in the registry; §35.4)

| Flag | Engine behavior |
|---|---|
| `first_strike` | Sleipnir — boss takes the very first action of the battle regardless of the 50/50 roll. |
| `multi_attack` / `multi_attack_pct` | Cerberus — boss attacks `multi_attack` (2) times per round, each at `multi_attack_pct` (0.60) × ATK; each can crit. Rider — does not advance the clock. |

## 7. Other engine duties referenced indirectly

- CRIT: total = class + weapon crit; class cap 40%, total cap 45%; ×2.0 (×2.30 with Katana);
  Supreme weapon crit = 0 with +50% flat DMG always and +50% crit-DMG rider only on crits from
  other sources (§35.2).
- Class passives (Bleed/Stun/Overcharge/Pierce/Damage Reduction) are engine-side, NOT registry.
- Sudden-death drain from round 30 (10% max HP/round), hard cap round 50 (§35.3).
- Death check after each attack's full (post-crit) damage and after each DOT tick (§35.3).
- `floor()` everywhere curr stats are computed (§35.2).
