# CREDD — Phase 11 Build Prompt
## Help Command · Admin Settings · Slash Command Support
---

## Context & Attached Docs
Upload at session start: `CREDD_Master_Export_v4_2.md` (patched through v4.8), `credd_schema_v4.sql`, `CREDD_Technical_Blueprint_v4.md`, `CREDD_Roster_and_Asset_Conventions.md`.

---

## Standing Rules (non-negotiable, carry from all phases)
- **Schema is FROZEN.** No `ALTER TABLE`, no `CREATE TABLE`, no DDL of any kind. `server_config` already exists with `prefix VARCHAR(5) NOT NULL DEFAULT 'crd'` — use it as-is.
- **Do NOT touch:** `summonEngine.js`, `passiveRegistry.js`, `resolveBattle.js`, `statAssembly.js`, casino engine RNG, `.env` (you may READ it; the only addition this phase is `CLIENT_ID` documented below).
- Branch `master`. Opus high-effort mode.
- Plain-text errors only — no embed on errors. Error path unchanged from all prior phases.
- `DEV_IDS` gating and `dev_logs` for dev commands unchanged.

---

## This Phase Is PLAN-FIRST

The slash command adapter and prefix-cache changes touch the core routing layer and every existing command handler. **Present your full implementation plan, then STOP and wait for my approval before writing any code.** Your plan must include:
1. The complete list of files you will create and modify.
2. How the `CommandContext` adapter wraps both `Message` and `ChatInputCommandInteraction` (see §3).
3. How you will phase the `ctx` refactor across all command files without breaking any existing command.
4. Any ambiguity or conflict you spot between this prompt and existing code.

---

## Deliverables

### D1 — `crd help` (categorized embed)
### D2 — `crd admin` suite (prefix + channel settings + guild stats)
### D3 — Dual-input routing: custom prefix + slash commands (`/bag`, `/raid`, etc.)

---

## §1 — Custom Prefix System

### 1.1 How the prefix works
`server_config.prefix` stores the per-guild custom prefix. The bot always accepts **two** triggers simultaneously:
- `crd` — hardcoded permanent fallback, active in every server regardless of settings.
- The guild's configured prefix (from `server_config.prefix`) — active when set and different from `crd`.

Both are live at the same time. A user can always use `crd`; if the admin sets prefix to `c`, then `c bag` and `crd bag` both work.

### 1.2 Prefix cache
On bot startup, load every row of `server_config` into an in-memory `Map<guildId, string>` called `guildPrefixCache`. Default for any guild not in the map is `'crd'`.

Check whether `server_config` is already being queried anywhere in the middleware (specifically the `bot_channel_id` check). If it is, integrate the prefix cache into that existing load — don't issue a second DB call for the same row. Confirm in your plan how the cache is currently handled (if at all) before proposing changes.

On `messageCreate`, strip whichever prefix matched first. If neither prefix matches, return (not a command). Parse the remainder into command + args exactly as today.

### 1.3 Cache invalidation
When `crd admin setprefix` succeeds: update `server_config` in DB (UPSERT) and update `guildPrefixCache.set(guildId, newPrefix)` in the same code path.

### 1.4 `server_config` upsert pattern
All admin sub-commands that touch `server_config` use:
```sql
INSERT INTO server_config (guild_id, <column>)
VALUES ($1, $2)
ON CONFLICT (guild_id) DO UPDATE SET <column> = EXCLUDED.<column>
```
Never a plain `INSERT` — a guild may or may not have a row.

---

## §2 — `crd admin` Commands

All sub-commands require `PermissionFlagsBits.ManageGuild` on the invoking member. Non-admin attempt → plain-text error, no embed, no further action.

### `crd admin setprefix [prefix]`
- Validates: 1–5 chars, `[a-zA-Z0-9]` only, no spaces, no `/`.
- Rejects the value `crd` (redundant; tell the user it's already the permanent fallback).
- UPSERT `server_config (guild_id, prefix)`.
- Update `guildPrefixCache`.
- Reply embed: confirm new prefix, note that `crd` still works universally.

### `crd admin setbotchannel [#channel]`
- Accepts a channel mention or channel ID string.
- Resolves to a valid text channel in this guild; error if not found.
- UPSERT `server_config.bot_channel_id`.
- Reply embed: confirmation with channel name.

### `crd admin setannouncementchannel [#channel]`
- UPSERT `server_config.announcement_channel_id`.
- Reply embed: confirmation.

### `crd admin setbosschannel [#channel]`
- UPSERT `server_config.boss_announcement_channel_id`.
- Reply embed: confirmation.

### `crd admin stats`
- Query `user_guild_activity INNER JOIN user_character` for this guild.
- Display in a plain embed: total registered players (ever active in guild), active in the last 7 days, average combat level of active players. No canvas.
- This is a read-only query — no write path, no money path.

---

## §3 — Slash Command Architecture

### 3.1 `CommandContext` adapter
Do NOT rewrite each command handler twice. Instead, introduce `src/utils/commandContext.js` which exports two classes — `MessageContext` and `InteractionContext` — both implementing the same interface:

```
ctx.userId          string — Discord ID of the invoking user
ctx.user            User object
ctx.guildId         string
ctx.guild           Guild object
ctx.channel         TextChannel
ctx.args            string[] — for prefix: tokens after the command; for slash: assembled from interaction options in declaration order
ctx.reply(opts)     message.reply() OR interaction.reply() / editReply() if deferred
ctx.editReply(opts) message.edit() OR interaction.editReply()
ctx.deferReply()    no-op for MessageContext; interaction.deferReply() for InteractionContext
ctx.isSlash         boolean
ctx.getMention(i)   User from ctx.args[i] (resolved from message.mentions for prefix; from interaction.options for slash)
```

Refactor every existing command handler to accept `(ctx, client)` instead of `(message, args, client)`. The `messageCreate` handler constructs a `MessageContext` and passes it down. The `interactionCreate` handler constructs an `InteractionContext`.

**Flag in your plan:** List every command file that uses `message`-specific APIs outside the ctx interface (e.g. `message.mentions`, component collectors scoped to a message ID, `message.react()`). Propose how each is handled — most button collectors just need `interaction.id` as the collector scope on the slash path.

**Middleware:** All existing middleware functions accept `ctx` after the refactor. The check logic is identical on both paths. Exception: the `bot_channel` middleware — on the slash path, reply with `{ content: '...', ephemeral: true }` so the error is private. On the prefix path, behavior is unchanged.

**Middleware bypass list** (unchanged): `register` and `create character` bypass the registration/character checks exactly as today. The bypass list must be checked by canonical command name, not by how the command was invoked (prefix or slash).

### 3.2 Slash definitions
Create `src/commands/slashDefinitions.js`. One `SlashCommandBuilder` per top-level command. Dev commands (`crd dev *`) have **no slash equivalent**.

| Prefix syntax | Slash command | Notes |
|---|---|---|
| `crd register` | `/register` | — |
| `crd create character` | `/create character` | subcommand |
| `crd profile [@user]` | `/profile user:[optional User]` | — |
| `crd stats` | `/stats` | — |
| `crd cred` | `/cred` | — |
| `crd bag` | `/bag` | — |
| `crd bag chests` | `/bag chests` | subcommand |
| `crd bag weapons` | `/bag weapons` | subcommand |
| `crd open [chest]` | `/open type:[string choices]` | choices: silver_chest, gold_chest, boss_treasure_chest, boss_golden_chest, supreme_chest, sacred_relic, supreme_relic |
| `crd equip [weapon_id]` | `/equip weapon_id:[string]` | — |
| `crd weapon info [weapon_id]` | `/weapon info weapon_id:[string]` | subcommand group |
| `crd enhance [weapon_id]` | `/enhance weapon_id:[string]` | — |
| `crd lock [weapon_id]` | `/lock weapon_id:[string]` | — |
| `crd unlock [weapon_id]` | `/unlock weapon_id:[string]` | — |
| `crd sell [target]` | `/sell target:[string]` | weapon_id, tier name, or "all" |
| `crd summon [count]` | `/summon count:[int choices: 1,5,10]` | optional; default 1 |
| `crd deity collection` | `/deity collection` | subcommand |
| `crd deity info [name]` | `/deity info name:[string]` | subcommand |
| `crd deity equip [name]` | `/deity equip name:[string]` | subcommand |
| `crd deity enhance [name]` | `/deity enhance name:[string]` | subcommand |
| `crd raid` | `/raid` | — |
| `crd duel @user` | `/duel user:[required User]` | — |
| `crd boss` | `/boss` | — |
| `crd bestow @user [amount]` | `/bestow user:[required User] amount:[required int]` | — |
| `crd daily` | `/daily` | — |
| `crd quests` | `/quests` | — |
| `crd coin toss [bet] [choice]` | `/coin-toss bet:[int] choice:[Aeternvm/Obscvrvm]` | — |
| `crd dice roll [bet] [choice]` | `/dice-roll bet:[int] choice:[Odd/Even]` | — |
| `crd baccarat [bet] [choice]` | `/baccarat bet:[int] choice:[Player/Banker]` | — |
| `crd blackjack [bet]` | `/blackjack bet:[int]` | — |
| `crd slot machine [bet]` | `/slot-machine bet:[int]` | — |
| `crd crash [bet]` | `/crash bet:[int]` | — |
| `crd admin setprefix [prefix]` | `/admin setprefix prefix:[string]` | subcommand |
| `crd admin setbotchannel [#ch]` | `/admin setbotchannel channel:[Channel]` | subcommand |
| `crd admin setannouncementchannel [#ch]` | `/admin setannouncementchannel channel:[Channel]` | subcommand |
| `crd admin setbosschannel [#ch]` | `/admin setbosschannel channel:[Channel]` | subcommand |
| `crd admin stats` | `/admin stats` | subcommand |
| `crd help [category?]` | `/help category:[optional string choices]` | — |

### 3.3 Deploy script
Create `scripts/deploy-commands.js`. It reads `CLIENT_ID` and `GUILD_IDS` (comma-separated list, for guild-scoped instant registration) from `.env`. If `GUILD_IDS` is not set, registers globally (takes up to 1 hour to propagate). Document in a `README` comment at the top of the script.

Add to `.env` documentation (do NOT modify the actual `.env` file — document what to add):
```
CLIENT_ID=<bot application ID from Discord Developer Portal>
GUILD_IDS=<comma-separated server IDs for fast dev registration, optional>
```

### 3.4 `interactionCreate` handler
Create `src/events/interactionCreate.js`. It:
1. Guards `if (!interaction.isChatInputCommand()) return`.
2. Constructs `InteractionContext`.
3. Runs the full middleware pipeline on `ctx`.
4. Routes to the same command handler the prefix path uses.
5. Wraps in try/catch — on uncaught error, calls `ctx.reply({ content: 'Something went wrong.', ephemeral: true })` (or `editReply` if already deferred).

For commands that render Canvas PNGs or run full battle loops, call `ctx.deferReply()` before the async work begins so Discord does not time out.

For button/component collectors inside commands (boss attack, bestow confirm, duel accept, casino CV2 buttons): scope the collector filter to the original `ctx.userId` as today, but use `interaction.id` (or `message.id` on prefix path) as the unique key suffix on custom_ids. The `InteractionContext` exposes `ctx.interactionId` for this.

---

## §4 — Alias Registry

Create `src/config/aliases.js`. A flat object `{ alias: 'canonical command string' }`. The `messageCreate` router checks this after stripping the prefix and before routing to command handlers.

```js
// src/config/aliases.js
module.exports = {
  // Account
  'reg':  'register',
  'cc':   'create character',
  'p':    'profile',
  // Battle
  'r':    'raid',
  'd':    'duel',
  // Gacha / Deities
  's':    'summon',
  'dc':   'deity collection',
  'di':   'deity info',
  'de':   'deity equip',
  'deh':  'deity enhance',
  // Inventory
  'b':    'bag',
  'bc':   'bag chests',
  'bw':   'bag weapons',
  'o':    'open',
  'eq':   'equip',
  'wi':   'weapon info',
  'enh':  'enhance',
  'lk':   'lock',
  'ulk':  'unlock',
  // Economy
  'bs':   'bestow',
  'q':    'quests',
  // Casino
  'ct':   'coin toss',
  'dr':   'dice roll',
  'bac':  'baccarat',
  'bj':   'blackjack',
  'sl':   'slot machine',
};
```

**Alias conflict note:** `s` → `summon` and `st` → nothing (stats has no alias; full word `stats` only). Confirm there is no existing alias already registered in the codebase before finalizing this map. Flag any conflicts in your plan.

---

## §5 — `crd help` Command

### 5.1 Embed design
Plain Discord embed (no Canvas). Uses Components V2 separator components between categories. Color: bot accent color (reuse the existing embed color constant). No dev commands shown to non-dev users. If `DEV_IDS.includes(ctx.userId)`, append a **🛠️ Developer** section at the bottom listing the `crd dev` sub-commands (one line summary each, no aliases for dev commands).

Footer: `Prefix: crd  •  Custom prefix: <guild prefix if different from crd, else "not set">  •  Also accepts / slash commands`

### 5.2 Categories and content

**⚔️ Account & Profile**
```
crd register  (reg)         — Create your Credd account
crd create character  (cc)  — Choose your class and begin
crd profile [@user]  (p)    — View full profile card
crd stats                   — View combat statistics
crd cred                    — Check your Credux balance
```

**🗡️ Battle**
```
crd raid  (r)               — Fight a random mob
crd duel @user  (d)         — Challenge another player
crd boss                    — View the current server boss
```

**🎰 Casino**
```
crd coin toss [bet]  (ct)   — Aeternvm or Obscvrvm (max 150k)
crd dice roll [bet]  (dr)   — Odd or Even (max 150k)
crd baccarat [bet]  (bac)   — Player or Banker (max 150k)
crd blackjack [bet]  (bj)   — Beat the dealer (max 150k)
crd slot machine [bet]  (sl)— Spin the reels (max 150k)
crd crash [bet]             — Cash out before it crashes (max 25k)
```

**🌟 Gacha & Deities**
```
crd summon [1/5/10]  (s)    — Invoke a deity (100 shards per pull)
crd deity collection  (dc)  — Browse your deity collection
crd deity info [name]  (di) — View deity info card
crd deity equip [name]  (de)— Equip a deity as your active blessing
crd deity enhance [name] (deh) — Enhance a deity with essence
```

**🎒 Inventory & Weapons**
```
crd bag  (b)                — View your bag overview
crd bag chests  (bc)        — Chest inventory
crd bag weapons  (bw)       — Weapon inventory
crd open [chest]  (o)       — Open a chest or relic
crd equip [weapon_id]  (eq) — Equip a weapon
crd weapon info [id]  (wi)  — View weapon info card
crd enhance [weapon_id] (enh)— Enhance a weapon
crd lock / unlock [id] (lk/ulk) — Lock or unlock a weapon
crd sell [id | tier | all]  — Sell weapon(s)
```

**💰 Economy**
```
crd bestow @user [amount] (bs) — Send Credux to another player
crd daily                   — Claim your daily reward
crd quests  (q)             — View today's daily quests
```

**⚙️ Admin** *(requires Manage Server)*
```
crd admin setprefix [prefix]         — Set a custom server prefix
crd admin setbotchannel [#channel]   — Restrict bot to a channel
crd admin setannouncementchannel [#] — Set announcement channel
crd admin setbosschannel [#channel]  — Set boss spawn channel
crd admin stats                      — Server activity summary
```

### 5.3 Category filter (optional sub-scope)
If the user passes a category keyword (`crd help casino`, `/help category:casino`), filter the embed to show only that category. Categories to recognize: `account`, `battle`, `casino`, `gacha`, `inventory`, `economy`, `admin`. If keyword not recognized, show the full help embed. Build this only if it does not expand scope significantly — flag if it does.

---

## §6 — Selftest Script

Create `scripts/help-selftest.js`. It must verify (statically, no DB, no Discord):
1. Every key in `aliases.js` maps to a known canonical command string (list of valid commands hardcoded in the selftest).
2. No two aliases resolve to the same canonical command (no duplicates).
3. Every non-dev command in the help text has an entry in `slashDefinitions.js`.
4. Every slash definition has a corresponding command handler export.

Run with `node scripts/help-selftest.js`. Output pass/fail per check. Exit code 1 on any failure.

---

## §7 — Files to Create / Modify

**New files:**
- `src/commands/help.js`
- `src/commands/admin.js`
- `src/config/aliases.js`
- `src/commands/slashDefinitions.js`
- `src/events/interactionCreate.js`
- `src/utils/commandContext.js`
- `scripts/deploy-commands.js`
- `scripts/help-selftest.js`

**Modified files (list is indicative — finalize in your plan):**
- `src/index.js` — startup prefix cache load; alias resolution in `messageCreate`; register `interactionCreate` event; load `slashDefinitions`
- `src/middleware/*.js` — accept `ctx` instead of `message`
- `src/commands/*.js` — all handlers: accept `(ctx, client)` instead of `(message, args, client)`

**In your plan: list every handler file by name with a one-line note on whether it uses any `message`-specific API that needs special handling in the ctx adapter (mentions, reactions, component collectors, etc.).**

---

## §8 — Smoke Test Checklist (I run these live after the build)

1. `crd help` — all categories render, no dev commands visible to a normal user; dev commands visible when running as a DEV_ID.
2. `crd help casino` — shows only the casino category.
3. Custom prefix: `crd admin setprefix c` → `c bag` opens the bag; `crd bag` still works.
4. Try `crd admin setprefix crd` → rejected with explanation.
5. Non-Manage-Server user tries `crd admin setprefix` → plain-text permission error.
6. `crd admin stats` → embed with player counts and avg level.
7. `node scripts/deploy-commands.js` → registers slash commands without error.
8. `/bag` → bag embed renders (slash path).
9. `/raid` → full battle flow runs to completion (slash path, deferReply working).
10. `/bestow @user 1000` → confirm button flow works (slash path).
11. `/admin setprefix c` (Manage Server user) → same result as prefix version.
12. Slash command sent outside bot_channel → ephemeral error only (not public).
13. `node scripts/help-selftest.js` → all checks pass, exit 0.

---

## §9 — Ambiguities to Flag Before Building

Flag any of the following before writing code:
- Whether `server_config` is already cached anywhere (bot_channel check in middleware).
- Whether any existing alias collision exists in the current codebase.
- Whether `CLIENT_ID` / `GUILD_IDS` are already in `.env` from a prior phase.
- Whether any command handler file currently uses `message.channel.send()` outside of `ctx.reply()` scope (e.g. for follow-up messages mid-battle) — these need individual treatment in the adapter.
- Whether the Components V2 separator component is available in the discord.js v14 version already in use (check `package.json`).

---

*End of Phase 11 Prompt*
*Companion docs: CREDD_Master_Export_v4_2.md · credd_schema_v4.sql · CREDD_Technical_Blueprint_v4.md · CREDD_Roster_and_Asset_Conventions.md*
