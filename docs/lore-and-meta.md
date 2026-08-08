# Lore & Meta

This document holds everything about Credd that is not a stat or a formula: the origin of
the bot's name, the world's backstory, class and item flavor text, the roadmap, credits
and licensing. Nothing here changes gameplay — it is the story and the context around it.

Mechanics are covered in the per-system documents; this is the lore record.

## What does the name Credd mean

**Credd** is rooted in the Latin *Credo*, meaning **"I Believe"**. The name comes from the
creator's personal story of belief — belief in God, and belief in self.

The main game inside the bot is called **The Last Believer**.

| Property | Value |
|---|---|
| Bot name | Credd |
| Meaning | Rooted in Latin *Credo*, "I Believe" |
| Base command | `crd` |
| Main game | The Last Believer |

## What does Credux mean

**Credux**, the game's primary currency, is a compound: *Credo* ("I Believe") + *ux*
("light" in Latin).

Its icon is a gold coin with a dashed inner ring, diamond corner ornaments, and a centered
flame.

## What is the story of Credd

The full opening narration, shown when you run `crd register`:

> *Welcome to Credd, the home of many adventures. One of them is waiting for you.*
>
> *In the age before silence, the world thrived under the watch of gods and spirits.
> Mortals prayed, offered, and remembered, and in return, the divine kept the darkness at
> bay.*
>
> *But slowly, the prayers stopped. The offerings ceased. One by one, gods faded as the
> last whisper of their names died on human lips. Without belief, there is no power.
> Without power, there is no protection.*
>
> *The monsters came first in shadows, then in floods. The world that was once guarded by
> divine hands crumbled into chaos. Cities fell. The faithful were scattered. And the gods
> were forgotten.*
>
> *But not all of them.*
>
> *Somewhere, in the ruins of a world that stopped believing, you still remember. A name.
> A story. A prayer. That single act of remembrance is enough to pull a forgotten god back
> from the void — weak, faded, but alive.*
>
> *You are the Last Believer. And the fate of gods rests in your memory.*

<!-- src: src/commands/rpg/register.js:12 -->

## What are the five steps a new believer is shown

<!-- src: src/commands/rpg/register.js:25 -->

| Step | Command | Description |
|---|---|---|
| ⚔️ 1. Your Warrior | `crd create character` | Create your vessel and choose your path: Swordsman, Fighter, Mage, Knight, or Archer. |
| ✨ 2. The Forgotten Gods | `crd summon` | Perform Invocations to summon forgotten deities and carry their will into battle. |
| 🎒 3. Your Arsenal | `crd bag` | Collect and equip weapons forged from history and myth. |
| 🛡️ 4. The Battle | `crd raid` | March against the creatures that have overtaken the land. |
| 🪙 5. Wealth of the Believer | `crd cred` | Belief Shards fuel Invocations. Sacred Relics open greater summons. Credux strengthens your weapons. |

## Why are deity tiers called Remnant, Awakened, Undying and Primordial

Deity rarity tiers use lore names rather than generic rarity words, describing how much of
the god has returned to the world.

<!-- src: src/config/gachaRates.js:48 -->

| Internal tier | Lore name | Colour |
|---|---|---|
| Epic | **Remnant** | Blue |
| Mythic | **Awakened** | Purple |
| Legendary | **Undying** | Gold |
| Supreme | **Primordial** | Red |

Summoning is called an **Invocation** — you are not rolling a gacha, you are remembering
a god's name.

## What is the flavor text for each class

Class flavor is shown on the class preview card during character creation.

<!-- src: src/config/classes.js:43 -->

**Swordsman** — *A warrior forged for the battlefield. Neither the strongest nor the
fastest, but the most reliable. The Swordsman walks the line between offense and defense,
adapting to any fight. Every strike leaves a mark, and every mark bleeds.*

**Fighter** — *A warrior who does not wait for the fight to come — they bring it. The
Fighter is built on aggression, raw power, and the unshakable belief that the best defense
is a fist to the jaw. When a Fighter lands, the enemy feels it. And sometimes, they don't
get back up.*

**Mage** — *The Mage does not swing a sword. They do not need to. While others close the
distance, the Mage is already three moves ahead, building energy that no armor can absorb.
When the charge is ready, there is no blocking what comes next.*

**Knight** — *The Knight does not fall easily. Where others break under pressure, the
Knight absorbs it, holds the line, and keeps fighting. Every blow the enemy lands is one
they will regret. Endurance is not passive — it is a weapon.*

**Archer** — *Swift, precise, and deadly from a distance. The Archer does not wait for the
enemy to come — they are already gone before the enemy arrives. Every arrow finds its
mark, and no armor is thick enough to stop what cannot be seen coming.*

## What are the chest opening flavor lines

<!-- src: src/engine/chestOpen.js:61 -->

| Container | Line |
|---|---|
| Silver Chest | *The silver lock gives way. Steel and fortune spill forth.* |
| Gold Chest | *The gold yielded its secrets. These weapons are now yours to wield.* |
| Boss Treasure Chest | *The boss's hoard cracks open. Power answers the victor.* |
| Boss Golden Chest | *Gilded and cursed — the golden hoard surrenders its arms.* |
| Supreme Chest | *Light pours from the supreme vault. Few have seen what lies within.* |
| Diamond Chest | *The diamond facets fracture the light — brilliance made steel.* |
| Genesis Chest | *The chest opens on the void before creation. One of the First Arms answers.* |
| Sacred Relic | *The sacred relic burns away, leaving its blessing behind.* |
| Supreme Relic | *The supreme relic shatters — raw light forged into steel.* |
| Lesser Rune Bag | *The lesser bag unravels — faint runes scatter into your hand.* |
| Greater Rune Bag | *The greater bag splits open, humming with bound power.* |
| Divine Rune Bag | *The divine bag erupts in light — the strongest runes answer.* |

## What are the Genesis weapons called

The five Genesis-tier weapons are known collectively as the **First Arms**. They sit above
the Supreme tier and are the only weapons that can be enhanced past +10.

| First Arm | Passive name |
|---|---|
| Kiri | Thousand Partings |
| Moira | Fate Ignores Iron |
| Sophia | The Price of Knowing |
| Atlas | Worldbreaker's Grip |
| Titan | Forgefire Veins |

## What are the two coin faces called

The coin toss game does not use "heads" and "tails" as display names.

<!-- src: src/casino/coinToss.js:14 -->

| Call | Face name |
|---|---|
| Heads | **Aeternvm** |
| Tails | **Obscvrvm** |

## What are the in-game shop and board quotes

| Surface | Quote |
|---|---|
| CRD Shop | *"Every believer's coin finds its way home."* |
| PvP Shop | *"Valor is the only coin the war-gods honor."* |
| Leaderboards | *"The gods remember only those whose names are carved at the summit."* |
| Daily attendance | *"The gods take note of your devotion."* |
| Daily quests | *"The gods reward those who prove their worth."* |
| Bestow | *By the will of the gods, <sender> bestows <amount> Credux upon <receiver>.* |

## Which mythologies are in the game

Release 1 covers three pantheons. Further mythologies are planned but not implemented.

| Release | Mythology | Status |
|---|---|---|
| Release 1 | Philippine, Norse, Greek | **Live** |
| Release 2 | Egyptian | Planned |
| Release 3 | Japanese | Planned |
| Release 4 | Hindu | Planned |
| Release 5 | Aztec | Planned |
| Release 6 | Celtic | Planned |

Each new mythology is planned to include a new deity roster across all tiers, new regular
and elite mobs, a new boss lineup, and new legendary weapons.

## What features are planned but not yet in the game

These are recorded design intentions, not live systems:

| Planned feature | Notes |
|---|---|
| Class skill system | Would upgrade PvP to turn-based with input buttons and a 10–15 second timer |
| MP reintroduction | Tied to the class skill system |
| World Boss | Reward structure was defined; mechanics remain pending. Shelved at launch |
| Element system | Removed for launch, planned as an end-game update |
| Guild / clan system | Not implemented |
| Banner and reward-track systems | Deferred |
| Boss Phase 2 skills | Deferred until there is post-release data |

There is currently **no** party or guild system, **no** pet or companion system, and no
element system in Credd.

## Was there a World Boss

A World Boss tier was designed with a full reward structure, but its mechanics were never
completed and it was shelved at launch. The current boss system is the server boss
described in the Boss System document.

The recorded World Boss reward design was:

| Placement | Reward |
|---|---|
| All participants | 1,000,000 EXP + 1,000,000 Credux |
| 1st | 15,000,000 Credux + 1 Supreme Chest + 1 Supreme Relic |
| 2nd – 3rd | 10,000,000 Credux + 1 Supreme Chest |
| 4th – 5th | 10,000,000 Credux + 3 Boss Golden Chests + 10 Sacred Relics |
| 6th – 7th | 5,000,000 Credux + 2 Boss Golden Chests + 10 Sacred Relics |
| 8th – 10th | 5,000,000 Credux + 1 Boss Golden Chest + 10 Sacred Relics |

This table is **design history, not live behaviour**. No World Boss spawns in the game.

## Which deity was removed from the roster

**Hermes** was removed from the deity roster entirely during development and does not
appear in the game.

## What technology is Credd built on

| Layer | Technology |
|---|---|
| Runtime | Node.js 18+ |
| Discord library | discord.js v14 |
| Database | PostgreSQL |
| Image rendering | `@napi-rs/canvas` for profile, battle, inventory, summon, shop and result cards |
| Image composition | `sharp` for casino image padding and composition |
| Scheduling | `node-cron` for resets, bosses, seasons and cleanup jobs |
| Hosting | Railway |
| Database hosting | Supabase |
| Asset CDN | Cloudflare R2 |

## Are the deity and monster images real artwork

Deity artwork carries this disclaimer in game:

> Images are AI-generated interpretations and may not be accurate; used for in-game
> illustration only.

## Who made Credd

Credd was designed and directed by its owner.

The gameplay systems, progression mechanics, economy, balancing, user experience and
overall product vision are original work created for Credd.

The project was developed with AI-assisted software engineering using **Claude Code** and
**OpenAI Codex**, which were used to implement, refactor, optimize and maintain the
codebase.

## What licence is Credd released under

Credd is licensed under the **Creative Commons Attribution-NonCommercial-ShareAlike 4.0
International License** (CC-BY-NC-SA-4.0).

| Permitted | Not permitted |
|---|---|
| Studying the source code | Commercial use |
| Learning from the project | Hosting commercial instances |
| Building on it for personal, non-commercial purposes | Distributing commercial derivatives |
| | Using Credd's branding, artwork or assets without permission |

The source is shared so developers can study, learn from, and build upon the project for
personal and non-commercial purposes. Commercial use requires prior written permission.

## Is Credux worth real money

No. Credux is a virtual currency with no real cash value. Trading it for real money, gift
cards, or anything of real-world value is strictly prohibited and results in a permanent
ban for every account involved.

The casino games carry their own notice: *"Casino games are for fun only. Credux has no
real cash value."*
