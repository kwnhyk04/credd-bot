# Deity System

Deities are the forgotten gods you summon in Credd. Each deity adds flat HP, ATK and DEF
to your character and, once Ascended, activates a combat blessing. You can equip up to
three deities plus one Echo, and matching sets grant resonance bonuses. This document
covers Sigils, Ascension, enhancement, blessing channels, resonance, and every blessing
in the game.

How you obtain deities is covered in the Gacha System document. Deities never grant CRIT.

## What are the deity tiers

<!-- src: src/config/gachaRates.js:48 -->

| Internal tier | Display name | Colour | Summon rate |
|---|---|---|---|
| Epic | Remnant | Blue `#5865F2` | 64.5% |
| Mythic | Awakened | Purple `#9B59B6` | 34.0% |
| Legendary | Undying | Gold `#FFD700` | 1.0% |
| Supreme | Primordial | Red `#E74C3C` | 0.5% |

Deities come from three mythologies: Philippine (`PH`), Norse and Greek.

## What are Sigils and how do they work

The first copy of a deity unlocks it at **50%** of its base stats with its blessing
dormant. Each Sigil adds 5% of base stats, up to 10 Sigils for 100% of base.

<!-- src: src/config/ascension.js:18 -->

```js
multiplier = 0.50 + 0.05 * clamp(sigils, 0, 10)
curr_atk   = floor(base_atk * multiplier)
curr_hp    = floor(base_hp  * multiplier)
curr_def   = floor(base_def * multiplier)
```

| Sigils | Percentage of base stats |
|---|---|
| 0 (first copy) | 50% |
| 1 | 55% |
| 2 | 60% |
| 3 | 65% |
| 4 | 70% |
| 5 | 75% |
| 6 | 80% |
| 7 | 85% |
| 8 | 90% |
| 9 | 95% |
| 10 | 100% |

Sigils are bought with essence of the deity's **own tier**.

## What does each Sigil cost

<!-- src: src/config/ascension.js:25 -->

| Sigil | Epic | Mythic | Legendary | Supreme |
|---|---|---|---|---|
| 1 | 5 | 5 | 3 | 2 |
| 2 | 5 | 5 | 3 | 2 |
| 3 | 5 | 5 | 3 | 2 |
| 4 | 10 | 8 | 5 | 3 |
| 5 | 10 | 8 | 5 | 3 |
| 6 | 10 | 8 | 5 | 3 |
| 7 | 10 | 8 | 5 | 3 |
| 8 | 15 | 12 | 6 | 4 |
| 9 | 15 | 12 | 6 | 4 |
| 10 | 15 | 12 | 6 | 4 |
| **Total for 10/10** | **100** | **83** | **47** | **30** |

Costs are banded: Sigils 1–3 are cheapest, 4–7 mid, 8–10 most expensive.

## What is Ascension and what does it unlock

Ascension is the final unlock. It requires 10/10 Sigils plus essence and Credux, and it
is the **only** thing that activates a deity's blessing.

<!-- src: src/config/ascension.js:33 -->

| Deity tier | Essence cost (own tier) | Credux cost |
|---|---|---|
| Epic | 50 | 100,000 |
| Mythic | 40 | 250,000 |
| Legendary | 20 | 500,000 |
| Supreme | 15 | 1,000,000 |

| Deity state | Stats | Blessing |
|---|---|---|
| Unlocked, 0 Sigils | 50% of base | Dormant |
| 10/10 Sigils, not Ascended | 100% of base | Dormant |
| Ascended | 100% of base, then enhanceable | **Active** |

An unascended deity still contributes its stats — only the blessing is dormant.

## How does deity enhancement work after Ascension

Once Ascended, a deity can be enhanced from +0 to +10. Every level adds a uniform +10% of
base to all three stats — there is no dominant stat.

<!-- src: src/engine/deityEnhancement.js:16 -->

```js
curr_atk = floor(base_atk * DEITY_BOOST_TABLE[enhancement])
curr_hp  = floor(base_hp  * DEITY_BOOST_TABLE[enhancement])
curr_def = floor(base_def * DEITY_BOOST_TABLE[enhancement])
```

| Display level | Stored value | Stat multiplier |
|---|---|---|
| +0 | 1 | ×1.00 |
| +1 | 2 | ×1.10 |
| +2 | 3 | ×1.20 |
| +3 | 4 | ×1.30 |
| +4 | 5 | ×1.40 |
| +5 | 6 | ×1.50 |
| +6 | 7 | ×1.60 |
| +7 | 8 | ×1.70 |
| +8 | 9 | ×1.80 |
| +9 | 10 | ×1.90 |
| +10 | 11 | ×2.00 |

Deity enhancement is **deterministic** — there is no failure chance. Whenever you can pay
the essence, the level succeeds.

<!-- src: src/engine/deityEnhancement.js:25 -->

| Target level | Epic | Mythic | Legendary | Supreme |
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
| **Total to +10** | **330** | **285** | **190** | **100** |

Costs are paid in the deity's own tier essence. Deity enhancement never affects CRIT.

## What are the deity commands

<!-- src: src/commands/rpg/deity.js:1318 -->

| Command | Alias | Slash | Description |
|---|---|---|---|
| `crd deity collection` | `crd dc` | `/deity collection` | Browse the roster, one page per mythology |
| `crd deity info <name>` | `crd di <name>` | `/deity info name:` | Info card for an owned deity |
| `crd deity equip <name> [1\|2\|3]` | `crd de <name>` | `/deity equip name:` | Equip to a slot (default slot 1) |
| `crd deity enhance <name>` | `crd deh <name>` | `/deity enhance name:` | Sigil / Ascension / enhancement forge |
| `crd deity echo <name>` | `crd dec <name>` | Not available | Choose the Echo blessing from slot 2 or 3 |
| `crd deity unequip <1\|2\|3>` | `crd du <slot>` | Not available | Clear a slot |
| `crd deities` | `crd dp` | Not available | Your equipped pantheon and resonance |

`crd deity equip`, `unequip`, and `echo` all write to your currently **active preset**
only — Credd has two independent equipment presets. See the character system document
for how presets and `crd equip preset <1|2>` work.

<!-- src: src/engine/loadout.js:1 -->

Examples:

```text
crd deity collection
crd deity info Bathala
crd deity equip Thor 2
crd deity enhance Zeus
crd deity echo Freya
crd deity unequip 3
crd deities
```

`crd deity info` on a deity you have not summoned replies *"You haven't summoned <name>
yet."* An unknown name replies *"No deity named <name> exists."*

## How many deities can I equip

Three main slots plus one Echo. Slots 2 and 3 are gated behind Believer Level.

<!-- src: src/config/blessings.js:50 -->

| Slot | Unlock requirement | Stat contribution | Blessing channel |
|---|---|---|---|
| Slot 1 | Always available | 100% of the deity's current stats | Primary Blessing |
| Slot 2 | Believer Level 15 | 50% of the deity's current stats, floored | Eligible to be the Echo |
| Slot 3 | Believer Level 30 | 50% of the deity's current stats, floored | Eligible to be the Echo |
| Echo | Chosen from slot 2 or 3 | No extra stats | Secondary Blessing |

<!-- src: src/engine/statAssembly.js:157 -->

A deity cannot occupy two slots at once. Equipping over the slot that was supplying the
Echo clears the Echo automatically, as does unequipping that slot.

Attempting a locked slot replies *"Slot 2 requires **Believer Level 15**. You are level
N."*

## How do blessing channels work

There are two combat channels — Primary and Secondary — and they are **not** the same
axis as the blessing type (Divine or Echo).

<!-- src: src/config/blessings.js:109 -->

| Channel | Source | Rule |
|---|---|---|
| Primary Blessing | The slot 1 deity | An Echo-type deity in slot 1 still supplies the Primary channel, using its Echo key |
| Secondary Blessing | The deity chosen via `crd deity echo` from slot 2 or 3 | Always maps through the Echo blessing table |

A blessing fires **only if its deity is Ascended**. An unascended deity contributes stats
only, and `crd stats` shows `Deity not ascended` or `Locked` for that channel.

## What is mythology resonance

Equipping three deities from the same mythology grants a percentage bonus.

<!-- src: src/config/blessings.js:53 -->

| Mythology | Deities required | ATK % | HP % | DEF % | CRIT points |
|---|---|---|---|---|---|
| Greek | 3 | +6% | — | — | +5 |
| Norse | 3 | — | +8% | +6% | — |
| Philippine (PH) | 3 | +6% | +6% | — | — |

## What is domain resonance

Equipping a specific cross-pantheon trio grants a domain bonus. Domain and mythology
resonances stack additively.

<!-- src: src/config/blessings.js:60 -->

| Domain | Required trio | ATK % | HP % | DEF % | CRIT points |
|---|---|---|---|---|---|
| War Gods | Ares, Tyr, Mandarangan | +10% | +5% | — | — |
| Sun Deities | Apollo, Surt, Apolaki | +8% | — | — | +5 |
| Harvest | Persephone, Freyr, Lakapati | — | +10% | +5% | — |
| Wisdom | Athena, Odin, Bathala | — | +5% | +10% | — |
| Sea | Poseidon, Njord, Magwayen | — | +10% | +8% | — |
| Moon | Artemis, Hel, Mayari | — | — | +8% | +6 |
| Death | Hades, Vidar, Sidapa | +8% | — | +8% | — |
| Forge & Flame | Hephaestus, Thor, Apolaki | +8% | — | +6% | — |
| Tricksters | Dionysus, Loki, Habagat | +5% | — | — | +8 |
| Guardians | Athena, Heimdall, Mayari | — | +8% | +12% | — |
| Last Stand | Hera, Tyr, Dian Masalanta | — | +10% | +10% | — |

Resonance is applied as a percentage multiplier on the class-plus-gear base, before the
deity's flat stats are added.

## Which deities have Divine Blessings

Divine Blessing deities activate their blessing when equipped in slot 1 and Ascended.

<!-- src: src/config/blessings.js:4 -->

| Mythology | Divine Blessing deities |
|---|---|
| Greek | Zeus, Athena, Artemis, Aphrodite, Poseidon, Dionysus |
| Norse | Odin, Thor, Loki, Skadi, Baldur, Heimdall |
| Philippine | Bathala, Sidapa, Amihan |

## Which deities have Echo Blessings

Echo Blessing deities can supply the Secondary channel from slot 2 or 3. They still work
in slot 1, where they supply the Primary channel.

<!-- src: src/config/blessings.js:11 -->

| Mythology | Echo Blessing deities |
|---|---|
| Greek | Nike, Persephone, Hades, Hera, Ares, Hephaestus, Apollo |
| Norse | Bragi, Idunn, Freyr, Vidar, Magni, Njord, Freya, Tyr, Surt, Hel, Mimir |
| Philippine | Idiyanale, Lakapati, Habagat, Mandarangan, Magwayen, Dian Masalanta, Mayari, Apolaki |

## What does every Philippine deity blessing do

<!-- src: assets/data/passive_registry_keys.md:105 -->

| Deity | Blessing | Effect |
|---|---|---|
| Bathala | Divine Vessel | +10% ATK and +4% DEF at the start of each turn, stacking to +100% ATK / +40% DEF |
| Sidapa | Death's Reprieve | Once per battle the first lethal hit leaves you at 1 HP; then heal 30% max HP and gain +50% ATK for the battle |
| Magwayen | Soul Drain | Heals 30% of all damage actually dealt after mitigation, up to max HP |
| Mandarangan | War Frenzy | End of each turn: +10% ATK, stacking to +50% (reached turn 5), persisting all battle |
| Apolaki | Solar Burn | Each attack burns the enemy for 10% of your base ATK for 1 turn |
| Mayari | Lunar Veil | While below 50% HP, DEF +30% and reflect 15% of damage taken |
| Dian Masalanta | Devotion | While below 50% HP, ATK +30% and heal 4% max HP each turn |
| Amihan | Tailwind | 20% chance to evade any incoming attack; each evade grants +20% ATK to her next attack |
| Habagat | Monsoon Fury | 25% chance at the start of each turn to make that turn's attack deal +50% bonus damage |
| Lakapati | Abundance | Regenerates 3% max HP at the start of each turn |
| Idiyanale | Persistence | Every 3rd turn, the next attack deals +75% more damage |

## What does every Norse deity blessing do

<!-- src: assets/data/passive_registry_keys.md:116 -->

| Deity | Blessing | Effect |
|---|---|---|
| Odin | All-Father's Foresight | ATK +50% for the battle. On even turns take 25% less damage and store the prevented damage; add it to the next odd-turn attack, then clear it |
| Thor | Mjolnir's Wrath | 30% chance per attack to Stun and Paralyze for 3 turns; while Paralyzed the enemy takes 20% of your base ATK per turn and has a 10% chance to skip its turn |
| Freya | Valkyrie's Embrace | ATK +30% all battle; once per battle at 40% HP or below, restore 20% max HP |
| Loki | Illusory Double | 25% chance each turn to evade an attack and counter for 100% ATK |
| Tyr | Oathkeeper | DEF +30% all battle; while below 50% HP, reflect 20% of incoming damage |
| Skadi | Winter's Hunt | 30% chance per attack to Freeze (enemy skips its next turn); after Freeze ends the enemy suffers Frostbite, taking 50% more damage for 1 turn |
| Surt | Muspell's Flame | Each attack adds Burn equal to 3% of base ATK per turn for 2 turns, stacking to 15%; attacks deal 50% more damage to already-burning enemies |
| Heimdall | Eternal Vigilance | The first hit taken each battle is reduced by 50%; afterwards incoming critical damage is reduced by 30% |
| Baldur | Invulnerability | Once per battle, the first time you are debuffed or drop below 50% HP, remove all debuffs, restore 15% max HP, and take 50% less damage for 1 turn |
| Hel | Half-Dead | While below 50% HP, ATK +30% and DEF +30% |
| Mimir | Runic Knowledge | Every 3rd turn, the next attack deals +90% more damage |
| Freyr | Harvest Bounty | Restores 6% max HP every 2 turns |
| Njord | Sea's Favor | 15% chance each turn to reduce incoming damage by 30% |
| Bragi | Battle Hymn | ATK +15% for the whole battle |
| Idunn | Golden Apple | Once per battle, at 50% HP or below, restore 15% max HP |
| Vidar | Silent Vengeance | When hit by a critical, the next attack is a guaranteed critical; the first drop below 50% HP also crits the next attack |
| Magni | Might of Magni | +5% ATK for every 10% max HP missing, up to +25% |

## What does every Greek deity blessing do

<!-- src: assets/data/passive_registry_keys.md:133 -->

| Deity | Blessing | Effect |
|---|---|---|
| Zeus | Chain Lightning | ATK +50% for the battle. 50% chance per attack to deal 50% additional damage and add a 5% DEF shred, stacking up to 6 times (30%), resetting after battle |
| Ares | Blood Frenzy | End of each turn, +10% ATK, stacking to +50% |
| Poseidon | Tidal Force | 30% chance per attack to Stun and shred DEF by 30% for 2 turns; the shred refreshes but does not stack |
| Hades | Soul Harvest | While the enemy is below 30% HP, ATK +50% for the rest of the battle |
| Hera | Divine Wrath | DEF +30% all battle; when hit by a critical, gain +10% ATK, stacking 3 times |
| Athena | Aegis Shield | The first 2 hits taken each battle are reduced by 40%; afterwards incoming damage is reduced by 10% |
| Apollo | Solar Radiance | ATK +25% for the whole battle |
| Artemis | Huntress Precision | The first attack each battle always crits; afterwards every 3rd turn the next attack auto-crits |
| Hephaestus | Forged Armor | DEF +25% all battle; while below 50% HP, ATK +20% |
| Aphrodite | Enchanting Aura | 25% chance each turn to Charm the enemy, making it skip its attack |
| Persephone | Cycle of Renewal | Once per battle, when HP drops below 50%, restore 15% max HP |
| Dionysus | Drunken Haze | 30% chance each turn to make the enemy attack itself for 30% of its own ATK |
| Nike | Wings of Victory | ATK +15% for the whole battle |

## What does every Echo blessing do

Echo blessings are weaker versions of the parent blessing, used in the Secondary channel.

<!-- src: assets/data/passive_registry_keys.md:147 -->

| Echo | Effect |
|---|---|
| Echo · Nike | ATK +12% for the whole battle |
| Echo · Persephone | Regenerates 3% max HP every 3 turns |
| Echo · Hades | While the enemy is below 30% HP, ATK +15% |
| Echo · Hera | When hit by a critical, DEF +15% for 2 turns |
| Echo · Ares | ATK +4% every 2 turns, stacking to 16% |
| Echo · Hephaestus | DEF +15% for the whole battle |
| Echo · Apollo | ATK +10% for the whole battle |
| Echo · Bragi | Every 4 turns, ATK +10% for that turn |
| Echo · Idunn | Regenerates 2% max HP every 2 turns |
| Echo · Freyr | Regenerates 3% max HP every 3 turns |
| Echo · Vidar | When hit by a critical, the next attack gains +30% ATK |
| Echo · Magni | ATK +3% for every 10% of HP lost, up to 15% |
| Echo · Njord | 10% chance each turn to reduce incoming damage by 20% |
| Echo · Freya | While HP is below 40%, DEF +20% |
| Echo · Tyr | DEF +10% for the whole battle |
| Echo · Surt | Inherits Muspell's Flame exactly — every landed hit adds 3% base ATK Burn for 2 turns, stacking to 15% |
| Echo · Hel | While HP is below 50%, ATK +8% and DEF +8% |
| Echo · Mimir | Every 5 turns, +30% ATK for that turn |
| Echo · Idiyanale | Every 6 turns, the next attack deals double damage |
| Echo · Lakapati | Regenerates 2% max HP every turn |
| Echo · Habagat | 15% chance to deal +30% bonus ATK |
| Echo · Mandarangan | ATK +5% per turn, stacking to 15% |
| Echo · Magwayen | Soul Drain — heals 30% of all damage dealt after mitigation, up to max HP |
| Echo · Dian Masalanta | While HP is below 30%, ATK +12% |
| Echo · Mayari | While HP is below 50%, DEF +15% |
| Echo · Apolaki | Inherits Solar Burn exactly — every landed hit applies 10% base ATK Burn for 1 tick |

Echo Idiyanale's double damage and Echo Vidar's revenge crit are durable next-attack
queues: they survive a turn lost to crowd control and are consumed when a real attack
begins.

## Do deity blessings persist after a battle

No. All blessing effects, stacks and buffs are battle-duration only and reset when the
battle ends. Sigils, Ascension and enhancement are permanent; the blessing effects they
enable are not.

## Where can I look up deities I do not own

`crd glossary` includes a Deities category showing every roster deity with its
**fully-Ascended reference stats** (100% of base) and its blessing, independent of what
you own. It pages one mythology at a time, matching `crd deity collection`.
