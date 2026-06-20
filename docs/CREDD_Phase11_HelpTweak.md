# Phase 11 — Help Embed Render Tweak (build-direct)

## What to fix

**1. Font size / description density**
Reduce the font size of all command lines in the help embed so more commands fit without wrapping. Reference: Image 2 (owo bot) — compact, small-font, all commands readable on one screen. Target the same density.

**2. Remove Developer section entirely**
The Developer section must not appear at all — not for any user, not for DEV_IDS. Strip it from `help.js` completely. Dev commands are internal tooling; they have no place in the public help embed.

**3. Rewrite command descriptions — shorter + add choice hints inline**
Replace the current verbose descriptions with the condensed format below. The alias goes at the end in parentheses. No max-bet shown in the description line (keep the embed clean).

Use this exact copy for each category:

**⚔️ Account & Profile**
```
crd register  (reg)              — Create your account
crd create character  (cc)       — Choose your class
crd profile [@user]  (p)         — View profile card
crd stats                        — Combat statistics
crd cred  (g)                    — Check Credux balance
```

**🗡️ Battle**
```
crd raid  (r)                    — Fight monsters
crd duel @user  (d)              — Challenge a player
crd boss                         — View server boss
```

**🎰 Casino**
```
crd coin toss [bet] heads/tails  (ct)    — Coin Toss
crd dice roll [bet] odd/even  (dr)       — Odd or Even
crd baccarat [bet] player/banker  (bac)  — Player or Banker
crd blackjack [bet]  (bj)                — Beat the dealer
crd slot machine [bet]  (sl/sm)          — Spin the reels
crd crash [bet]                          — Cash out before it crashes
```

**🌟 Gacha & Deities**
```
crd summon [1/5/10]  (s)         — Invoke a deity (100 shards/pull)
crd deity collection  (dc)       — Browse your collection
crd deity info [name]  (di)      — Deity info card
crd deity equip [name]  (de)     — Equip a deity
crd deity enhance [name]  (deh)  — Enhance a deity
```

**🎒 Inventory & Weapons**
```
crd bag  (b)                         — Bag overview
crd bag chests  (bc)                 — Chest inventory
crd bag weapons  (bw)                — Weapon inventory
crd open [chest]  (o)                — Open a chest or relic
crd equip [weapon_id]  (eq)          — Equip a weapon
crd weapon info [id]  (wi)           — Weapon info card
crd enhance [weapon_id]  (enh)       — Enhance a weapon
crd lock / unlock [id]  (lk/ulk)     — Lock or unlock a weapon
crd sell [id | tier | all]           — Sell weapon(s)
```

**💰 Economy**
```
crd bestow @user [amount]  (bs)  — Send Credux to a player
crd daily                        — Claim daily reward
crd quests  (q)                  — View daily quests
```

**⚙️ Admin (requires Manage Server)**
```
crd admin setprefix [prefix]          — Set a custom server prefix
crd admin setbotchannel [#channel]    — Restrict bot to a channel
crd admin setannouncementchannel [#]  — Set announcement channel
crd admin setbosschannel [#channel]   — Set boss spawn channel
crd admin stats                       — Server activity summary
```

## No other changes
Do not touch routing, middleware, aliases, slash definitions, or any other file. This is `help.js` only.
