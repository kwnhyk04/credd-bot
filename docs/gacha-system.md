# Gacha System (Invocations)

The gacha in Credd is called an **Invocation**. You spend Belief Shards to summon
forgotten deities, and duplicates convert into tier essence used to strengthen the
deities you already own. This document gives the exact pull rates, the pity rule, the
relic-driven summon paths, and every reward a pull produces.

Deities themselves — their stats, blessings, Sigils and Ascension — are covered in the
Deity System document. This document covers only how you obtain them.

## How do I summon a deity

| Command | Alias | Slash | Cooldown | Requires |
|---|---|---|---|---|
| `crd summon [count]` | `crd s [count]` | `/summon [count:]` | 10 seconds | A character |

| Argument | Type | Required | Range | Default |
|---|---|---|---|---|
| `count` | Integer | No | 1 to 30 | 1 |

Examples:

```text
crd summon
crd summon 10
crd summon 30
```

Slash form: `/summon count:10`

## What does a summon cost

<!-- src: src/config/gachaRates.js:28 -->

| Property | Value |
|---|---|
| Cost per pull | 100 Belief Shards |
| Minimum pulls per command | 1 |
| Maximum pulls per command | 30 |
| Cost of a full 30-pull | 3,000 Belief Shards |

The command is **all-or-nothing**: the full `count × 100` shards must be available before
any pull runs. If you cannot afford the whole batch the command replies with what you
need and what you have, and nothing is spent.

Invalid counts reply *"You can summon between 1 and 30 at a time - e.g. `crd summon 30`."*

## What are the deity summon rates

Four tiers, each with a display alias used everywhere in the interface.

<!-- src: src/config/gachaRates.js:14 -->

| Internal tier | Display name | Rate | Colour |
|---|---|---|---|
| Epic | Remnant | 64.5% | Blue (`#5865F2`) |
| Mythic | Awakened | 34.0% | Purple (`#9B59B6`) |
| Legendary | Undying | 1.0% | Gold (`#FFD700`) |
| Supreme | Primordial | 0.5% | Red (`#E74C3C`) |

Weights sum to exactly 1.0 and every roll uses a crypto-backed weighted draw. After the
tier is chosen, a specific available deity of that tier is picked uniformly.

## What are the gacha pity rates

Pity guarantees a Legendary after a run of 500 pulls without a natural Legendary or
Supreme.

<!-- src: src/config/gachaRates.js:25 -->

| Property | Value |
|---|---|
| Pity threshold | 500 pulls |
| Guaranteed tier at threshold | Legendary |

The per-roll rule:

<!-- src: src/config/gachaRates.js:77 -->

1. Make the natural weighted roll.
2. If it is a natural **Legendary or Supreme**, keep it and reset pity to 0.
3. Otherwise (Epic or Mythic) increment pity by 1. If pity reaches 500, force a
   Legendary and reset pity to 0. If not, keep the natural tier and the new pity count.

| Event | Pity effect |
|---|---|
| Natural Epic or Mythic | +1 |
| Natural Legendary | Reset to 0 |
| Natural Supreme | Reset to 0 |
| 500-threshold forced Legendary | Reset to 0 |
| Supreme Relic forced Supreme | **No change** — pity is untouched |

A Supreme forced by a Supreme Relic deliberately does not touch pity, because it bypasses
the tier roll entirely.

## What happens when I pull a duplicate deity

A duplicate does not add a second copy. It converts into essence of that deity's own
tier, which is the currency used for Sigils and Ascension progression.

<!-- src: src/config/gachaRates.js:34 -->

| Duplicate tier | Essence granted |
|---|---|
| Epic (Remnant) | +1 Epic Essence |
| Mythic (Awakened) | +2 Mythic Essence |
| Legendary (Undying) | +5 Legendary Essence |
| Supreme (Primordial) | +10 Supreme Essence |

Duplicates are detected within a single batch too: rolling the same not-yet-owned deity
twice in one 30-pull grants the deity on the first hit and essence on the second.

## What else does a summon give me

Every pull produces more than the deity itself.

| Reward | Detail |
|---|---|
| Reputation EXP | +10 per pull, capped at 1,500 per PHT day |
| Believer level-ups | Applied immediately with their level rewards |
| Auto-equip | If you had no active deity, the **first new** deity of the batch is equipped to slot 1 |
| Collection titles | Completing a mythology or the whole roster grants its title |

<!-- src: src/config/gachaRates.js:63 -->

Collection titles:

<!-- src: src/config/titles.js:30 -->

| Achievement | Title code |
|---|---|
| Own every available Philippine deity | `coll_ph_keeper` |
| Own every available Norse deity | `coll_norse_keeper` |
| Own every available Greek deity | `coll_greek_keeper` |
| Own every available deity in the game | `coll_pantheon_keeper` |

Collection checks run only when the batch contained at least one new deity.

## What are relics and how do they summon deities

Relics are summon tickets. They are opened with `crd open`, not with `crd summon`, and
they never cost Belief Shards.

<!-- src: src/commands/rpg/open.js:28 -->

| Relic | Open command | Pulls | Tier behaviour | Pity |
|---|---|---|---|---|
| Sacred Relic | `crd open sr` | 30 | Normal weighted rolls | Applies normally |
| Supreme Relic | `crd open supr` | 1 | **Forced Supreme** | Untouched |

Both relics open exactly one at a time. Passing a quantity is rejected:
*"Sacred Relics open one at a time — just `crd open sr`."*

Relics can also be consumed through `crd use sr` and `crd use supr`, which delegate to the
same atomic open flow.

Examples:

```text
crd open sr
crd open supr
crd use supr
```

## Where do I get Belief Shards and relics

| Source | Reward |
|---|---|
| Character creation | 1,000 Belief Shards (10 pulls) |
| Raid win vs regular mob | 5–10 Belief Shards |
| Raid win vs elite mob | 15–20 Belief Shards |
| Auto raid claim | Scaled Belief Shards (20% of expected raid yield) |
| Boss defeat | 1,000 / 1,500 / 2,000 Belief Shards by boss variant |
| Daily attendance | 100–1,000 Belief Shards by 30-day reward-cycle day |
| Daily quests | 500–1,000 Belief Shards per completed quest, based on difficulty |
| Weekly quests | 1 Sacred Relic per completed quest |
| PvP Shop | Sacred Relic 800 Valor, Supreme Relic 15,000 Valor |
| Ranked weekly and season rewards | Relics by bracket payload |

## What does the summon animation show

The summon is committed to the database **before** any animation plays, so a display
failure never costs you a pull.

| Phase | What happens |
|---|---|
| 1 — Flip | A suspense card flip, held for 4 seconds by default |
| 2 — Results | The message is edited into the rendered result grid |

| Result element | Content |
|---|---|
| Per pull | Tier symbol, tier alias, deity name, and either NEW or an essence icon plus count for a duplicate |
| Footer | Belief Shards remaining and Sacred Relic count |

Text result rows place a duplicate's essence icon and count before its tier and deity;
the literal word `Essence` is not appended after that count. Repeated pulls of the same
deity and rarity are compressed into one row with a `×N` pull count, and their duplicate
essence is totaled in that row. The batch summary counts the actual rarity of every pull
independently of whether each result is new or a duplicate, so a mixed batch is shown as
separate totals such as `◆ Remnant ×**23** - ❖ Awakened ×**7**` rather than one combined
category.

Equipped summon skins change the flip presentation. Most skins swap only the animated
header emoji; tester sets may use full-size suspense media with a configurable
`flip_seconds` duration. If rendering fails entirely the bot posts a plain-text list of
what you pulled, because the pulls are already committed.

## Is the gacha random or seeded

Every tier roll and every deity selection uses a crypto-backed random source, not a
seeded stream. Unlike battles, summons are not reproducible.

<!-- src: src/config/gachaRates.js:90 -->

## Summary of gacha limits

| Limit | Value |
|---|---|
| Shards per pull | 100 |
| Pulls per command | 1 to 30 |
| Pity threshold | 500 |
| Reputation EXP per pull | 10 |
| Daily reputation EXP cap | 1,500 |
| Sacred Relic pulls | 30 |
| Supreme Relic pulls | 1, forced Supreme |
| Relics opened per command | 1 |
