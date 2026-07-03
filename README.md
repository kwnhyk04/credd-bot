# Credd Bot

Discord RPG bot for **The Last Believer**.

Credd is a prefix-first Discord bot with slash-command support, PostgreSQL
persistence, canvas-rendered RPG cards, combat, gacha, bosses, ranked PvP,
economy systems, inventory management, cosmetics, and casino games.

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
