# Inventory & Chest System

Your bag holds every currency, chest, relic, rune bag and usable item in Credd, and the
gear you own lives alongside it. This document covers the bag views, every chest and its
drop table, the open commands, usable CRD Bag items, locking, comparing, and selling.

Gear stats themselves are covered in the Weapon System and Armor System documents.

## How do I view my bag

<!-- src: src/commands/rpg/bag.js:347 -->

| Command | Alias | Slash | Shows |
|---|---|---|---|
| `crd bag` | `crd b` | `/bag` | Overview of everything |
| `crd bag chests` | `crd bc` | `/bag section:chests` | Chests and relics, with Open buttons |
| `crd bag items` | — | Not available | Usable CRD Bag items |
| `crd bag weapons` | `crd bw` | `/bag section:weapons` | Owned weapons, paginated |
| `crd bag armors` | `crd ba` | Not available | Owned armor, paginated |

Examples:

```text
crd bag
crd bag chests
crd bag weapons
```

Weapon and armor pages wrap around: Previous on the first page lands on the last.

## What does my bag hold

<!-- src: scripts/production-consolidated-schema.sql:543 -->

| Category | Items |
|---|---|
| Currencies | Credux, Belief Shards, Valor Medals |
| Relics | Sacred Relic, Supreme Relic |
| Chests | Silver, Gold, Boss Treasure, Boss Golden, Supreme, Diamond, Genesis |
| Essence | Epic, Mythic, Legendary, Supreme |
| Rune bags | Lesser, Greater, Divine |
| Usable items | Character Class Change, Custom Avatar Token, Custom Deity Token |

`lifetime_credux_earned` is tracked separately and feeds the Lifetime Credux leaderboard.

## What chests exist and what do they drop

Every chest rolls a tier, then rolls whether that drop is a weapon or an armor (50/50).

<!-- src: src/config/dropRates.js:17 -->

| Chest | Alias | Rare | Mythic | Legendary | Supreme | Genesis | Max per command |
|---|---|---|---|---|---|---|---|
| Silver Chest | `sc` | 85% | 15% | — | — | — | 20 |
| Gold Chest | `gc` | 65% | 30% | 5% | — | — | 20 |
| Boss Treasure Chest | `btc` | 50% | 40% | 10% | — | — | 20 |
| Boss Golden Chest | `bgtc` | — | 45% | 45% | 10% | — | 20 |
| Supreme Chest | `supc` | — | — | 70% | 30% | — | **1** |
| Diamond Chest | `dmc` | — | 50% | 50% | — | — | 20 |
| Genesis Chest | `gnc` | — | — | — | — | 100% | **1** |

The Genesis Chest is weapon-only — it always drops one of the five Genesis weapons and
skips the weapon/armor split entirely.

## How do I open chests

<!-- src: src/commands/rpg/open.js:235 -->

| Command | Alias | Slash |
|---|---|---|
| `crd open <alias> [amount]` | `crd o <alias> [amount]` | `/open type: [amount:]` |

Examples:

```text
crd open sc 10
crd open bgtc
crd open supc
crd open lb 5
```

Rules:

| Rule | Behaviour |
|---|---|
| Amount must be a whole number | *"Amount must be a whole number between 1 and 20."* |
| Amount above the chest's cap | Rejected with the cap named |
| Supreme and Genesis chests | *"Supreme Chests can only be opened one at a time."* |
| Not enough chests | Rejected; nothing is consumed |
| Unknown alias | *"Unknown chest. Try: `sc`, `gc`, `btc`, `bgtc`, `supc`, `dmc`, `gnc`."* |

The roll and the deduction happen in one transaction before any animation plays, so a
display failure never costs you a chest. The reveal animation runs for 5 seconds and then
edits into the results grid.

## What do relics and rune bags open into

Relics feed the deity gacha; rune bags feed the rune system. Both use `crd open`.

| Alias | Item | Result |
|---|---|---|
| `sr` | Sacred Relic | 10 deity pulls, pity applies |
| `supr` | Supreme Relic | 1 forced Supreme deity pull, pity untouched |
| `lb` | Lesser Rune Bag | Runes, up to 20 bags per command |
| `gb` | Greater Rune Bag | Runes, up to 20 bags per command |
| `db` | Divine Rune Bag | Runes, up to 20 bags per command |

Relics open one at a time and reject an amount argument.

## What are CRD Bag items and how do I use them

CRD Bag items are consumables resolved only through `crd use <id>`. Their IDs are
letters, and they are a separate namespace from chest aliases and shop product IDs.

<!-- src: src/config/crdBagItems.js:14 -->

| ID | Item | Effect |
|---|---|---|
| `cc` | Character Class Change | Opens the Change Character flow |
| `sr` | Sacred Relic | 10 deity pulls |
| `supr` | Supreme Relic | 1 forced Supreme deity pull |
| `at` | Custom Avatar Token | Redeems into a custom-avatar work-order ticket |
| `dt` | Custom Deity Token | Redeems into a custom-deity work-order ticket |

`crd bag items` only lists an item whose balance is above zero — an empty bag shows *"No
usable bag items."* rather than a zeroed-out list.

Examples:

```text
crd use cc
crd use sr
crd use at
```

Because the namespaces are separate, the command gives precise rejections:

| Input | Reply |
|---|---|
| A number, e.g. `crd use 1` | *"`1` is a CRD Shop product id, not a usable item id — buy with `crd shop buy 1`."* |
| A chest alias, e.g. `crd use sc` | *"`sc` is a chest — open it with `crd open sc`."* |
| A rune bag alias, e.g. `crd use lb` | *"`lb` is a rune bag — open it with `crd open lb`."* |
| Anything else | *"Unknown item id — see `crd bag items` for usable items."* |

Items are consumed only on success. Cancelling the class-change confirmation, letting it
time out, or any database failure consumes nothing.

## What are gear IDs

<!-- src: src/utils/weaponId.js:8 -->

| Property | Value |
|---|---|
| Length | 8 characters |
| Alphabet | `0-9a-z` |
| Uniqueness | Unique across **both** weapons and armor |
| Rune UIDs | Same format, separate namespace |

Cross-table uniqueness is why `crd equip`, `crd enhance`, `crd equipment info` and
`crd sell` never need to be told whether an ID is a weapon or an armor.

## How do I protect gear from being sold

<!-- src: src/commands/rpg/lock.js:20 -->

| Command | Alias | Slash | Effect |
|---|---|---|---|
| `crd lock <id>` | `crd lk <id>` | `/lock weapon_id:` | Marks the item unsellable |
| `crd unlock <id>` | `crd ulk <id>` | `/unlock weapon_id:` | Removes the lock |

Locked items are excluded from every bulk sell and are refused by single-item sells:
*"That equipment is locked. Unlock it first."*

Equipped gear is protected independently: *"That equipment is equipped. Unequip it
first."*

## How do I compare items

<!-- src: src/commands/rpg/compare.js:151 -->

| Command | Alias | Syntax |
|---|---|---|
| Compare | `crd cmp` | `crd compare <weapon\|armor\|deity> <a> <b> [c]` |

Compares two or three owned items of the same kind side by side. Prefix only.

Examples:

```text
crd compare weapon a1b2c3d4 e5f6g7h8
crd compare armor 7k2m9x1p 3n8v4z6q 5t1r8w2y
crd compare deity Zeus Odin
```

## How do I sell gear

<!-- src: src/commands/rpg/sell.js:133 -->

| Command | Slash | Syntax |
|---|---|---|
| Sell | `/sell target:` | `crd sell <id \| tier \| all>` |

Examples:

```text
crd sell a1b2c3d4
crd sell mythic
crd sell all
```

| Target | Meaning |
|---|---|
| An 8-character ID | Sells that one item (or rune) |
| `common`, `rare`, `mythic`, `legendary`, `supreme`, `genesis` | Bulk-sells that tier |
| `all` | Bulk-sells everything **except** Legendary, Supreme and Genesis |

<!-- src: src/config/sellPrices.js:65 -->

Selling is permanent and always shows a Confirm / Cancel dialog first. Equipped and
locked items are always excluded.

## What are gear items worth

<!-- src: src/config/sellPrices.js:13 -->

| Tier | Base sell price (Credux) |
|---|---|
| Common | 100 |
| Rare | 1,000 |
| Mythic | 50,000 |
| Legendary | 100,000 |
| Supreme | 1,000,000 |
| Genesis | 2,000,000 |

Enhanced items additionally refund 30% of the canonical costs of the levels they
successfully reached. Rune sell prices are in the Rune System document.

## Where do chests come from

| Source | Chests |
|---|---|
| Character creation | 10 Silver Chests |
| Raid win vs regular mob | 10% chance of 1 Silver Chest |
| Raid win vs elite mob | 20% chance of 1 Gold Chest |
| Daily attendance | 1 Silver or Gold Chest by reward-cycle day, plus Boss milestone chests by consecutive streak |
| Normal boss defeat | 1 Boss Treasure Chest |
| Greater Boss defeat | 2 Boss Treasure Chests, or 1 Boss Golden Chest |
| Combat level-ups | Gold, Boss Treasure or Boss Golden by bracket |
| Believer level-ups | Gold, Boss Treasure or Boss Golden by bracket |
| CRD Shop | Silver, Gold and Diamond Chests for Credux |
| PvP Shop | Supreme Chest for 6,000 Valor |
| Ranked weekly and season rewards | By bracket payload |

Auto raid never grants chests.
