# Credd Bot

Discord RPG bot for **The Last Believer**. Credd is a prefix-first Discord bot with
slash-command support, PostgreSQL persistence, canvas-rendered RPG cards, gacha,
combat, bosses, ranked PvP, quests, economy, inventory, skins, and casino games.

Default prefix:

```text
crd
```

Guild admins can also configure a custom server prefix. Slash commands are
registered separately with `scripts/deploy-commands.js`.

## Tech Stack

- Node.js 18+
- discord.js v14
- PostgreSQL
- @napi-rs/canvas for profile, battle, inventory, shop, and result images
- sharp for casino image padding/composition
- node-cron for scheduled resets, bosses, seasons, and cleanup

## Main Systems

- Account and character creation
- Profile and stats cards
- Raid, duel, ranked PvP, idle auto-raid, and world boss combat
- Gear, armor, enhancement, locking, selling, sockets, and runes
- Deity summon, collection, equip, echo, and enhancement
- Daily rewards, quests, bestow, Credux, belief shards, essence, and Valor medals
- Chests, relics, rune bags, drops, and animated result reveals
- Supporter skin shop, equipped skins, title collection, and cosmetics
- Casino games: coin toss, dice, baccarat, blackjack, slot machine, and crash
- Server admin settings for prefix, bot channel, announcement channel, and boss channel

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

## Requirements

- Node.js 18 or newer
- npm
- PostgreSQL database with the Credd schema applied
- Discord bot application with message content intent enabled
- Local `assets/` folder for development, or R2-compatible remote assets in production

## Environment

Create a local `.env` from `.env.example` and fill in real values. Do not commit
real `.env` files or secrets.

Required:

```env
BOT_TOKEN=
CLIENT_ID=
DATABASE_URL=
DEV_IDS=
```

Optional:

```env
NODE_ENV=development
GUILD_IDS=
PGSSL=
PGSSL_CA=
ASSET_BASE_URL=
ASSET_VERSION=
BETA_MODE=false
DEV_ACCOUNT_IDS=
ALLOW_DESTRUCTIVE_DEV_COMMANDS=false
ALLOW_HIGH_VALUE_DEV_COMMANDS=false
ALLOW_SUPPORTER_DEV_COMMANDS=false
ALLOW_LIVE_EVENT_DEV_COMMANDS=false
```

Notes:

- `DEV_IDS` is a comma-separated list of Discord IDs allowed to use `crd dev`.
- `GUILD_IDS` is optional for slash deployment. Guild-scoped slash commands update
  quickly; global commands can take about an hour to propagate.
- Use `PGSSL=require` or `PGSSL_CA=/path/to/ca.pem` for hosted Postgres that
  requires TLS.
- Keep dangerous dev flags false in production unless you are intentionally doing
  guarded maintenance.

## Install

```bash
npm install
```

## Database

The bot expects PostgreSQL tables for users, characters, inventory, gear, deities,
quests, ranked PvP, bosses, casino sessions/logs, cosmetics, titles, server config,
and related indexes.

Schema and deployment helpers live in:

```text
scripts/credd_schema_v4.sql
scripts/production-consolidated-schema.sql
scripts/production-preflight.js
```

Before production deploy, run:

```bash
npm run preflight:prod
```

For local or staging checks:

```bash
npm run preflight
```

The preflight is read-only. It checks env, database connectivity, required tables,
columns, indexes, TLS, and critical local asset files.

## Assets

Local development uses files under `assets/` when `ASSET_BASE_URL` is blank.

Production can load bot artwork from Cloudflare R2 or another public asset host by
setting:

```env
ASSET_BASE_URL=https://pub-xxxx.r2.dev
ASSET_VERSION=2026-07-03
```

The R2 bucket root should mirror the contents of the local `assets/` folder
directly. For example:

```text
assets/profile/default_template.png       -> https://pub-xxxx.r2.dev/profile/default_template.png
assets/skins/founder/founder_profile.png  -> https://pub-xxxx.r2.dev/skins/founder/founder_profile.png
assets/deities/norse/odin.png             -> https://pub-xxxx.r2.dev/deities/norse/odin.png
assets/weapons/xiphos.jpg                 -> https://pub-xxxx.r2.dev/weapons/xiphos.jpg
```

Do not include `assets/` or a project folder name in `ASSET_BASE_URL`.

`ASSET_VERSION` is optional but recommended. When set, remote URLs get a query
string like `?v=2026-07-03`. Change it after replacing R2 files with the same
names to force caches to treat the assets as new URLs.

Asset loading is centralized in:

```text
src/utils/assets.js
```

Runtime behavior:

- Remote production: `assetPath("profile/default_template.png")` returns
  `ASSET_BASE_URL + "/profile/default_template.png?v=ASSET_VERSION"`.
- Local development: the same call returns a filesystem path under local `assets/`.
- If remote loading fails during local testing, the helper can fall back to the
  local mirrored asset when possible.

## Running The Bot

Start normally:

```bash
npm start
```

Development watch mode:

```bash
npm run dev
```

Entry point:

```text
index.js
```

On ready, the bot loads guild config, starts schedulers, audits emoji mappings,
prewarms casino assets, and recovers expired casino sessions.

## Slash Commands

Prefix commands work through `messageCreate`. Slash commands are defined in:

```text
src/commands/slashDefinitions.js
```

Deploy slash commands:

```bash
node scripts/deploy-commands.js
```

If `GUILD_IDS` is set, commands are registered to those guilds. If it is blank,
commands are registered globally.

## Validation

Available npm scripts:

```bash
npm run selftest
npm run selftest:full
npm run preflight
npm run preflight:prod
```

What they cover:

- `selftest`: battle registry coverage, deterministic battle simulation, targeted
  combat scenarios, and seeded fuzz invariants.
- `selftest:full`: battle selftest, help command surface checks, and casino
  fairness/payout integrity checks.
- `preflight`: read-only env, database, and local asset readiness checks.
- `preflight:prod`: stricter production readiness checks.

There is no separate `npm test` or `npm run lint` script at the moment.

## Command Surface

Players can use `crd help` or `/help` in Discord. Public command categories include:

### Account and Profile

- `crd register` / `crd reg`
- `crd create character` / `crd cc`
- `crd profile [@user]` / `crd p`
- `crd stats [@user]`
- `crd cred` / `crd g`

### Battle

- `crd raid` / `crd r`
- `crd auto raid` / `crd ar`
- `crd duel @user` / `crd d`
- `crd ranked` / `crd rk`
- `crd ranked claim` / `crd rc`
- `crd boss`
- `crd leaderboards` / `crd lb`
- `crd pvp shop` / `crd ps`

### Inventory, Gear, Runes, and Essence

- `crd bag` / `crd b`
- `crd bag chests` / `crd bc`
- `crd bag weapons` / `crd bw`
- `crd bag armors` / `crd ba`
- `crd open [chest|relic]` / `crd o`
- `crd equip [id]` / `crd eq`
- `crd equipment info [id]` / `crd ei`
- `crd enhance [id]` / `crd enh`
- `crd lock [id]` / `crd lk`
- `crd unlock [id]` / `crd ulk`
- `crd sell [id|tier|all]`
- `crd rune bag` / `crd rb`
- `crd runes` / `crd rn`
- `crd socket [gear] [rune]` / `crd so`
- `crd unsocket [gear] [slot]` / `crd uso`
- `crd essence shop` / `crd es`
- `crd exchange ...` / `crd ex`
- `crd exchange essence`

### Gacha and Deities

- `crd summon [1|5|10]` / `crd s`
- `crd deity collection` / `crd dc`
- `crd deity info [name]` / `crd di`
- `crd deity equip [name] [slot]` / `crd de`
- `crd deity enhance [name]` / `crd deh`
- `crd deity echo ...` / `crd dec`
- `crd deity unequip ...` / `crd du`
- `crd deities` / `crd dp`

### Economy and Quests

- `crd daily`
- `crd quests` / `crd q`
- `crd bestow @user [amount]` / `crd bs`

### Supporter Skins and Titles

- `crd shop`
- `crd buy [skin_id]`
- `crd skin collection`
- `crd equip skin [skin_id]`
- `crd use skin [skin_id]`
- `crd set all skin default`
- `crd title` / `crd t`

### Casino

- `crd coin toss [bet] heads|tails` / `crd ct`
- `crd dice roll [bet] odd|even` / `crd dr`
- `crd baccarat [bet] player|banker` / `crd bac`
- `crd blackjack [bet]` / `crd bj`
- `crd slot machine [bet]` / `crd sl` / `crd sm`
- `crd crash [bet]`

### Admin

Requires Discord Manage Server permission.

- `crd admin setprefix [prefix]`
- `crd admin setbotchannel [#channel]`
- `crd admin setannouncementchannel [#channel]`
- `crd admin setbosschannel [#channel]`
- `crd admin stats`

## Dev Commands

`crd dev` is intentionally not shown in public help. It is gated by `DEV_IDS`.
Some destructive or high-value dev actions also require explicit environment flags
and confirmation tokens. Keep those flags disabled in production unless actively
performing controlled maintenance.

## Schedulers And Runtime Jobs

The bot starts these jobs after Discord login:

- Battle reaper: cleans expired battle sessions
- Reset scheduler: midnight PHT daily reset work
- Boss scheduler: server boss spawn/escape/defeat lifecycle
- Season scheduler: ranked season maintenance
- Casino recovery sweep: refunds expired stateful casino sessions

## Deployment Notes

For Railway or another Node host:

1. Set the required env vars.
2. Set `NODE_ENV=production`.
3. Configure hosted Postgres TLS with `PGSSL=require` or `PGSSL_CA`.
4. Set `ASSET_BASE_URL` to the R2 public root if using remote assets.
5. Set `ASSET_VERSION` and bump it when replacing assets with the same filenames.
6. Run `npm run preflight:prod` before deploy when possible.
7. Start with `npm start`.

Do not hardcode secrets, bot tokens, database URLs, or R2 public URLs in source.

## Development Notes

- Preserve game rules and balance values unless a task explicitly changes them.
- Keep database changes transactional and guarded.
- Keep command behavior stable when touching renderers or assets.
- Prefer the existing command, renderer, and Components V2 patterns.
- Run `npm run selftest:full` after meaningful gameplay, command, casino, or render changes.

