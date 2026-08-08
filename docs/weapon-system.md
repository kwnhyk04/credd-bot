# Weapon System

Weapons are the ATK and CRIT half of your gear in Credd. Every character has exactly one
weapon slot. Weapons drop from chests, roll their stats within tier-and-type bands, carry
a unique combat passive, and can hold rune sockets. This document covers weapon tiers,
stat ranges, the type profiles, every weapon passive, and the weapon commands.

Weapons roll **ATK and CRIT only** — HP and DEF come from armor, which is covered in the
Armor System document.

## What weapon tiers exist

<!-- src: scripts/production-consolidated-schema.sql:574 -->

| Tier | Source | Notes |
|---|---|---|
| Common | Starter gear only | Not enhanceable, not obtainable from chests |
| Rare | Silver, Gold, Boss Treasure chests | |
| Mythic | Silver, Gold, Boss Treasure, Boss Golden, Diamond chests | |
| Legendary | Gold, Boss Treasure, Boss Golden, Supreme, Diamond chests | 25% chance of a damage rider |
| Supreme | Boss Golden, Supreme chests | Fixed stats |
| Genesis | Genesis Chest only | The five First Arms; fixed stats, enhances to +20 |

## What weapon types exist

<!-- src: scripts/production-consolidated-schema.sql:577 -->

Four types: **Sword, Staff, Gloves, Bow**. Shields were removed as a weapon type and
migrated to armor.

Each type positions its rolled ATK and CRIT inside the tier range differently:

<!-- src: src/config/dropRates.js:74 -->

| Type | ATK profile | CRIT profile |
|---|---|---|
| Sword | Balanced | Balanced |
| Staff | Highest | Lowest |
| Gloves | High | Low |
| Bow | High | High |

Those profile names map to fixed windows of the tier range:

<!-- src: src/config/dropRates.js:83 -->

| Profile | Window of the tier range |
|---|---|
| Lowest | 0% – 20% |
| Low | 0% – 40% |
| Balanced | 40% – 60% |
| High | 60% – 100% |
| Highest | 80% – 100% |

```js
frac  = lo + random() * (hi - lo)
value = min + frac * (max - min)
```

## What are the weapon stat ranges by tier

<!-- src: src/config/dropRates.js:65 -->

| Tier | ATK range | CRIT range |
|---|---|---|
| Rare | 100 – 150 | 1% – 5% |
| Mythic | 200 – 350 | 1% – 5% |
| Legendary | 500 – 600 | 3% – 7% |

ATK is floored to a whole number; CRIT is rounded to one decimal place.

Supreme and Genesis weapons do **not** roll — their stats are fixed:

<!-- src: src/config/dropRates.js:92 -->

| Tier | ATK | CRIT | Damage bonus |
|---|---|---|---|
| Supreme | 800 | 10.0% | +50% |
| Genesis | 1,600 | 20.0% | +50% |

## What is the Legendary damage rider

25% of Legendary weapon drops roll a bonus damage rider.

<!-- src: src/config/dropRates.js:106 -->

| Property | Value |
|---|---|
| Chance on a Legendary drop | 25% |
| Value when it rolls | +25% damage |

That damage % applies to both critical and non-critical hits, exactly like the Supreme
and Genesis riders. A Legendary weapon without the rider has no damage bonus.

## How many rune sockets does a weapon have

Native socket count is rolled once, at drop, by tier. Weapon native sockets are the
**offense** lane.

<!-- src: src/config/dropRates.js:155 -->

| Tier | 0 sockets | 1 socket | 2 sockets |
|---|---|---|---|
| Common | 100% | — | — |
| Rare | — | 70% | 30% |
| Mythic | — | 40% | 60% |
| Legendary | — | — | 100% |
| Supreme | — | — | 100% |
| Genesis | — | — | 100% |

The maximum native socket count is 2. Opposite-lane sockets exist in the schema but
unlocking and socketing them is currently disabled.

## How do I equip and inspect weapons

| Command | Alias | Slash | Syntax |
|---|---|---|---|
| Equip | `crd eq <id>` | `/equip weapon_id:` | `crd equip <id>` |
| Info card | `crd ei <id>` | `/equipment info equipment_id:` | `crd equipment info <id>` |
| Compare | `crd cmp` | Not available | `crd compare weapon <a> <b> [c]` |
| Lock | `crd lk <id>` | `/lock weapon_id:` | `crd lock <id>` |
| Unlock | `crd ulk <id>` | `/unlock weapon_id:` | `crd unlock <id>` |
| Browse | `crd bw` | `/bag section:weapons` | `crd bag weapons` |
| Enhance | `crd enh <id>` | `/enhance weapon_id:` | `crd enhance <id>` |
| Sell | — | `/sell target:` | `crd sell <id>` |

`crd equip` writes to your currently active equipment **preset** only. Credd has two
independent presets per character — see `crd preset` and `crd equip preset <1|2>` in the
character system document.

<!-- src: src/engine/loadout.js:1 -->

Examples:

```text
crd equip a1b2c3d4
crd equipment info a1b2c3d4
crd compare weapon a1b2c3d4 e5f6g7h8
crd lock a1b2c3d4
```

Weapon IDs are 8 characters from `0-9a-z` and are unique across both weapons and armor,
so `crd equip <id>` never needs to be told which kind of gear it is.

<!-- src: src/utils/weaponId.js:8 -->

Equipping replies with the resolved item, e.g. `Equipped **Gungnir** (Supreme) +7.`

## How do weapon passives work

Every weapon carries exactly one passive, identified by a `passive_key`. Passives fire
automatically in combat. `none` is the shared no-op for weapons with no passive.

Passive log policy: persistent bonuses announce once per battle, stack growth announces
only when a stack is gained, and chance or reactive effects announce only when they
actually change a hit.

## What does every basic weapon passive do

<!-- src: assets/data/passive_registry_keys.md:9 -->

| Weapon | Passive | Effect |
|---|---|---|
| Cutlass | Serrated Edge | 10% chance per attack to Bleed the enemy for 5% of your base ATK per turn for 2 turns |
| Kampilan | Opening Strike | The first hit deals +20% ATK |
| War Club | Concussive Blow | 10% chance to stun the enemy for 1 turn |
| Bone Crusher | Opening Strike | The first hit deals +20% ATK |
| Crystal Wand | Arcane Surge | 10% chance to deal a +15% ATK bonus hit |
| Carved Totem | Opening Strike | The first hit deals +20% ATK |
| Recurve Bow | Precise Shot | 10% chance to deal a +20% ATK bonus hit |
| Crossbow | Piercing Opener | The first hit deals +20% ATK and ignores 25% of enemy DEF |

## What does every mid-tier weapon passive do

<!-- src: assets/data/passive_registry_keys.md:20 -->

| Weapon | Passive | Effect |
|---|---|---|
| Katana | Lethal Edge | Each attack deals 30% additional damage (×1.30 normal, ×2.30 critical) |
| Gladius | Brutal Swing | 30% chance to deal +50% bonus ATK |
| Scimitar | Rising Slash | ATK +3% every turn, stacking up to 15% |
| Roman Cestus | Executioner | Deals 50% more damage to stunned enemies |
| Pata | Rending Claws | Each attack makes the enemy Bleed for 5% of your base ATK per turn for 2 turns |
| Bagh Nakh | Frenzied Claws | ATK +5% every turn, stacking up to 25% |
| Japanese Bo | Vital Siphon | 25% chance to heal for 50% of the damage dealt |
| English Quarterstaff | Sweeping Strike | 20% chance to deal +50% bonus ATK |
| Egyptian Asa | Armor Breaker | Ignores an extra 3% of enemy DEF every turn, stacking up to 15% |
| Pilgrim's Bordone | Sundering Blow | 50% chance to reduce enemy DEF by 15% for 1 turn |
| Holmegaard Bow | Steady Aim | ATK +3% every turn, stacking up to 15% |
| Scandinavian Glacial Wooden Bow | Frostwind Volley | 10% chance to take another turn |
| Scythian Composite Bow | Power Draw | 20% chance to deal +50% bonus ATK |
| Xiphos | Honed Edge | ATK +4% every turn, stacking up to 20% |
| Kopis | Cleaving Blow | 25% chance to deal +60% bonus ATK |
| Caestus | Hammer Fists | 35% chance to deal +40% bonus ATK |
| Myrmex | Predator's Grip | Deals 40% more damage to stunned enemies |
| Dory | Phalanx Momentum | ATK +6% every 2 turns, stacking up to 18% |
| Thyrsus | Maddening Touch | 20% chance each turn to Bleed the enemy for 5% of your base ATK per turn for 2 turns |
| Arrow of Eros | Love's Arrow | 30% chance to deal +45% bonus ATK |
| Cretan Bow | Hunter's Focus | ATK +4% every turn, stacking up to 20% |

## What does every Legendary weapon passive do

<!-- src: assets/data/passive_registry_keys.md:41 -->

| Weapon | Passive | Effect |
|---|---|---|
| Juru Pakal | Bloodhunter | +10% outgoing damage, and 50% more damage to targets affected by Bleed, Hemorrhage, Rupture or Venom |
| Gram | Dragonbane | Ignores 25% of enemy DEF and deals 30% more damage while the target is above 50% max HP |
| Tyrfing | Cursed Edge | ATK +10% at the start of each turn, stacking to +30%. Executes non-boss targets below 10% max HP and player targets below 5%; bosses are immune |
| Laevateinn (Sword) | Sundering Flame | Reduces enemy DEF by 10% every turn, stacking up to 30% |
| Jarngreipr | Thunder Grip | +20% outgoing damage. Applying Stun immediately triggers Bash for 50% bonus damage on that attack |
| Gridr's Iron Gloves | Ironhide | +20% outgoing damage and a 20% chance per incoming hit to ignore that hit entirely |
| Alan's Reversed Hands | Untouchable | +20% outgoing damage and immunity to status effects; damage-over-time still applies |
| Knuckle Charm (Anting-Anting) | Death Charm | +10% outgoing damage and a 5% chance on attack to instantly kill a non-boss target |
| Laevateinn (Staff) | Flickering Flame | Attacks ignore 15% of enemy DEF and apply Burn equal to 10% of ATK for 2 turns |
| Galdrastafir | Runebreaker | +10% damage. Every successful attack reduces the target's DEF by 20% for 1 turn, refreshing rather than stacking |
| Babaylan's Ritual Staff | Sacred Cleansing | 50% chance each turn to remove all status and DOT debuffs; if at least one is removed, +100% ATK for 1 turn |
| Badiang Stalk | Venom Burst | 30% chance on attack to Rupture for 10% of the target's max HP, then apply Venom for 10% ATK per turn for 2 turns. Bosses block the Rupture but not the Venom |
| Gusisnautar | Hemorrhaging Shot | 50% chance on attack to deal 5% of the target's max HP and reduce its DEF by 15% for 1 turn. Bosses block both effects |
| Freyr's Arrow | Auto-Fire | 30% chance on attack to fire one additional shot for 100% ATK |
| Harpe | Gorgon Slayer | Ignores 30% of enemy DEF |
| Sword of Damocles | Impending Doom | ATK +5% every turn, stacking to +100%. While any stacks are active you take +10% damage |
| Labrys | Double Strike | Every 3rd eligible turn the primary attack is followed by a 70% ATK additional strike. Both can crit and trigger attack effects |
| Hephaestus' Hammer | Forged Armor | DEF +20% for the whole battle; every 4th turn lands a 150% ATK forge strike |
| Caduceus | Herald's Touch | +10% damage and incoming damage-over-time reduced by 10% |
| Spear of Ares | Bloodlust | ATK +10% at the start of each turn, stacking to +50% for the battle |

## What does every Supreme weapon passive do

<!-- src: assets/data/passive_registry_keys.md:69 -->

| Weapon | Passive | Effect |
|---|---|---|
| Apollo's Silver Bow | Unerring Arrow | Ignores 25% of enemy DEF. Every 3rd turn the attack is a guaranteed CRIT, counted in your own attack turns so a turn lost to crowd control does not burn a count |
| Mjolnir | Crushing Force | Attacks deal +30% ATK; every 3rd turn the attack deals an additional +200% ATK |
| Gungnir | Never Misses | Each attack ignores 30% of enemy DEF and has a separate 10% chance to pierce all DEF. Full pierce supersedes the 30% rather than stacking |
| Thunderbolt of Zeus | Divine Thunder | Each critical attack deals +100% bonus ATK and applies Paralyze for 1 turn |
| Trident of Poseidon | Tidal Wrath | Every 2nd turn deals +100% bonus ATK and reduces enemy DEF by 20% for 1 turn, with a 30% chance to stun for 1 turn |

## What are the Genesis weapons (First Arms)

Five Genesis weapons exist. They drop only from the Genesis Chest, have fixed stats
(1,600 ATK, 20% CRIT, +50% damage), and are the only weapons that enhance past +10.

<!-- src: assets/data/passive_registry_keys.md:75 -->

| Weapon | Passive | Effect |
|---|---|---|
| Kiri | Thousand Partings | Each attack increases damage by 20%, stacking up to +120%. Each attack has a 25% chance to strike twice |
| Moira | Fate Ignores Iron | All attacks reduce the target's DEF by 10%, stacking to 50%. Ignores 50% of DEF against targets with a defense buff. Attacks cannot miss |
| Sophia | The Price of Knowing | All damage dealt +75%, but you take 20% more damage. Below 30% HP the bonus rises to +150% for the rest of the battle |
| Atlas | Worldbreaker's Grip | Base attack +50%. Every 3rd turn is a guaranteed critical strike. Enemies hit by a critical have their ATK reduced by 30% for 1 turn |
| Titan | Forgefire Veins | Heals for 30% of all damage dealt (50% below 50% HP). Once per battle, on fatal damage, survives at 1 HP and gains +100% damage for the rest of the battle |

## Where are shield passives documented

Twelve passive keys that originally belonged to shield-type weapons were migrated to
armor when shields were removed as a weapon type: Steel Kite Shield, Reinforced Targe,
Vatican Aspis, Battersea Shield, Dipylon Shield, Enderby Shield, Pelte, Shield of the
Valkyrie, Skjaldmaer, Luzon Tribal Shield, Aegis, and Helm of Darkness.

Their effects are documented in the Armor System document.

<!-- src: assets/data/passive_registry_keys.md:82 -->

## How much are weapons worth when sold

Base sell price is by tier, plus a refund of 30% of the canonical enhancement costs for
levels the item successfully reached.

<!-- src: src/config/sellPrices.js:13 -->

| Tier | Base sell price (Credux) |
|---|---|
| Common | 100 |
| Rare | 1,000 |
| Mythic | 50,000 |
| Legendary | 100,000 |
| Supreme | 1,000,000 |
| Genesis | 2,000,000 |

```js
enhancementRefund = floor(successfulEnhancementCost * 0.30)
total             = basePrice + enhancementRefund
```

Failed enhancement attempts and actual historical spend are deliberately excluded.

Legendary, Supreme and Genesis weapons are excluded from `crd sell all` and can only be
sold individually or by explicit tier.

## What weapons can I not sell or lose

| Protection | Effect |
|---|---|
| Equipped | *"That equipment is equipped. Unequip it first."* |
| Locked (`crd lock <id>`) | *"That equipment is locked. Unlock it first."* |
| Legendary / Supreme / Genesis | Excluded from `crd sell all` |

Selling is permanent and always shows a Confirm / Cancel safeguard first.

## Where can I look up weapons I do not own

`crd glossary` has a Weapons category listing every available weapon with its tier, type
and passive, ordered Genesis down to Common, up to 10 entries per page.
