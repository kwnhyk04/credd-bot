# Boss System

Bosses are shared, server-wide monsters with a single HP pool that every player chips
away at together. A boss spawns automatically, stays until it is defeated, and pays the
same participation rewards to everyone who attacked it. This document covers the spawn
schedule, the daily attack limit, the Greater/Calamity tiers, and the full reward tables.

Boss fights are the largest single source of Credux, Belief Shards and Boss chests in
Credd.

## Where can I fight bosses

Monster bosses are currently hosted in the **official Credd support server only**. In any
other server the bot posts a redirect notice instead of spawning a boss.

<!-- src: src/engine/bossSystem.js:1279 -->

| Command | Alias | Slash | Requires a character | Cooldown |
|---|---|---|---|---|
| `crd boss` | — | `/boss` | No (view only) | 10 seconds |

`crd boss` re-posts the current boss status card. The **⚔️ Attack** button on that card
enforces its own gates, so the command itself does not require a character.

Example:

```text
crd boss
```

## How often does a boss spawn

A scheduler ticks every 60 seconds. For each guild it finishes any interrupted reward
distribution, then spawns a new boss if the previous one has been dead for at least 15
minutes.

<!-- src: src/schedulers/bossScheduler.js:21 -->
<!-- src: src/engine/bossSystem.js:86 -->

| Rule | Value |
|---|---|
| Scheduler tick | Every 60 seconds |
| Respawn cooldown after a defeat | 15 minutes |
| Boss lifetime | Until defeated; an idle calamity escapes after 2 hours without an attack |
| Spawn requires | At least one registered character active in the guild |

An immediate pass also runs at bot startup, so a defeat interrupted by a restart is
settled straight away.

## How strong is the boss

Bosses no longer have a gameplay level. Every boss uses its fixed authored roster
values. Legacy per-level columns remain in the schema but are zeroed for boss rows, and
boss announcements do not display a level.

<!-- src: src/engine/bossSystem.js:1312 -->

```js
hp   = base_hp
atk  = base_atk
def  = base_def
crit = base_crit
```

Boss stats use the fixed roster values:

<!-- src: src/engine/statAssembly.js:386 -->

```js
hp   = base_hp
atk  = base_atk
def  = base_def
crit = base_crit
```

The 1-120 mob level clamp applies only to raid mobs, not to boss combat stats.

## How many times can I attack a boss per day

Two attacks per player per day, across **all** boss spawns. The limit resets at midnight
PHT (Asia/Manila, UTC+8).

<!-- src: src/config/bosses.js:20 -->

| Rule | Value |
|---|---|
| Attacks per player per day | 2 |
| Reset | Midnight PHT |
| Scope | Global across every active boss spawn |

Exceeding the limit replies: *"You already used all 2 boss attacks today — your attacks
reset at midnight PHT."*

Operators can raise the limit with the `BOSS_DAILY_ATTACK_LIMIT` environment variable; if
set, a startup warning is logged because boss EXP scales with participant level and the
override moves the whole progression curve.

## What gates does the Attack button enforce

<!-- src: src/engine/bossSystem.js:1586 -->

| Gate | Failure message |
|---|---|
| Official support server | Points you to the official server invite |
| Registered with a character | *"You need a character first — `crd register`, then `crd create character`."* |
| Not banned | *"You cannot attack the boss right now."* |
| Boss still active | *"There is no active boss right now — it has fallen."* |
| Daily attack limit | *"You already used all 2 boss attacks today…"* |
| No live battle in progress | *"⚔️ You are already in a battle — wait for it to finish."* |

If the boss dies between the gate check and your strike landing, the attack is refused
with *"The boss just fell before your strike landed!"* and your daily attack is **not**
consumed.

## How does the shared HP pool work

Every attacker fights their own instance of the boss, but only the **net damage** of that
fight is subtracted from the shared pool.

| Concept | Meaning |
|---|---|
| Local instance | Your personal fight against the boss's full stat block |
| Shared pool | `boss_state.current_hp`, reduced by `max(0, floor(netDamage))` per attack |
| Pool percentage | Passives that read "enemy HP below X%" read the **live shared pool**, not your local instance |
| Hydra regeneration | Heals the local instance only; the pool is reduced by net damage |

A fresh pool snapshot is taken at the start of each fight, so concurrent attackers see
the current pool state.

## What are Greater and Calamity bosses

Greater membership is **Jotun, Fafnir, and Cerberus**. Calamity membership is **Fenrir
and Bakunawa**. Natural selection is 70% normal, 25% Greater, and 5% Calamity.

<!-- src: src/config/bosses.js:25 -->

| Rule | Value |
|---|---|
| Normal spawn chance | 70% |
| Greater spawn chance | 25% |
| Calamity spawn chance | 5% |
| Selection within a pool | Uniform among the unused bosses in the current shuffled bag |
| Fallback | If the chosen pool is empty, the other pool is used |

A natural spawn first rolls its tier, preserving those probabilities. Within the selected
tier, each currently eligible boss is used once before that tier's bag repeats; a new bag
also avoids immediately repeating the previous boss when the pool has more than one entry.
The bag is reconstructed from distinct spawn IDs in the existing `boss_attack_log`, so it
survives process/container restarts without a new table, column, or migration. Queued dev
spawns and the current direct dev spawn are excluded from this history, while explicit
named developer spawns continue to bypass the automatic selector.

One limitation follows directly from the no-schema constraint: `boss_attack_log` does not
store `spawn_source`, and `boss_state` retains only the latest spawn. After a later spawn
overwrites that row, an old non-queued direct dev spawn is no longer distinguishable from
natural history. Queued dev/Calamity spawns remain identifiable by their existing queue row.

A Greater Boss then rolls one nested variant, once per spawn, which fixes both its HP
multiplier and the chest every attacker receives:

<!-- src: src/config/bosses.js:105 -->

| Variant | Roll | HP multiplier on base HP | Chest paid to every attacker |
|---|---|---|---|
| Twin Chest | 75% | ×1.5 | 2 × Boss Treasure Chest |
| Golden Chest | 25% | ×2 | 1 × Boss Golden Chest |

The multiplier applies to fixed base HP:

<!-- src: src/config/bosses.js:128 -->

```js
maxHp = max(1, floor(base_hp * hpMultiplier))
```

ATK, DEF and CRIT are never multiplied — only HP.

Natural and dev-spawned Calamities both award 1 Boss Golden Chest through the same
participation pipeline. Calamities have no HP multiplier and pay twice the Greater Golden
currency/EXP/Shard reward. Every eligible participant also receives 3 Greater Bags, while Supreme
Chest and Divine Bag are separate damage-share bonus rolls.

The Greater spawn announcement is prefixed:

```text
☠️ GREATER BOSS — A world-ender awakes…
```

## What rewards do I get for defeating a boss

Rewards are participation-based. Normal and Greater bosses reward every recorded attacker;
Calamity rewards participants with positive damage. Every eligible participant receives the
identical guaranteed bundle when the boss falls. Calamity then adds the two individual
damage-share bonus rolls described below; there is no ranked top-damage prize.

<!-- src: src/config/bosses.js:31 -->

| Boss variant | Credux | Combat EXP (base) | Belief Shards | Chest | Guaranteed bag |
|---|---|---|---|---|---|
| Normal boss | 100,000 | 20,000 | 1,000 | 1 × Boss Treasure Chest | 1 × Lesser Bag |
| Greater — Twin Chest | 150,000 | 30,000 | 1,500 | 2 × Boss Treasure Chest | 1 × Greater Bag |
| Greater — Golden Chest (2× HP) | 200,000 | 40,000 | 2,000 | 1 × Boss Golden Chest | 2 × Greater Bag |
| Calamity (natural or dev) | 400,000 | 80,000 | 4,000 | 1 × Boss Golden Chest | 3 × Greater Bag |

For each eligible Calamity participant, the existing Supreme Chest chance is their damage
divided by total eligible damage. Divine Bag uses that exact same unrounded chance in a
second independent `node:crypto` roll. A participant can therefore receive neither bonus,
either one, or both. The final result shows only bonus items that were actually granted.

Credux, Shards, chests and guaranteed bags are paid flat. **Combat EXP is scaled by each attacker's own
combat level**, never by the boss's level:

<!-- src: src/utils/awardCombatExp.js:86 -->

```js
finalExp = round(baseExp * max(1.0, (min(attackerLevel, 120) / 30) ** 2))
```

Worked EXP for a normal boss (20,000 base):

| Attacker combat level | Multiplier | Combat EXP received |
|---|---|---|
| 1–30 | 1.00 | 20,000 |
| 50 | 2.78 | 55,600 |
| 75 | 6.25 | 125,000 |
| 100 | 11.11 | 222,200 |

The defeat announcement reads:

```text
🎉 <Boss Name> has fallen! All 12 challengers receive:
100,000 Credux · 20,000 Combat EXP · 1× Boss Treasure Chest · 1× Lesser Bag · 1,000 Belief Shards.
```

Reward distribution and the status flip share one transaction, so payouts are
exactly-once even under concurrent triggers.

## What else does a boss defeat progress

| System | Effect |
|---|---|
| `boss_kills` | +1 for every attacker on the spawn |
| Boss feat titles | Granted at kill thresholds |
| Combat level | EXP applied; level-ups and their rewards granted in the same transaction |
| Leaderboards | Feeds the "Boss Defeats" and "Boss Top Hit" boards |
| `boss_top_damage` | Tracks your highest single boss hit |

Boss feat title thresholds:

<!-- src: src/config/titles.js:21 -->

| Boss kills | Title |
|---|---|
| 50 | Godslayer |
| 200 | World Ender |
| 400 | Deicide |
| 700 | Ragnarok Bringer |
| 1,000 | Eternal Vanquisher |

Kill counts are participation-based: attacking a boss that later dies counts as a kill for
you.

## What does the boss status card show

| Element | Content |
|---|---|
| Header | Boss name; no gameplay level is displayed |
| Greater banner | `☠️ GREATER BOSS` prefix when applicable |
| HP bar | Live shared pool HP against max HP |
| Damage board | Top 15 attackers by damage on this spawn |
| Footer (active) | *"The boss remains until defeated. ⚔️ 2 boss attacks per player per day."* |
| Footer (dead) | *"Rewards distributed to all N challengers."* |

The live message is edited in place as damage comes in rather than reposted.

## Does the player always attack first against a boss

Yes, with one exception. In boss mode the player always acts first, so no actor-order
roll is consumed. A monster carrying the `first_strike` special flag (such as Sleipnir)
is checked before that rule and still attacks first.

<!-- src: src/engine/battleEngine.js:13 -->

## Are executes and burst effects allowed against bosses

No. Bosses are protected from several player effects:

| Effect | Against a boss |
|---|---|
| Tyrfing — Cursed Edge execute | Immune |
| Knuckle Charm — Death Charm instant kill | Immune |
| Gusisnautar — Hemorrhaging Shot (both effects) | Blocked |
| Badiang Stalk — Rupture burst | Blocked |
| Badiang Stalk — Venom | **Not** blocked, still applies |
| Sudden death drain (round 30+) | Bosses are exempt; only player sides drain |
