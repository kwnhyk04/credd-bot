# Credd Bot

A mythology-inspired RPG where players collect deities from world mythologies, build their characters, battle powerful bosses, compete in ranked PvP, and progress through an evolving fantasy world.

Credd is a prefix-first Discord bot with slash-command support, PostgreSQL persistence, canvas-rendered RPG cards, combat, gacha, bosses, ranked PvP, economy systems, inventory management, cosmetics, and casino games.

Default prefix:

```text
crd
```

## Tech Stack

- Node.js 18+
- discord.js v14
- PostgreSQL
- @napi-rs/canvas for rendered profile, battle, inventory, summon, shop, and result images
- sharp for casino image padding and composition
- node-cron for scheduled resets, bosses, seasons, and cleanup jobs

## Deployment

This discord bot is deployed via <u>[Railway](https://railway.com/)</u> and uses <u>[Supabase](https://supabase.com/)</u> for its database.

## License

This project is licensed under the <u>[Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License.](https://spdx.org/licenses/CC-BY-NC-SA-4.0.html)</u>

The source code is shared so developers can study, learn from, and build upon the project for personal and non-commercial purposes.

Commercial use, hosting commercial instances, or distributing commercial derivatives of Credd is not permitted without prior written permission.

## Main Systems

- Account registration and character creation
- Profile and combat stats cards
- Raid, duel, ranked PvP, idle auto-raid, and world boss combat
- Gear, armor, enhancement, locking, selling, sockets, and runes
- Deity summon, collection, equip, echo, and enhancement
- Daily rewards, quests, bestow, Credux, belief shards, essence, and Valor medals
- Chests, relics, rune bags, drops, and animated result reveals
- Supporter skin shop, equipped skins, titles, and cosmetics
- Casino games: coin toss, dice, baccarat, blackjack, slot machine, and crash
- Server admin settings for prefix, bot channel, announcement channel, and boss channel
- Local asset loading for development and remote asset loading for production

## Project Layout

```text
index.js                  Bot entry point
src/commands/             Prefix and slash-backed command handlers
src/commands/rpg/         RPG, battle, inventory, gacha, skin, and dev commands
src/commands/economy/     Daily, quests, balance, and bestow commands
src/commands/casino/      Casino command wrappers
src/casino/               Casino engines, renderers, sessions, and bet guards
src/engine/               Combat, rendering, skins, bosses, summons, and shared RPG logic
src/config/               Game config, aliases, rates, cooldowns, titles, and constants
src/db/                   PostgreSQL pool
src/handlers/             Message, interaction, middleware, and guild config handling
src/schedulers/           Reset, boss, battle cleanup, and season schedulers
src/utils/                Assets, components, emojis, text, IDs, rewards, and helpers
scripts/                  Selftests, slash deploy, preflight, schema, and tooling
assets/                   Local development assets and render data
```

## AI Assistance

Credd was designed and directed by the owner.

The gameplay systems, progression mechanics, economy, balancing, user experience, and overall product vision are original work created for Credd.

This project was developed with AI-assisted software engineering using **Claude Code** and **OpenAI Codex**, which were used to implement, refactor, optimize, and maintain the codebase.

## Usage

This repository is shared for learning, reference, and personal non-commercial use.

Commercial use, redistribution, operating public or commercial derivatives, or using Credd's branding, artwork, or assets without permission is not permitted.
