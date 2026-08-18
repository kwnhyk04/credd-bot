# Server Admin, Commands & Cooldowns

Credd is prefix-first with slash-command support. This document covers the admin commands
that configure a server, the complete alias table, every command cooldown, the middleware
gates that run before each command, and the help system.

The permanent prefix is `crd` and always works, even when a custom server prefix is set.

## What admin commands are there

Every admin sub-command requires the **Manage Server** permission. A non-admin gets a
plain-text error and nothing happens.

<!-- src: src/commands/admin.js:117 -->

| Command | Slash | Effect |
|---|---|---|
| `crd admin setprefix <prefix>` | `/admin setprefix prefix:` | Sets a custom server prefix |
| `crd admin setbotchannel <#channel\|off>` | `/admin setbotchannel channel:` | Restricts commands to one channel, or clears the restriction |
| `crd admin setannouncementchannel <#channel>` | `/admin setannouncementchannel channel:` | Currently limited to the official support server |
| `crd admin setbosschannel <#channel>` | `/admin setbosschannel channel:` | Currently limited to the official support server |
| `crd admin stats` | `/admin stats` | Server activity summary |

Examples:

```text
crd admin setprefix c
crd admin setbotchannel #bot-commands
crd admin setbotchannel off
crd admin stats
```

Without Manage Server: *"You need the **Manage Server** permission to use `crd admin`."*

## How do custom prefixes work

<!-- src: src/commands/admin.js:46 -->

| Rule | Value |
|---|---|
| Permanent prefix | `crd` — always accepted, in every server |
| Custom prefix length | 1 to 5 characters |
| Allowed characters | Letters and numbers only |
| Setting `crd` as the custom prefix | Rejected — it is already the permanent fallback |

Resolution order puts `crd` first: if a message starts with `crd` that always wins,
otherwise the guild's custom prefix is tried.

<!-- src: src/handlers/commandHandler.js:181 -->

## How does the bot-channel restriction work

Off by default. When set, commands outside that channel are refused with
*"Commands are restricted to <#channel>."*

Clearing accepts `off`, `none`, `clear` or `all`:

```text
crd admin setbotchannel off
```

## What does the admin stats command show

<!-- src: src/commands/admin.js:86 -->

| Field | Meaning |
|---|---|
| Registered players | Players with a character active in this server |
| Active (7 days) | Players active in the last seven days |
| Avg combat level (active) | Rounded average combat level of the last-seven-days group |

Boss combat stats use fixed authored roster values; this average is not used by boss spawning.

## Why are announcement and boss channels limited

Monster bosses are currently hosted in the official Credd support server only, so both
channel settings reply with a redirect to that server rather than applying.

<!-- src: src/config/officialSupport.js:23 -->

## What is the full command alias table

Aliases are expanded before routing, so `crd ct 500 heads` becomes
`crd coin toss 500 heads`.

<!-- src: src/config/aliases.js:16 -->

| Alias | Expands to |
|---|---|
| `reg` | `register` |
| `cc` | `create character` |
| `p` | `profile` |
| `r` | `raid` |
| `ar` | `auto raid` |
| `d` | `duel` |
| `s` | `summon` |
| `dc` | `deity collection` |
| `di` | `deity info` |
| `de` | `deity equip` |
| `deh` | `deity ascend` |
| `dec` | `deity echo` |
| `du` | `deity unequip` |
| `dp` | `deities` |
| `b` | `bag` |
| `bc` | `bag chests` |
| `bw` | `bag weapons` |
| `ba` | `bag armors` |
| `o` | `open` |
| `eq` | `equip` |
| `ei` | `equipment info` |
| `enh` | `enhance` |
| `lk` | `lock` |
| `ulk` | `unlock` |
| `cmp` | `compare` |
| `es` | `essence shop` |
| `ex` | `exchange` |
| `rb` | `rune bag` |
| `rn` | `runes` |
| `so` | `socket` |
| `uso` | `unsocket` |
| `lb` | `leaderboards` |
| `rk` | `ranked` |
| `rc` | `ranked claim` |
| `ps` | `pvp shop` |
| `t` | `title` |
| `g` | `cred` |
| `bs` | `bestow` |
| `q` | `quests` |
| `ct` | `coin toss` |
| `dr` | `dice roll` |
| `bac` | `baccarat` |
| `bj` | `blackjack` |
| `sl` | `slot machine` |
| `sm` | `slot machine` |

`sl` and `sm` both map to the slot machine — an intentional back-compat pair.

## What are the command cooldowns

Cooldowns are per user **per command**, so a raid cooldown never blocks a summon.

<!-- src: src/config/cooldowns.js:20 -->

| Command | Cooldown |
|---|---|
| `raid` | 15 seconds |
| `ranked` | 15 seconds |
| `duel` | 15 seconds |
| `coin` | 10 seconds |
| `dice` | 10 seconds |
| `baccarat` | 10 seconds |
| `blackjack` | 10 seconds |
| `slot` | 10 seconds |
| `crash` | 10 seconds |
| Everything else | 10 seconds (default) |

Raid, ranked and duel are deliberately longer for combat pacing.

Buttons are **not** cooldown-gated, so multi-step flows such as weapon enhancement and deity Ascension,
blackjack and crash are not throttled between clicks.

When on cooldown the bot replies with a live countdown, and on the prefix path it deletes
that notice automatically when the cooldown ends.

## What checks run before every command

<!-- src: src/handlers/middleware.js:86 -->

The middleware pipeline runs in this order on both the prefix and slash paths:

| Step | Check | Failure |
|---|---|---|
| 1 | Ban check | Silently blocked |
| 2 | Registration check | *"You are not registered. Use `crd register` to get started."* |
| 3 | Character check (if the command requires one) | *"You don't have a character yet. Use `crd create character` to get started."* |
| 4 | Bot-channel restriction (if configured) | *"Commands are restricted to <#channel>."* |
| 5 | Per-command cooldown | *"You're on cooldown — ready <relative time>."* |
| 6 | Activity tracking upsert | Never blocks |

Steps 1 to 3 are resolved with a single database query so the slash path stays inside
Discord's three-second acknowledgement window.

The ban check fails **closed**: on a database error it blocks rather than letting a write
through.

## How does the help command work

<!-- src: src/commands/help.js:24 -->

| Command | Slash | Argument |
|---|---|---|
| `crd help [category]` | `/help [category:]` | Optional category keyword |

Categories: `account`, `battle`, `ranked`, `gacha`, `casino`, `inventory`, `runes`,
`supporter`, `economy`, `admin`. An unknown keyword shows the full reference.

Examples:

```text
crd help
crd help casino
```

The help embed footer shows the permanent prefix, the server's custom prefix (or "not
set"), and a note that slash commands are also accepted.

There is no developer section in help — developer commands are internal tooling and never
appear in the public reference.

## Which commands are prefix-only

Some systems have no slash equivalent and must be used with the prefix.

<!-- src: src/commands/slashDefinitions.js:1 -->

| System | Prefix-only commands |
|---|---|
| Ranked and idle | `crd auto raid`, `crd ranked`, `crd ranked claim`, `crd leaderboards`, `crd pvp shop`, `crd pvp buy`, `crd title` |
| Runes | `crd socket`, `crd unsocket`, `crd rune bag`, `crd runes`, `crd essence shop`, `crd exchange` |
| Supporter | `crd shop supporter`, `crd buy`, `crd skin collection`, `crd use skin`, `crd set all skin default` |
| Inventory extras | `crd use <id>`, `crd shop buy`, `crd compare`, `crd bag armors`, `crd bag items` |
| Deity extras | `crd deity echo`, `crd deity unequip`, `crd deities` |
| Presets | `crd preset`, `crd equip preset <1\|2>` |

## Where can I get help or report a problem

Credd has an official support server, which is also currently the only place monster
bosses spawn. The invite is surfaced by the bot itself whenever a boss-related command is
used outside that server.

<!-- src: src/config/officialSupport.js:4 -->

## Which commands are available as slash commands

<!-- src: src/commands/slashDefinitions.js:26 -->

`/register`, `/create character`, `/profile`, `/stats`, `/avatars`, `/avatar`, `/cred`,
`/bag`, `/open`, `/equip`, `/equipment info`, `/enhance`, `/lock`, `/unlock`, `/sell`,
`/summon`, `/deity`, `/glossary`, `/coin toss`, `/dice roll`, `/baccarat`, `/blackjack`,
`/slot machine`, `/crash`, `/raid`, `/duel`, `/boss`, `/bestow`, `/daily`, `/quests`,
`/admin`, `/help`.

Slash commands use named options rather than free text — `/summon count:10` rather than
`crd summon 10` — but they route into exactly the same handlers.
