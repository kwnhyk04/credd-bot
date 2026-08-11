# Shop System

Credd has four separate shops, each spending a different currency. The **CRD Shop**
spends Credux, the **Essence Shop** spends essence plus Credux, the **PvP Shop** spends
Valor Medals, and the **Supporter Shop** spends supporter tokens on cosmetics. This
document lists every product, price and purchase limit.

Every purchase is atomic — if anything fails, nothing is spent.

## What shops exist and what do they cost

| Shop | Command | Currency | Limits reset on |
|---|---|---|---|
| CRD Shop | `crd shop` | Credux | PHT daily / weekly / monthly |
| Essence Shop | `crd essence shop` | Essence + Credux | No limits |
| PvP Shop | `crd pvp shop` | Valor Medals | PvP season change |
| Supporter Shop | `crd shop supporter` | Supporter tokens | No limits |
| Avatar Shop | `crd avatar shop` | Supporter tokens | No limits |

## What can I buy in the CRD Shop

The CRD Shop is the main Credux sink outside enhancement.

<!-- src: src/config/crdShop.js:20 -->

| ID | Item | Price (Credux) | Limit |
|---|---|---|---|
| 1 | Character Class Change | 5,000,000 | No limit |
| 2 | Lesser Bag | 1,000,000 | 10 per month |
| 3 | Greater Bag | 2,000,000 | 5 per month |
| 4 | Divine Bag | 5,000,000 | 3 per month |
| 5 | Silver Chest | 5,000 | 10 per day |
| 6 | Gold Chest | 50,000 | 5 per day |
| 7 | Diamond Chest | 500,000 | 1 per week |

| Command | Syntax |
|---|---|
| Browse | `crd shop` |
| Buy | `crd shop buy <id> [qty]` |

Examples:

```text
crd shop
crd shop buy 5 10
crd shop buy 1
```

The shop card groups products under **Unlimited**, **Monthly**, **Daily**, and **Weekly**.
Unlimited has no reset; each limited category shows one relative reset countdown in its
heading, while each limited item shows its purchased quantity against its cap. Limits
count **total quantity**, not the number of commands, and are stored in the database
rather than in memory.

## When do CRD Shop limits reset

<!-- src: src/config/crdShop.js:39 -->

| Period | Resets |
|---|---|
| Daily | Midnight PHT |
| Weekly | Monday 00:00 PHT |
| Monthly | 1st of the month, 00:00 PHT |

Rejection when a cap is hit:

```text
🚫 monthly limit for Divine Bag is 3 — you've bought 3, can buy 0 more. Resets in 12 days.
```

Invalid input is rejected before any database work: non-numeric IDs, unknown IDs, and
quantities below 1.

## What can I buy in the Essence Shop

The Essence Shop turns duplicate-deity essence into rune bags. It has no purchase limits.

<!-- src: src/config/runes.js:87 -->

| ID | Letter | Item | Essence cost | Credux cost |
|---|---|---|---|---|
| 1 | `lb` | Lesser Rune Bag | 10 Mythic Essence | 50,000 |
| 2 | `gb` | Greater Rune Bag | 10 Legendary Essence | 125,000 |
| 3 | `db` | Divine Rune Bag | 10 Supreme Essence | 250,000 |

| Command | Alias | Syntax |
|---|---|---|
| Browse | `crd es` | `crd essence shop` |
| Buy | `crd ex` | `crd exchange <lb\|gb\|db\|1\|2\|3> [qty]` |

Examples:

```text
crd essence shop
crd exchange gb 2
crd exchange 1 5
```

If you cannot afford the full quantity, the reply states how many you *can* afford across
both the essence and Credux constraints, and nothing is spent.

## How do I convert essence between tiers

`crd exchange essence` is a separate continuous flow, not a shop row.

<!-- src: src/config/runes.js:101 -->

| Target | Costs | Credux |
|---|---|---|
| Mythic Essence | 10 Epic Essence | 50,000 |
| Legendary Essence | 10 Mythic Essence | 125,000 |
| Supreme Essence | 10 Legendary Essence | 250,000 |

Conversion is one-way. A tier dropdown picks the target, and a Convert button resolves
one conversion at a time and re-renders in place.

```text
crd exchange essence
```

## What can I buy in the PvP Shop

The PvP Shop is the only Valor Medal sink. Caps are per PvP season.

<!-- src: src/commands/rpg/pvpShop.js:27 -->

| ID | Item | Price (Valor) | Season cap |
|---|---|---|---|
| 1 | Sacred Relic | 800 | 10 |
| 2 | Supreme Chest | 6,000 | 1 |
| 3 | Supreme Relic | 15,000 | 1 |

| Command | Alias | Syntax |
|---|---|---|
| Browse | `crd ps` | `crd pvp shop` |
| Buy | — | `crd pvp buy <id> [qty]` |

Examples:

```text
crd pvp shop
crd pvp buy 1 10
```

The shop is closed entirely when no PvP season is active:

```text
No active PvP season. The shop opens when a season is manually started.
```

Caps reset when a new season starts, not on a calendar clock.

## What is the Supporter Shop

The Supporter Shop sells cosmetic skins for supporter tokens. It is cosmetic-only and
grants no gameplay advantage.

<!-- src: src/commands/rpg/shop.js:20 -->

| Command | Syntax | Who can use it |
|---|---|---|
| Browse | `crd shop supporter` | Active supporters only |
| Buy | `crd buy <skin_code>` | Active supporters only |
| Equip | `crd use skin <skin_code>` | Anyone who owns the skin |
| Browse art | `crd skin collection` | Everyone |

Examples:

```text
crd shop supporter
crd buy p1
crd use skin p1
crd skin collection
```

Plain `crd shop` opens the **CRD Shop**, not the Supporter Shop — the supporter shop
requires the explicit `supporter` argument.

Non-supporters see:

```text
🛒 The Supporter Shop is for active supporters. Subscribe (Believer / Chosen) or become a
Founder (Eternal) to unlock cosmetic skins + a monthly token stipend. Cosmetic only — no
gameplay advantage. Browse art anytime with `crd skin collection`.
```

Full supporter tier, token and skin details are in the Cosmetic System document.

## What is the Avatar Shop

The Avatar Shop sells character portraits for the stats card, also with supporter tokens.

<!-- src: src/engine/avatarSystem.js:22 -->

| Style | Token cost |
|---|---|
| Cyber | 9 |
| Anime | 12 |
| Webtoon | 15 |
| Genesis | 15 |

| Command | Syntax |
|---|---|
| Browse | `crd avatar shop` |
| Buy | `crd avatar buy <id>` |
| Equip | `crd avatar equip <id>` |
| Reset | `crd avatar default` |

Avatars are class-locked — you can only buy and equip avatars for your current class.

## How are shop purchases protected against races

Every shop uses the same pattern: lock the bag row, lock the purchase-tracking row, check
the cap and the balance, then apply a cap-guarded upsert before deducting and granting —
all in one transaction.

| Guarantee | Effect |
|---|---|
| Cap-guarded upsert | Two concurrent buys cannot slip past a cap |
| Single deduct-and-grant statement | You are never charged without receiving the item |
| Rollback on any failure | *"Purchase failed — nothing was spent."* |

## Which shops require a character

| Shop | Requires a character |
|---|---|
| CRD Shop | No |
| Essence Shop | Yes |
| PvP Shop | Yes |
| Supporter Shop | No |
| Avatar Shop | Yes |

Supporter status is independent of having a character, which is why the cosmetic shops
are open to accounts without one.
