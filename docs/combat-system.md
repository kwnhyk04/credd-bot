# Combat System

Every fight in Credd — raids, duels, ranked PvP and boss attacks — is resolved by one
shared battle engine. Battles are fully automatic and decided up front: the engine
simulates the whole fight, then the result is animated. This document gives the exact
damage formula, the round pipeline, crit and damage-bonus rules, the defender stack, and
every status and damage-over-time effect in the game.

Combat is deterministic for a given seed: the same two fighters plus the same seed always
produce a byte-identical battle.

## How is damage calculated in Credd

Each hit runs one unified damage formula. There is a base component, then exactly one
multiplier.

<!-- src: src/engine/battleEngine.js:63 -->

```js
base = effATK * (1 - effDEF / (effDEF + 200)) * variance(0.90 .. 1.10)

// then exactly ONE multiplier:
//   Mage Overcharge (every 3rd round, primary attack, cannot crit):
damage = base * (2.75 + damagePct / 100)
//   otherwise:
damage = base * ((critLevel ? 2.0 : 1) + damagePct / 100)

damage = floor(damage)
```

| Term | Meaning |
|---|---|
| `effATK` | Attacker ATK after buffs, debuffs and `+X% ATK` riders |
| `effDEF` | Defender DEF after DEF-down and armor-pierce effects |
| `200` | The mitigation constant `MITIGATION_K` |
| `variance` | Uniform random 0.90–1.10 on every hit |
| `critLevel` | True on a rolled crit **or** a guaranteed crit-level hit |
| `damagePct` | Sum of all damage-% bonuses, applied to crit and non-crit alike |

<!-- src: src/engine/battleEngine.js:122 -->

## How does damage reduction from DEF work

DEF reduces incoming damage on a diminishing curve, never to zero.

```js
mitigation = 1 - DEF / (DEF + 200)
```

| Effective DEF | Damage taken |
|---|---|
| 0 | 100% |
| 100 | 66.7% |
| 200 | 50.0% |
| 500 | 28.6% |
| 1,000 | 16.7% |
| 2,000 | 9.1% |
| 5,000 | 3.8% |
| 10,000 | 2.0% |

DEF has no cap, but its value diminishes sharply. Armor pierce and DEF-down effects
lower `effDEF` before this curve is applied.

## How do critical hits work

A crit multiplies the hit by 2.0. There is no separate crit-damage stat — every damage
bonus is a plain damage % that applies to crit and non-crit hits alike.

<!-- src: src/config/combat.js:22 -->

| Rule | Value |
|---|---|
| Crit multiplier | ×2.0 |
| Crit chance source | Class CRIT + weapon CRIT + Precision rune points + resonance CRIT points |
| Crit chance cap | None |
| Crit during Mage Overcharge | Impossible — the Overcharge attack cannot crit |

The unified multiplier means:

<!-- src: src/config/combat.js:43 -->

```js
hitMultiplier = (crit ? 2.0 : 1) + damagePct / 100
```

| Situation | Normal hit | Critical hit |
|---|---|---|
| No damage bonus | ×1.0 | ×2.0 |
| Supreme weapon (+50%) | ×1.5 | ×2.5 |
| Supreme weapon + a 50% deity proc | ×2.0 | ×3.0 |
| Katana passive (+30%) | ×1.3 | ×2.3 |
| Legendary weapon rider (+25%) | ×1.25 | ×2.25 |

## Where do damage-% bonuses come from

Damage % stacks additively from every active source.

<!-- src: src/config/combat.js:33 -->

| Source | Damage % |
|---|---|
| Legendary weapon bonus rider (25% of Legendary drops roll it) | +25% |
| Supreme weapon (fixed on every Supreme weapon) | +50% |
| Genesis weapon (fixed on every Genesis weapon) | +50% |
| Katana — Lethal Edge passive | +30% |
| Deity blessing procs | varies per blessing |

## How does a battle round work

Battles run in rounds. Each round follows a fixed pipeline, and the whole fight is
capped at 50 rounds.

<!-- src: src/engine/battleEngine.js:37 -->

1. Round start — reset per-round scratch values and derived flags.
2. Latch input flags (`enemy_is_*`, `player_was_critted`).
3. Determine skip crowd-control.
4. Crit and class-stun pre-rolls.
5. Passive phase — every passive fires exactly once per round; attack-bound work is
   queued for the action and landed-hit hooks. Death is checked after every passive.
6. Actions in actor order. After each side acts, its damage-over-time ticks before the
   other side can act.
7. Stat-debuff expiry, then sudden-death drain on rounds 30 and later.
8. Snapshot for the renderer, on the mode's cadence.

| Constant | Value |
|---|---|
| Maximum rounds | 50 |
| Sudden death starts at round | 30 |
| Sudden death drain per round | 10% of max HP |
| Sudden death applies to | Player-kind sides only — mobs and bosses are exempt |
| Snapshot cadence (raid / duel) | Rounds 1, 4, 16, … |
| Snapshot cadence (boss) | Every 3rd round |

<!-- src: src/engine/battleEngine.js:118 -->

## Who attacks first

| Mode | First actor |
|---|---|
| Raid | 50/50 random roll |
| Duel / Ranked | 50/50 random roll |
| Boss | The player always acts first |
| Any mob with the `first_strike` flag (e.g. Sleipnir) | The mob, regardless of mode |

The `first_strike` flag is checked before the boss rule, so a first-strike boss still
attacks first.

## What is the defender stack

When a hit lands on a player, defensive effects resolve in a fixed order. This order is
what makes reduction, reflection and caps combine predictably.

<!-- src: src/engine/battleEngine.js:77 -->

1. Evasion — a real evade shows `Evaded!` with no damage line at all.
2. Full-hit negation or block (Ironhide, Shieldmaiden's Guard, Stone Skin). This is a
   zero-damage hit, **not** an evasion.
3. Raw post-DEF damage.
4. All damage-reduction sources summed into one additive total, capped at **70%**.
5. Incoming-damage increases applied (e.g. Petrify amplification).
6. Mail of Brokkr per-hit cap (15% of max HP).
7. Damage applied.
8. Each reflect source resolved separately against the final damage taken.
9. On-hit armor stacks added.

Reflected damage never re-enters the defender stack, so reflects cannot chain.

For mob defenders the stack is shorter: Sigbin evade (round-scoped), then Dwarf Stone
Skin absorb (consumed).

| Rule | Value |
|---|---|
| Maximum total damage reduction | 70% |
| Knight class damage reduction | 25% |
| Knight outgoing damage bonus | 30% |

## How do DEF-down and armor pierce combine

Both use highest-wins, never multiplication.

<!-- src: src/engine/battleEngine.js:85 -->

| Lane | Rule |
|---|---|
| DEF-down | All sources (the `def_down` debuff, itself merged highest-value, and the Laevateinn stack) combine highest-wins. |
| Armor pierce | A separate highest-wins lane, gated by `armor_pierce` immunity. Includes Gungnir full pierce and the Archer class pierce. |

Gungnir's full pierce (zero mitigation) supersedes its own 30% ignore rather than
stacking with it.

## What status effects exist in Credd

Status effects last 1 turn unless the source says otherwise. Crowd-control effects cause
the affected side to skip its action.

<!-- src: src/engine/combatEffects.js:11 -->

| Effect | Category | Crowd control | Notes |
|---|---|---|---|
| Stun | Status | Yes | Target skips its turn |
| Freeze | Status | Yes | Target skips its turn; Frostbite may follow |
| Petrify | Status | Yes | Target skips its turn and takes more damage while petrified |
| Paralyze | Status | Yes | Target skips its turn |
| Thor Paralyze | Status | Yes | Linked to a separate DOT so status immunity never blocks the damage |
| Dizzy | Status | Yes | Applied by Fighter Bash |
| Miss | Status | Yes | Forced miss |
| Charm | Status | Yes | Target skips its attack |
| Confuse | Status | Yes | Target skips its turn |
| Frostbite | Status | No | Target takes 50% more damage for 1 turn |
| ATK Down | Status | No | Reduces target ATK |
| DEF Down | Status | No | Reduces target DEF |
| CRIT Down | Status | No | Reduces target CRIT |
| Darkened | Status | No | Target's CRIT chance is forced to 0% for the duration, overriding CRIT Down |
| Hemorrhage | Status | No | Carries the Bleed tag |
| Rupture | Status | No | Carries the Bleed tag |

Petrify damage amplification:

<!-- src: src/config/combat.js:60 -->

| Petrify source | Damage taken while petrified |
|---|---|
| Aegis — Medusa's Gaze | +50% |
| All other petrify sources | +25% |

## What damage-over-time effects exist

DOT effects tick at the end of the affected side's action. Bleed and Burn DOTs tick for
2 turns unless the source says otherwise.

<!-- src: src/engine/combatEffects.js:29 -->

| DOT | Bleed-tagged | Typical duration |
|---|---|---|
| Bleed | Yes | 2 turns |
| Venom | Yes | 2 turns |
| Burn | No | 1–2 turns depending on source |
| Poison | No | 2 turns |
| Rot (`hp_pct_dot`) | No | 2 turns |
| Paralysis DOT (`thor_paralyze_dot`) | No | 3 turns (Thor) |

The Bleed tag matters because some passives check for it. Juru Pakal's Bloodhunter deals
50% more damage against any target affected by Bleed, Hemorrhage, Rupture or Venom.

Canonical on-hit burn effects:

<!-- src: src/engine/combatEffects.js:37 -->

| Source | Burn per hit | Cap | Duration |
|---|---|---|---|
| Apolaki — Solar Burn | 10% of base ATK | 10% | 1 turn |
| Surt — Muspell's Flame | 3% of base ATK | 15% | 2 turns |

## How does the Aegis / Medusa's Gaze stack work

Aegis is worth documenting exactly because the third stack behaves differently from the
first two.

<!-- src: src/config/combat.js:60 -->

| Rule | Value |
|---|---|
| Damage reduction per Stone stack | 10% |
| Stacks required to Petrify | 3 |
| Petrify duration | 1 turn |
| Damage amplification while petrified by Aegis | +50% |
| Effective maximum reduction | 20% (2 stacks) |

The third stack is consumed by the Petrify and the accrued reduction is removed in the
same step, so Aegis never reaches 30% reduction. This is deliberate: 30% stacking
reduction plus a Petrify would strictly dominate Mail of Brokkr's flat 30%.

## What is Mage Overcharge and how does it interact with crits

Overcharge is the Mage class passive. On every 3rd round the Mage's **primary** attack
uses a fixed 2.75 multiplier and cannot crit.

<!-- src: src/engine/battleEngine.js:56 -->

| Rule | Detail |
|---|---|
| Fires on | Rounds 3, 6, 9, 12, … |
| Multiplier | `2.75 + damagePct / 100` |
| Can crit | No — the crit pre-roll is voided for that attack |
| Additional attacks in the same action | Never inherit Overcharge; they roll crit normally |
| Blocked by crowd control | Yes — that Overcharge is lost, there is no carry-over |

After a successful Overcharge hit, one injected RNG draw selects exactly one equally
likely debuff: Paralyze, Burn, DEF Down, or ATK Down. The selected effect lasts for one
affected turn, refreshes without stacking when reapplied, and is never selected for a
missed or fully avoided attack. Paralyze deals 5% of the Mage's effective ATK during
the skipped turn; Burn deals 10% of the Mage's effective ATK once.

## How are additional attacks resolved

Some passives grant extra attacks. They resolve after the primary attack in a fixed
order and each gets fresh rolls.

<!-- src: src/engine/battleEngine.js:28 -->

Resolution order: Labrys → Glacial Bow → Archer double attack.

| Rule | Detail |
|---|---|
| Fresh rolls | Each additional attack gets its own crit, variance, landed-hit and defensive rolls |
| Generator hooks | Disabled on additional attacks, so an extra attack cannot generate another |
| Eligibility | Only the primary attack can generate additional attacks |

## How does execute work (Tyrfing, Death Charm)

Execute effects instantly kill below an HP threshold. Bosses are immune.

<!-- src: src/engine/battleEngine.js:138 -->

| Target kind | Tyrfing execute threshold |
|---|---|
| Mob | Below 10% of max HP |
| Player character (both duel sides) | Below 5% of max HP |
| Boss | Immune — checked before either threshold |

Death Charm (Knuckle Charm / Anting-Anting) has a 5% chance on attack to instantly kill a
non-boss target. Death Charm and Tyrfing executes never affect bosses.

## What ends a battle

| Condition | Result |
|---|---|
| Either side reaches 0 HP | That side loses immediately (first-to-zero) |
| Round 50 is reached | The battle ends at the hard cap |
| A DOT tick reduces a side to 0 | That side loses, with the DOT named as the cause of death |

Cause of death is carried through the result and the battle log for Cursed Edge, Death
Charm, lethal DOTs and reflect kills.

## How does the combat log decide what to show

Weapon and armor passive log policy is deliberate and consistent:

| Passive kind | Log behaviour |
|---|---|
| Persistent bonus | Announces once per battle |
| Stacking bonus | Announces only when a stack is gained |
| Chance or reactive effect | Announces only when it actually alters a hit or a status application |

Within a round the log is re-sequenced for readability to: attacks and their own DOT →
passive procs → sudden death. Only the display order changes; the simulation order is
the round pipeline above.

An evade renders `Evaded!` with no `0 DMG` line. Full absorption or negation (Ironhide,
Shieldmaiden's Guard, Stone Skin) renders as a zero-damage hit, not an evasion.

## Can a crowd-controlled turn still proc effects

No. Attack hooks and landed-hit hooks are distinct.

| Situation | Attack hooks | Landed-hit hooks |
|---|---|---|
| Normal landed attack | Fire | Fire |
| Attack evaded | Fire | Do not fire |
| Attack fully negated | Fire | Do not fire |
| Turn skipped by crowd control | Do not fire | Do not fire |

Queued next-attack effects survive a skipped turn and are consumed only when a real
attack begins.
