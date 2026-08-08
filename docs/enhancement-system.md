# Enhancement System (Forge)

Enhancement is how you upgrade gear and deities in Credd. Weapons and armor are enhanced
with Credux and can fail; deities are enhanced with essence and never fail. This document
gives the full cost tables, success rates, stat multipliers, and the exact behaviour of
the forge interface.

Enhancement is the single largest Credux sink in the game.

## How do I enhance a weapon or armor

| Command | Alias | Slash | Cooldown |
|---|---|---|---|
| `crd enhance <id>` | `crd enh <id>` | `/enhance weapon_id:` | 10 seconds |

Example:

```text
crd enhance a1b2c3d4
```

The command opens a forge view showing the item's current level, the next target level,
the cost, the success chance, and the stat gain. Each **Enhance** click is one atomic
attempt; the message re-renders in place so you can keep attempting or press Cancel.

## What is the enhancement stat multiplier

Both weapons and armor use the same boost table. Enhancement is stored one-based, so the
displayed level is the stored value minus 1.

<!-- src: src/engine/enhancement.js:25 -->

```js
curr_atk = floor(base_atk * WEAPON_BOOST_TABLE[enhancement])   // weapons
curr_hp  = floor(base_hp  * WEAPON_BOOST_TABLE[enhancement])   // armor
curr_def = floor(base_def * WEAPON_BOOST_TABLE[enhancement])   // armor
```

| Display level | Stored value | Stat multiplier | Gain over previous |
|---|---|---|---|
| +0 | 1 | ×1.00 | — |
| +1 | 2 | ×1.05 | +5% |
| +2 | 3 | ×1.10 | +5% |
| +3 | 4 | ×1.15 | +5% |
| +4 | 5 | ×1.20 | +5% |
| +5 | 6 | ×1.25 | +5% |
| +6 | 7 | ×1.32 | +7% |
| +7 | 8 | ×1.40 | +8% |
| +8 | 9 | ×1.50 | +10% |
| +9 | 10 | ×1.70 | +20% |
| +10 | 11 | ×2.00 | +30% |

A +10 item is exactly double its base stats. Enhancement never changes CRIT or a weapon's
damage-% rider.

## What are the enhancement success rates

Success chance depends only on the target display level, not on tier.

<!-- src: src/engine/enhancement.js:41 -->

| Target level | Success chance |
|---|---|
| +1 | 100% |
| +2 | 95% |
| +3 | 85% |
| +4 | 75% |
| +5 | 65% |
| +6 | 55% |
| +7 | 40% |
| +8 | 30% |
| +9 | 20% |
| +10 | 10% |
| +11 to +20 (Genesis only) | 10% |

**Credux is deducted on both success and failure.** A failure does not reduce the item's
level — it simply does not advance it. Gear is never destroyed by a failed enhancement.

## What does each enhancement level cost

Cost is by tier and target display level, in Credux.

<!-- src: src/engine/enhancement.js:55 -->

| Target | Rare | Mythic | Legendary | Supreme | Genesis |
|---|---|---|---|---|---|
| +1 | 1,000 | 5,000 | 15,000 | 50,000 | 50,000 |
| +2 | 3,000 | 12,000 | 35,000 | 100,000 | 100,000 |
| +3 | 6,000 | 25,000 | 70,000 | 200,000 | 200,000 |
| +4 | 12,000 | 50,000 | 130,000 | 400,000 | 400,000 |
| +5 | 20,000 | 90,000 | 220,000 | 650,000 | 650,000 |
| +6 | 35,000 | 150,000 | 380,000 | 1,000,000 | 1,000,000 |
| +7 | 55,000 | 250,000 | 600,000 | 1,500,000 | 1,500,000 |
| +8 | 90,000 | 400,000 | 900,000 | 3,000,000 | 3,000,000 |
| +9 | 100,000 | 650,000 | 1,500,000 | 3,000,000 | 3,000,000 |
| +10 | 100,000 | 1,000,000 | 2,000,000 | 3,000,000 | 3,000,000 |
| +11 to +20 | — | — | — | — | 3,000,000 each |
| **Total to +10** | **422,000** | **2,632,000** | **5,850,000** | **12,900,000** | **12,900,000** |

Every cost is a clean multiple of 1,000, which is why the `credux_spent` quest tracks
progress in thousands losslessly.

## Which items can be enhanced

<!-- src: src/engine/enhancement.js:22 -->

| Tier | Enhanceable | Maximum |
|---|---|---|
| Common | No | — |
| Rare | Yes | +10 |
| Mythic | Yes | +10 |
| Legendary | Yes | +10 |
| Supreme | Yes | +10 |
| Genesis (weapons only) | Yes | **+20** |

Attempting to enhance Common gear replies *"Common gear cannot be enhanced."* Attempting
to enhance a maxed item replies *"This equipment is already maxed (+10)."*

## How does Genesis enhancement past +10 work

Genesis weapons continue from +11 to +20. Each of those levels adds 10% of the weapon's
**+10 ATK**, not 10% of its base ATK.

<!-- src: src/engine/enhancement.js:148 -->

```js
plusTenAtk  = floor(base_atk * 2.00)            // the +10 value
perLevelAtk = floor(plusTenAtk * 0.10)
curr_atk    = plusTenAtk + perLevelAtk * (stored - 11)
```

For a Genesis weapon at 1,600 base ATK:

| Display level | ATK |
|---|---|
| +0 | 1,600 |
| +10 | 3,200 |
| +11 | 3,520 |
| +15 | 4,800 |
| +20 | 6,400 |

Levels +11 through +20 reuse the Supreme +10 cost (3,000,000 Credux) and the +10 success
rate (10%).

## How much Credux does a full enhancement path cost on average

Because attempts can fail, the expected spend is higher than the table total. Expected
attempts at a level is `1 / successRate`.

| Target level | Success | Expected attempts |
|---|---|---|
| +1 | 100% | 1.0 |
| +5 | 65% | 1.5 |
| +7 | 40% | 2.5 |
| +8 | 30% | 3.3 |
| +9 | 20% | 5.0 |
| +10 | 10% | 10.0 |

## How do I enhance a deity

Deity enhancement is a separate system with no failure chance. It requires the deity to
be Ascended first.

| Command | Alias | Slash |
|---|---|---|
| `crd deity enhance <name>` | `crd deh <name>` | `/deity enhance name:` |

Example:

```text
crd deity enhance Zeus
```

<!-- src: src/engine/deityEnhancement.js:16 -->

| Property | Value |
|---|---|
| Range | +0 to +10 |
| Multiplier per level | +10% of base to HP, ATK and DEF uniformly |
| Multiplier at +10 | ×2.00 |
| Success rate | 100% — deterministic |
| Currency | Essence of the deity's own tier |
| Prerequisite | The deity must be Ascended |

Deity essence costs:

<!-- src: src/engine/deityEnhancement.js:25 -->

| Target | Epic | Mythic | Legendary | Supreme |
|---|---|---|---|---|
| +1 | 15 | 15 | 10 | 4 |
| +2 | 19 | 18 | 12 | 5 |
| +3 | 23 | 21 | 14 | 6 |
| +4 | 27 | 24 | 16 | 7 |
| +5 | 31 | 27 | 18 | 8 |
| +6 | 35 | 30 | 20 | 10 |
| +7 | 39 | 33 | 22 | 12 |
| +8 | 43 | 36 | 24 | 14 |
| +9 | 47 | 39 | 26 | 16 |
| +10 | 51 | 42 | 28 | 18 |
| **Total** | **330** | **285** | **190** | **100** |

Before Ascension, the same command handles Sigils and the Ascension itself — see the
Deity System document for those costs.

## What does enhancement progress toward

Every gear enhancement attempt, successful or not, progresses quests:

<!-- src: src/commands/rpg/enhance.js:319 -->

| Quest type | Progress per attempt |
|---|---|
| `credux_spent` | The full Credux cost of the attempt |
| `weapon_enhancements` | +1 |

Both daily and weekly quest boards receive the same deltas. Deity enhancement does not
progress these quests.

## Does enhancement affect resale value

Yes. Selling an enhanced item refunds 30% of the canonical costs of the levels it
successfully reached.

<!-- src: src/config/sellPrices.js:23 -->

```js
enhancementRefund = floor(successfulEnhancementCost * 0.30)
total             = basePrice + enhancementRefund
```

Failed attempts and your actual historical spend are deliberately excluded — the refund
counts each completed level exactly once at its canonical price.

Example: a Mythic weapon at +7 refunds 30% of the Mythic +1 through +7 costs
(5,000 + 12,000 + 25,000 + 50,000 + 90,000 + 150,000 + 250,000 = 582,000), so
174,600 Credux on top of the 50,000 Mythic base price.

## Can I lose an item by enhancing it

No. There is no destruction or downgrade mechanic. The only cost of a failure is the
Credux spent on that attempt.

| Outcome | Credux | Level |
|---|---|---|
| Success | Deducted | +1 |
| Failure | Deducted | Unchanged |
| Not enough Credux | Not deducted | Unchanged |
| Item already maxed | Not deducted | Unchanged |
