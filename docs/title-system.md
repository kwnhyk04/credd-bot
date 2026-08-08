# Title & Achievement System

Titles are Credd's achievement system. They are earned automatically by reaching Believer
levels, defeating bosses, completing collections, finishing PvP seasons, or from events,
and one can be equipped to display on your profile card. This document lists every title
source, its unlock condition, and the title commands.

Titles are display-only — they never affect combat, stats or rewards.

## How do I browse and equip titles

<!-- src: src/commands/rpg/title.js:115 -->

| Command | Alias | Slash | Description |
|---|---|---|---|
| `crd title` | `crd t` | Not available | Browse titles by category |
| `crd title equip <name>` | `crd t equip <name>` | Not available | Equip a title you own |
| `crd title unequip` | `crd t unequip` | Not available | Remove your equipped title |

Examples:

```text
crd title
crd title equip Zealot
crd title equip believer_zealot
crd title unequip
```

Equipping accepts either the display name or the internal code, case-insensitively. You
can only equip a title you own: *"You don't own a title called **<name>**."*

## What does the title browser show

The browser has a category dropdown in the header and pages ten titles at a time with
Previous / Next buttons.

| Marker | Meaning |
|---|---|
| ⭐ | Currently equipped |
| ✅ | Owned |
| 🔒 | Not yet earned |

Locked titles still show their unlock hint, so the browser doubles as an achievement list.

## What title categories exist

<!-- src: src/config/titles.js:50 -->

| Category | Source | Earned by |
|---|---|---|
| Believer | `believer` | Reaching Believer Levels |
| Season | `rank_season` | Finishing a PvP season in a bracket |
| Boss Feats | `boss_feat` | Boss participation kills |
| Collection | `collection` | Completing deity collections |
| Event | `event` | Event grants |

## What are the Believer titles

Granted automatically as your Believer Level rises. Every title at or below your level is
owned, so you can re-equip an earlier one at any time.

<!-- src: src/config/titles.js:10 -->

| Believer Level | Title |
|---|---|
| 1 | Wanderer |
| 10 | Devotee |
| 25 | Disciple |
| 50 | Zealot |
| 100 | Champion of Faith |
| 200 | Chosen One |
| 500 | Last Believer |

Believer Level is earned at 3 reputation EXP per command and 10 per summon pull, capped
at 1,500 per PHT day, with 3,000 EXP per level.

## What are the Boss Feat titles

Granted by cumulative boss participation kills. A kill counts if you attacked a boss that
later fell, so every participant on a successful spawn is credited.

<!-- src: src/config/titles.js:21 -->

| Boss kills | Title |
|---|---|
| 50 | Godslayer |
| 200 | World Ender |
| 400 | Deicide |
| 700 | Ragnarok Bringer |
| 1,000 | Eternal Vanquisher |

With the 2-attacks-per-day boss limit, 1,000 kills is a long-horizon achievement.

## What are the Collection titles

Granted when you own every **available** deity in a mythology, or in the whole game. The
check runs after any summon batch that contained at least one new deity.

<!-- src: src/config/titles.js:30 -->

| Achievement | Title code |
|---|---|
| Every available Philippine deity | `coll_ph_keeper` |
| Every available Norse deity | `coll_norse_keeper` |
| Every available Greek deity | `coll_greek_keeper` |
| Every available deity in the game | `coll_pantheon_keeper` (Pantheon Keeper) |

Deities marked unavailable in the roster are excluded from the count, so a retired deity
never blocks a collection title.

## What are the Season titles

Granted at the end of a PvP season, based on the **peak** bracket you reached during that
season.

<!-- src: src/config/titles.js:40 -->

| Peak bracket | Title granted |
|---|---|
| Celestial | An exclusive rotating title from a six-title cycle |
| Divine, Ascendant, Demigod, Champion, Mortal | A generic per-season title, e.g. `Season 3 — Demigod` |

The Celestial rotation, cycling by season number and wrapping:

| Position | Title |
|---|---|
| 1 | Embercrowned |
| 2 | Fimbulwinter |
| 3 | Tempest of Amihan |
| 4 | Asphodel |
| 5 | Hand of Sidapa |
| 6 | Last Dawn |

Season 7 returns to Embercrowned, season 8 to Fimbulwinter, and so on.

## Are titles ever lost

No. Title grants are permanent and idempotent — the same title is never granted twice,
and no system removes a title once earned. The soft ranked reset at season end lowers
your rating but does not revoke season titles.

Unequipping a title only clears the display slot; you keep ownership.

## Do titles affect gameplay

No. Titles are cosmetic display only. They appear on the profile card and nowhere else,
and they grant no stats, no currency and no combat effect.

## Where is my equipped title shown

| Surface | Shows the title |
|---|---|
| `crd profile` | Yes — under your name |
| `crd stats` | No |
| `crd title` | Yes — marked ⭐ in the list |

Some titles have optional PNG art in the catalog; the title browser is text-only, so
adding art later does not change the browser.

## Are there other achievement systems in Credd

Titles are the only achievement system. Separate progress counters exist and feed the
leaderboards, but they are not achievements in their own right:

| Counter | Leaderboard |
|---|---|
| `boss_kills` | Boss Defeats — also drives Boss Feat titles |
| `boss_top_damage` | Boss Top Hit |
| `raids_won`, `raids_lost` | Raid Wins, Raids Done |
| `pvp_wins` | Duel Wins |
| `pvp_peak` | Determines season-end title bracket |
| `lifetime_credux_earned` | Lifetime Credux |
