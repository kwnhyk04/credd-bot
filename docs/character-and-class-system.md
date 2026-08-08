# Character & Class System

Credd is a mythology-themed Discord RPG. Every player creates one character with a
single class, and that class decides the character's base HP, ATK, DEF and CRIT plus a
unique combat passive. This document covers registration, character creation, the five
classes, starter gear, how battle stats are assembled, and the avatar/profile commands.

The bot's default prefix is `crd`. Server admins can add a custom prefix, but `crd`
always works.

## How do I start playing Credd

Two steps, in order. `crd register` creates the account; `crd create character` creates
the character that actually fights.

| Step | Command | Alias | Slash | What it does |
|---|---|---|---|---|
| 1 | `crd register` | `crd reg` | `/register` | Creates your account rows (user, bag, pity counter). Grants nothing. |
| 2 | `crd create character` | `crd cc` | `/create character` | Class picker, then confirms and creates your character. |

`crd register` shows a welcome card with the world's backstory and an **I Understand**
button. Pressing the button inserts the account. If you are already registered the
command replies that you are registered and points you to `crd create character`.

<!-- src: src/commands/rpg/register.js:121 -->
Registration creates `users_bag` at all-zero defaults. The starter grant happens at
character creation, not at registration.

Example:

```text
crd register
```

## What do I get when I create a character

Character creation grants a fixed starter package once. It is granted at creation only,
never at registration.

<!-- src: src/config/starter.js:12 -->

| Grant | Amount |
|---|---|
| Belief Shards | 1,000 |
| Silver Chests | 10 |
| Initiate's Blade (weapon, equipped) | 1 |
| Initiate's Garb (armor, equipped) | 1 |

Starter gear stats:

| Item | Type | ATK | CRIT | HP | DEF |
|---|---|---|---|---|---|
| Initiate's Blade | Weapon | 15 | 1.0% | — | — |
| Initiate's Garb | Armor | — | — | 40 | 10 |

1,000 Belief Shards is exactly 10 gacha pulls, and 10 Silver Chests is 10 gear drops, so
a new character can immediately use `crd summon 10` and `crd open sc 10`.

Example:

```text
crd create character
```

The command opens a Components V2 class picker with one button per class. Selecting a
class shows a portrait card with that class's flavor text and passive, then **Confirm**
or **Go Back**.

## What are the five classes in Credd

Credd has exactly five classes: Swordsman, Fighter, Mage, Knight and Archer. Class is
chosen at character creation and can only be changed afterwards with a Character Class
Change item (`crd use cc`).

<!-- src: src/config/classes.js:19 -->

| Class | Emoji | Passive | Identity |
|---|---|---|---|
| Swordsman | ⚔️ | Bleed | Balanced offense and defense, damage over time |
| Fighter | 👊 | Stun | Aggressive, high ATK and HP, low DEF |
| Mage | 🔮 | Overcharge | Highest ATK growth, lowest survivability |
| Knight | 🛡️ | Damage Reduction | Highest HP and DEF, no CRIT growth |
| Archer | 🏹 | Armor Pierce & Double Attack | Fast, high CRIT, ignores armor |

## What are the class base stats and per-level scaling

Class stats are hardcoded constants, not database columns. HP, ATK, DEF and CRIT are
computed at runtime from class plus combat level, so a balance change applies to every
existing player with no migration.

<!-- src: src/config/classes.js:37 -->

| Class | Base HP | Base ATK | Base DEF | Base CRIT | HP/level | ATK/level | DEF/level | CRIT/level |
|---|---|---|---|---|---|---|---|---|
| Swordsman | 700 | 225 | 225 | 5.0% | +150 | +75 | +75 | +0.7 |
| Fighter | 850 | 300 | 150 | 1.0% | +150 | +100 | +50 | +0.5 |
| Mage | 600 | 350 | 100 | 1.0% | +100 | +150 | +50 | +0.5 |
| Knight | 1000 | 200 | 300 | 5.0% | +200 | +70 | +100 | +0.0 |
| Archer | 600 | 300 | 150 | 5.0% | +125 | +125 | +50 | +0.7 |

The formula is base plus scaling multiplied by `level - 1`, floored on HP/ATK/DEF. CRIT
is not floored and is not capped.

<!-- src: src/engine/statAssembly.js:119 -->

```js
steps = max(1, level) - 1
hp   = floor(base.hp  + scaling.hp  * steps)
atk  = floor(base.atk + scaling.atk * steps)
def  = floor(base.def + scaling.def * steps)
crit = base.crit + scaling.crit * steps
```

Worked values from that formula:

| Class | L1 HP/ATK/DEF/CRIT | L50 HP/ATK/DEF/CRIT | L100 HP/ATK/DEF/CRIT |
|---|---|---|---|
| Swordsman | 700 / 225 / 225 / 5.0% | 8,050 / 3,900 / 3,900 / 39.3% | 15,550 / 7,650 / 7,650 / 74.3% |
| Fighter | 850 / 300 / 150 / 1.0% | 8,200 / 5,200 / 2,600 / 25.5% | 15,700 / 10,200 / 5,100 / 50.5% |
| Mage | 600 / 350 / 100 / 1.0% | 5,500 / 7,700 / 2,550 / 25.5% | 10,500 / 15,200 / 5,050 / 50.5% |
| Knight | 1,000 / 200 / 300 / 5.0% | 10,800 / 3,630 / 5,200 / 5.0% | 20,800 / 7,130 / 10,200 / 5.0% |
| Archer | 600 / 300 / 150 / 5.0% | 6,725 / 6,425 / 2,600 / 39.3% | 12,975 / 12,675 / 5,100 / 74.3% |

Knight has zero CRIT growth by design and stays at a flat 5.0% class CRIT at every
level. Player CRIT has no ceiling — the old 40% class / 45% total CRIT caps were removed.

## What does each class passive do in battle

Class passives fire automatically during combat. Their numeric values are shared
constants used by both the class card and the battle engine.

<!-- src: src/config/classes.js:21 -->

| Class | Passive | Exact effect |
|---|---|---|
| Swordsman | Bleed + Battle Rhythm | Each attack inflicts 4% Bleed, stacking up to 20% (5 stacks), and effective ATK increases by 5% each turn up to 25% for the battle. |
| Fighter | Stun | 25% chance to Stun the target for 1 turn. Bash deals 100% of the triggering hit and leaves the target Dizzy. |
| Mage | Overcharge | On every 3rd round the primary attack is multiplied by 2.75, cannot crit, and applies exactly one random 25% debuff: Paralyze, Burn, DEF Down, or ATK Down. |
| Knight | Damage Reduction | Incoming damage reduced by 25%; outgoing damage increased by 30%; restores 10% of maximum HP each turn. |
| Archer | Armor Pierce & Double Attack | Attacks ignore 25% of target DEF and have a 25% chance to immediately perform an extra attack. |

<!-- src: src/engine/battleEngine.js:128 -->
Knight's damage reduction is 25% and its outgoing bonus is 30%. Mage's Overcharge
multiplier is 2.75 and fires on rounds 3, 6, 9 and so on.

<!-- src: src/config/combat.js:26 -->

## How are my final battle stats calculated

Battle stats combine class, weapon, armor, deity slots, socketed runes, and pantheon
resonance. Each source contributes to specific stats only.

<!-- src: src/engine/statAssembly.js:142 -->

```js
baseAtk = classAtk + weapon.curr_atk
baseHp  = classHp  + armor.curr_hp
baseDef = classDef + armor.curr_def

atk  = floor(baseAtk * (1 + (runeAtkPct + resonanceAtkPct) / 100) + deityAtk)
hp   = floor(baseHp  * (1 + (runeHpPct  + resonanceHpPct)  / 100) + deityHp)
def  = floor(baseDef * (1 + (runeDefPct + resonanceDefPct) / 100) + deityDef)
crit = classCrit + weaponCrit + runeCritPoints + resonanceCritPoints
```

Which source feeds which stat:

| Stat | Class | Weapon | Armor | Deity | Runes | Resonance |
|---|---|---|---|---|---|---|
| HP | Yes | No | Yes | Yes (flat) | % multiplier | % multiplier |
| ATK | Yes | Yes | No | Yes (flat) | % multiplier | % multiplier |
| DEF | Yes | No | Yes | Yes (flat) | % multiplier | % multiplier |
| CRIT | Yes | Yes | No | No | flat points | flat points |

Weapons carry ATK and CRIT only. Armor carries HP and DEF only. Deities never grant
CRIT. Deity slot 1 contributes 100% of its stats; slots 2 and 3 contribute 50% each,
floored.

Weapon and deity enhancement never scale CRIT. An empty slot contributes zero, never an
error.

## How do I change my class after creation

Class change requires a **Character Class Change** item, bought from the CRD Shop for
5,000,000 Credux (`crd shop buy 1`) and used with `crd use cc`.

| Command | Syntax | Cost |
|---|---|---|
| Buy the item | `crd shop buy 1 [qty]` | 5,000,000 Credux each, no purchase limit |
| Use the item | `crd use cc` | 1 Character Class Change item |

The flow is class select, then preview with a warning, then Confirm or Cancel. The item
is consumed only inside the confirm transaction — cancel, timeout, picking your current
class, or any failure consumes nothing.

<!-- src: src/commands/rpg/changeClass.js:14 -->

What a class change does and does not touch:

| Area | Result |
|---|---|
| Levels, EXP, Credux, items, chests, gear | Preserved — only `user_character.class` changes |
| Purchased avatars of the old class (token cost > 0) | Refunded at the current shop token price, ownership removed, unequipped |
| Founder/tester avatars (grant-only) | No refund; ownership and equip remap to the new class row of the same style |
| Battle skins | The old class default battle skin is replaced by the new class default |
| Other equipped skins | Untouched |

Example:

```text
crd use cc
```

## How do I view my profile and combat stats

Two separate cards. `crd profile` is the identity and believer-progress card;
`crd stats` is the combat card.

| Command | Aliases | Slash | Arguments | Shows |
|---|---|---|---|---|
| `crd profile [@user]` | `crd p` | `/profile [user]` | Optional user mention | Identity, title, believer level and progress |
| `crd stats [@user]` | — | `/stats` | Optional user mention (prefix only) | Combat stats, gear, equipped deities, blessings |

`crd stats` labels its two combat channels **Primary Blessing** and **Secondary
Blessing**. A blessing is active and visible only when its deity is Ascended; otherwise
the card reads `Deity not ascended` or `Locked`. An Echo-type deity equipped in slot 1
still supplies the Primary channel.

Both cards carry the same six-cell **Character Records** row:

<!-- src: src/engine/characterRecords.js:9 -->

| Cell | Meaning |
|---|---|
| BEST RAID STK | All-time highest raid win streak (persisted; never decreases) |
| RAID STREAK | Current raid win streak |
| RANK | PvP bracket name |
| RANK # | Current PvP rating |
| BEST RANK STK | All-time highest ranked-duel win streak (persisted; never decreases) |
| WIN RATE | Ranked duel win percentage, rounded; `-` if you have fought no ranked duels |

The two "BEST" values are recomputed to `GREATEST(current, new streak)` after every raid
or ranked win, so they can only go up.

Examples:

```text
crd profile
crd profile @Friend
crd stats
```

## How do character presets work

<!-- src: src/engine/loadout.js:1 -->

Every character has **two presets** — independent loadouts of weapon, armor, and all
three deity slots plus Echo. Only one preset is active at a time; every equip command
(`crd equip`, `crd deity equip`, `crd deity unequip`, `crd deity echo`) writes to
whichever preset is currently active.

| Command | Aliases | Syntax | Shows/Does |
|---|---|---|---|
| `crd preset` | — | `crd preset` | Your preset count and the currently active slot number |
| `crd equip preset <1\|2>` | — | `crd equip preset 1` | Switches the active preset |

Both are prefix-only (no slash equivalent).

Character creation seeds **Preset 1** ("Main") with your starter weapon and armor, and
leaves **Preset 2** empty. Switching to an empty preset equips nothing — the reply says so
explicitly. Switching to a preset that already has gear/deities equips all of it at once.

Selling a weapon, armor, or deity referenced by **either** preset (not just the active
one) warns you before the sale which preset slot will lose that item:

```text
⚠️ Sell Berserker's Axe for 12,000 Credux? This will permanently delete it and cannot
be undone. Locked and equipped gear is excluded. Warning: Preset 2 will lose its
weapon slot.
```

## How do avatars work

Avatars are the character portrait shown on the stats card. They are cosmetic only and
are bought with supporter tokens, never with Credux.

| Command | Syntax | Description |
|---|---|---|
| Browse owned | `crd avatars` | Owned avatars for your current class |
| Browse shop | `crd avatar shop` | Buyable avatars for your current class |
| Buy | `crd avatar buy <id>` | Spends supporter tokens |
| Equip | `crd avatar equip <id>` | Equips an owned avatar |
| Reset | `crd avatar default` | Returns to the default class avatar |

Slash equivalents: `/avatars`, `/avatar shop`, `/avatar buy id:`, `/avatar equip id:`,
`/avatar default`.

Avatar styles and their supporter-token prices:

<!-- src: src/engine/avatarSystem.js:22 -->

| Style | Token cost |
|---|---|
| Cyber | 9 |
| Anime | 12 |
| Webtoon | 15 |
| Genesis | 15 |

Avatars are class-locked: an avatar for another class cannot be bought or equipped.
Founder and tester avatar styles are grant-only and never appear in the shop. Every
class also has a free default avatar that requires no purchase.

The shop shows one avatar per page with Preview and Buy buttons, plus a **Custom Avatar
Token** purchase option:

<!-- src: src/engine/avatarSystem.js:14 -->

| Item | Price | Buy | Redeem |
|---|---|---|---|
| Custom Avatar Token | 20 supporter tokens | `crd avatar buy at` | `crd use at` |

Redeeming the token creates a work-order ticket for a custom-commissioned avatar; the
reply includes the ticket id and the item is consumed on redemption regardless of queue
processing time.

Example:

```text
crd avatar shop
crd avatar buy a1
crd avatar equip a1
crd avatar buy at
crd use at
```

## Which commands require a character

`crd register` only needs an account. Most gameplay commands require a character; a few
economy and reference commands do not.

<!-- src: src/handlers/commandHandler.js:125 -->

| Requires a character | Account only (no character needed) |
|---|---|
| profile, stats, preset, raid, auto, duel, ranked, title, summon, bag, open, equip, enhance, lock, unlock, sell, deity, deities, equipment, essence, exchange, pvp, socket, unsocket, rune, runes, avatars, avatar, compare | register, create, leaderboards, boss, cred, bestow, daily, quests, help, admin, shop, skin, buy, use, set, glossary, and all casino games |

Attempting a character-gated command without one replies:
*"You don't have a character yet. Use `crd create character` to get started."*
