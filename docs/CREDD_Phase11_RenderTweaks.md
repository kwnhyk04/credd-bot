# Phase 11 — Render Tweaks Batch (build-direct)

Three independent changes. Touch only the files listed per section.

---

## Tweak 1 — Help embed format rewrite (`src/commands/help.js` only)

### Target format
Each command entry uses this exact two-line layout:

```
crd register (reg) :
— Create your account

crd create character (cc) :
— Choose your class

crd stats :
— Combat statistics
```

Rules:
- Command + alias(es) on line 1, ending with ` :`
- Description on line 2, starting with `— `
- One blank line between each entry (Discord renders the line break as spacing)
- All text inside a single code block per category (triple-backtick), so it renders as monospace at Discord's default code font size (~12px) — no custom font size needed; code blocks are inherently compact and readable
- Category headers stay outside the code block as bold emoji labels
- Separators (CV2 separator components) between categories unchanged

### Full copy (exact text, no deviations)

**⚔️ Account & Profile**
```
crd register (reg) :
— Create your account

crd create character (cc) :
— Choose your class

crd profile [@user] (p) :
— View profile card

crd stats :
— Combat statistics

crd cred (g) :
— Check Credux balance
```

**🗡️ Battle**
```
crd raid (r) :
— Fight monsters

crd duel @user (d) :
— Challenge a player

crd boss :
— View server boss
```

**🎰 Casino**
```
crd coin toss [bet] heads/tails (ct) :
— Coin Toss

crd dice roll [bet] odd/even (dr) :
— Odd or Even

crd baccarat [bet] player/banker (bac) :
— Player or Banker

crd blackjack [bet] (bj) :
— Beat the dealer

crd slot machine [bet] (sl/sm) :
— Spin the reels

crd crash [bet] :
— Cash out before it crashes
```

**🌟 Gacha & Deities**
```
crd summon [1/5/10] (s) :
— Invoke a deity (100 shards/pull)

crd deity collection (dc) :
— Browse your collection

crd deity info [name] (di) :
— Deity info card

crd deity equip [name] (de) :
— Equip a deity

crd deity enhance [name] (deh) :
— Enhance a deity
```

**🎒 Inventory & Weapons**
```
crd bag (b) :
— Bag overview

crd bag chests (bc) :
— Chest inventory

crd bag weapons (bw) :
— Weapon inventory

crd open [chest] (o) :
— Open a chest or relic

crd equip [weapon_id] (eq) :
— Equip a weapon

crd weapon info [id] (wi) :
— Weapon info card

crd enhance [weapon_id] (enh) :
— Enhance a weapon

crd lock / unlock [id] (lk/ulk) :
— Lock or unlock a weapon

crd sell [id | tier | all] :
— Sell weapon(s)
```

**💰 Economy**
```
crd bestow @user [amount] (bs) :
— Send Credux to a player

crd daily :
— Claim daily reward

crd quests (q) :
— View daily quests
```

**⚙️ Admin (requires Manage Server)**
```
crd admin setprefix [prefix] :
— Set a custom server prefix

crd admin setbotchannel [#channel] :
— Restrict bot to a channel

crd admin setannouncementchannel [#] :
— Set announcement channel

crd admin setbosschannel [#channel] :
— Set boss spawn channel

crd admin stats :
— Server activity summary
```

No developer section. No max-bet lines. No other changes to this file.

---

## Tweak 2 — `crd profile` renders image only, no embed (`src/commands/rpg/profile.js` only)

Currently `crd profile` sends the canvas PNG inside a Discord embed. Change it to send the PNG as a plain message attachment with no embed wrapper — just the image, nothing else. No title, no description, no footer, no color bar. The image speaks for itself (see reference screenshot).

Implementation:
```js
// Replace the current embed send with:
await ctx.reply({ files: [{ attachment: canvasBuffer, name: 'profile.png' }] });
```

That's the only change to this file. The canvas render itself is untouched — same artwork, same layout, same stats. Only the Discord message wrapper changes.

---

## Tweak 3 — Raid intro message (`src/commands/rpg/raid.js` only)

Before the raid battle embed renders, send a single plain-text intro message (not an embed) that names the mob the player is about to fight. Two variants based on mob type:

**Regular mob:**
> You ran into the territory of **{mob name}**...

**Elite mob:**
> ⚠️ You ventured too deep — **{mob name}** emerges from the shadows...

Rules:
- Send this as a plain message (`ctx.reply` or `ctx.channel.send`) immediately before the existing battle embed render.
- The mob name comes from the same mob object already resolved during raid setup — no extra DB query.
- No image, no embed, no components — plain text only.
- The battle embed that follows renders exactly as it does today (no changes to `battleRender.js` or the raid engine).
- Keep the 25s cooldown on the raid command as a whole (unchanged).

# Phase 11 — Addendum: Boss Damage Audit + Greater Boss HP Mechanic

Append to the current phase. Tweak 1–3 from the previous prompt proceed as-is. These two items are added below.

---

## Item 4 — Boss Damage Audit (PLAN-FIRST, stop before fixing)

**Observed symptom:** Boss has ~1,200 ATK but deals only ~400 damage to the player per hit. Player has 500–700 ATK and deals *more* damage to the boss. The asymmetry is wrong — 400 from 1,200 ATK implies ~67% damage reduction on the player side, which is far too high unless a bug exists in the boss→player damage path.

**Do not touch any engine file yet.** First, audit and report:

1. Trace the full damage formula for a boss attack on the player through `resolveBattle.js` and `statAssembly.js`. Show the exact computed values at each step using the defense stack order from §35/R3:
   > negation → % reduction → additive → Knight×0.80 → dwarf absorb → reflect on final dmg

2. Confirm whether boss ATK is being read from `statAssembly` correctly (should be `base_atk + atk_per_level × level`, same as C1 ruling).

3. Check if the player's DEF is being double-applied or applied in the wrong order on the boss→player hit path vs the player→boss hit path. The fact that the player deals *more* damage going the other direction is the red flag — it suggests DEF computation may differ between the two directions.

4. Check if `enemy_bonus_damage` (R4: once per round) is firing correctly for boss attacks and whether the boss is even hitting with correct base values before any reductions.

5. Report the formula trace with example numbers from the game_logs (use `crd dev battle` with a known boss if needed). Do NOT change any engine file until you show me the audit and I confirm the fix.

**This is plan-first. Show the audit, stop, wait for approval.**

---

## Item 5 — Greater Boss HP tied to chest roll (PLAN-FIRST, stop before building)

**Current behavior:** Greater Bosses (Jötunn, Fenrir, Fafnir, Hydra, Cerberus) spawn with a flat **2× HP** multiplier regardless of which chest was rolled.

**New behavior:** The HP multiplier is determined by the chest rolled at spawn (which is already stored in `boss_state` since it's shown in the announcement):

| Chest rolled at spawn | Spawn weight | HP multiplier |
|---|---|---|
| 2× Treasure Chest | 80% | **2× HP** (unchanged) |
| 1× Golden Chest | 20% | **3× HP** (new) |

So the golden chest variant is rarer *and* tankier — higher risk, higher reward.

**Schema is FROZEN.** Do not add columns. The chest type is already persisted in `boss_state` — derive the HP multiplier from it at spawn time and at any point where the boss HP pool is read or displayed.

**Plan required before building:**

1. Confirm exactly which field in `boss_state` stores the chest type (show the column name and the value format it stores today).
2. Show where the current `2× HP` multiplier is applied in the boss spawn code — that is the only location that changes.
3. Confirm the HP multiplier is applied only once at spawn (when `max_hp` is written to `boss_state`) so the change is a single write-time adjustment, not a runtime recalculation on every attack.
4. Confirm the announcement render already shows the chest type — the player can already see which chest was rolled, so the 3× HP on golden is self-explanatory from the announcement.
5. No change to chest payout amounts, spawn weights, or any other boss mechanic.

**Stop after the plan. Wait for approval before writing code.**


---

## Nothing else changes
Do not touch: schema, engine files, middleware, slash definitions, aliases, casino commands, or any file not listed above.
