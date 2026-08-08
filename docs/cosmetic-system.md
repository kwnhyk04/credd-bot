# Cosmetic & Supporter System

Cosmetics in Credd are skins and avatars that change how your cards look. They are bought
with **supporter tokens**, a currency entirely separate from Credux, and they grant no
gameplay advantage of any kind. This document covers supporter tiers, token stipends, the
four skin categories, skin codes, and every cosmetic command.

Nothing in this system affects stats, combat, drops or rewards.

## What are the supporter tiers

<!-- src: src/config/cosmetics.js:43 -->

| Tier | Rank | Monthly token stipend | Skin price at tier default |
|---|---|---|---|
| Base | 0 | — | Free (granted to supporters) |
| Believer | 1 | 10 tokens per month | 2 tokens |
| Chosen Believer | 2 | 20 tokens per month | 3 tokens |
| Eternal Believer (Founder) | 3 | **60 tokens, one time** | 4 tokens |

<!-- src: src/config/cosmetics.js:62 -->

Eternal is a one-time Founder grant rather than a recurring stipend. Founder numbers are
limited to 50. Subscribing at Eternal also grants **1 free Custom Deity Token** in the
same transaction (see below).

A supporter can buy and equip skins of their own tier and below. Attempting a higher tier
replies: *"**<skin>** is a higher-tier skin than your supporter tier allows."*

## What are supporter tokens

| Property | Value |
|---|---|
| Earned from | Supporter subscription stipends and Founder grants |
| Spent on | Shop skins, avatars, and Custom Avatar Tokens |
| Relation to Credux | None — the two currencies never convert |
| Refunds | Purchased avatars of your old class are refunded on a class change |

Token balances can never go negative; a purchase that cannot be afforded is rejected with
the price and your balance.

## What are Custom Avatar and Custom Deity Tokens

<!-- src: src/config/crdBagItems.js:16 -->

Separate from skins and avatars, these are **consumable bag items** that redeem into a
work-order ticket for a hand-made avatar or deity commission. They live in the bag, not
the supporter shop's owned-item list.

| Token | How to get it | Price | Redeem |
|---|---|---|---|
| Custom Avatar Token (`at`) | Bought with supporter tokens | 20 supporter tokens (`crd avatar buy at`) | `crd use at` |
| Custom Deity Token (`dt`) | Granted once per Eternal subscription | Not purchasable | `crd use dt` |

Redeeming either token creates a ticket and replies with its ticket id; the team
processes tickets from an internal queue. `crd bag items` only lists a token if your
balance is above zero.

## What skin categories exist

<!-- src: src/config/cosmetics.js:28 -->

| Category | Code letter | What it changes |
|---|---|---|
| Profile | `p` | The `crd profile` and `crd stats` card background |
| Battle | `b` | The battle card background |
| Battle Result | `r` | The victory and defeat result cards |
| Summon | `s` | The summon reveal presentation |

One skin can be equipped per category at a time, so a full set is four skins.

## How do skin codes work

Every shop skin has a short code made of its category letter plus an increment, for
example `p1`, `b3`, `r2`, `s4`. The code is what you type to buy or equip.

<!-- src: src/config/cosmetics.js:234 -->

| Code prefix | Category |
|---|---|
| `p1`, `p2`, … | Profile |
| `b1`, `b2`, … | Battle |
| `r1`, `r2`, … | Battle Result |
| `s1`, `s2`, … | Summon |

Because the category is implied by the letter, no category argument is ever needed.

## How do I buy and equip skins

<!-- src: src/commands/rpg/buy.js:23 -->

| Command | Syntax | Who can use it |
|---|---|---|
| Browse the shop | `crd shop supporter` | Active supporters |
| Browse all art | `crd skin collection` | Everyone |
| Buy | `crd buy <skin_code>` | Active supporters |
| Equip by code | `crd use skin <skin_code>` | Owners |
| Equip by name or code | `crd equip skin <name\|code>` | Owners |
| Reset one category to default | `crd use skin default` | Everyone |
| Reset all categories to default | `crd set all skin default` | Everyone |

Examples:

```text
crd shop supporter
crd skin collection
crd buy p1
crd use skin p1
crd equip skin Divine Radiance
crd set all skin default
```

`crd skin collection` is open to everyone, so non-supporters can browse the art without
buying anything.

## What do skins cost

Tier defaults apply unless a skin has a price override.

<!-- src: src/config/cosmetics.js:43 -->

| Tier | Default token cost |
|---|---|
| Believer | 2 |
| Chosen | 3 |
| Eternal | 4 |

<!-- src: src/config/cosmetics.js:48 -->

Premium mythology and Eternal store skins are repriced to **6 tokens**:

| Category | Skins priced at 6 |
|---|---|
| Profile | Greek Profile, PH Profile, Norse Profile, Aurora Constellation, Eternal Flame |
| Battle | Greek Battle, PH Battle, Norse Battle, Astral Duel, Celestial Clash, Eternal Arena |
| Battle Result | Altar of Light, Aurora Sovereign, Celestial Triumph, Eternal Flame |
| Summon | Aurora Ribbon, Eternal Supernova, Stardust Constellation |

Budget Chosen skins — Divine Radiance, Laurel Runes Blue, Laurel Crown and Rune Glow —
stay at their tier price of 3.

## What is the base skin set

Every active supporter is granted a free base skin for each of the four categories. Base
skins cost 0 tokens and cannot be bought:

<!-- src: src/config/cosmetics.js:104 -->

| Category | Base skin |
|---|---|
| Profile | Base Profile |
| Battle | Base Battle |
| Battle Result | Base Victory / Base Defeated |
| Summon | Ember Spark Flip |

Attempting `crd buy` on a base skin replies *"Base skins are granted free to supporters —
nothing to buy."*

## What happens if I equip nothing

An account with nothing equipped renders the shared default template, which is not a skin
at all. Resetting always returns you to that default:

<!-- src: src/commands/rpg/set.js:4 -->

```text
🧹 Reset 3 skin slots to default. Re-equip anytime with `crd equip skin <name>`.
```

The render pipeline falls back in this order: your equipped skin → the base set for
active supporters → the default template art.

## How do avatars differ from skins

Avatars are the character portrait on the stats card. They use the same supporter tokens
but a separate command family and are locked to your current class.

<!-- src: src/engine/avatarSystem.js:22 -->

| Style | Token cost | Availability |
|---|---|---|
| Default | Free | Every class |
| Cyber | 9 | Shop |
| Anime | 12 | Shop |
| Webtoon | 15 | Shop |
| Genesis | 15 | Shop |
| Founder | — | Grant only |
| Tester | — | Grant only |

| Command | Syntax |
|---|---|
| Browse owned | `crd avatars` |
| Browse shop | `crd avatar shop` |
| Buy | `crd avatar buy <id>` |
| Equip | `crd avatar equip <id>` |
| Reset | `crd avatar default` |

Slash equivalents: `/avatars`, `/avatar shop`, `/avatar buy id:`, `/avatar equip id:`,
`/avatar default`.

Avatars come in male and female variants for the shop styles; Founder and tester avatars
are genderless grant-only rows.

## What happens to my cosmetics if I change class

<!-- src: src/commands/rpg/changeClass.js:20 -->

| Cosmetic | On class change |
|---|---|
| Purchased avatars of the old class | Refunded at the current shop token price, ownership removed, unequipped |
| Founder and tester avatars | No refund — ownership and equip remap to the new class row of the same style |
| The old class default battle skin | Replaced by the new class default, including the equip if it was equipped |
| All other equipped skins | Untouched |

## Do supporter perks affect gameplay

No. The system is cosmetic-only by design: nothing in it grants Credux, items, stats or
any combat advantage. The shop copy states this explicitly:

> Cosmetic only — no gameplay advantage.

## What is the supporter badge

Active supporters get a small badge drawn below their title on the profile and stats
cards.

<!-- src: src/config/cosmetics.js:69 -->

| Tier | Badge art |
|---|---|
| Believer | Believer badge |
| Chosen | Chosen badge |
| Eternal | Founder badge |

The Founder label itself is derived exclusively from a real founder number and is never
granted by developer access.

## What resolution are cosmetic frames rendered at

Every resolved cosmetic frame is normalised to a locked size so source art drift cannot
break the layout.

<!-- src: src/config/cosmetics.js:87 -->

| Property | Value |
|---|---|
| Locked frame width | 1,536 px |
| Locked frame height | 1,024 px |
| Supporter badge height | 96 px (width scales proportionally) |
