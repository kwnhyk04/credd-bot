# PHASE 7 — RAID, DUEL & BOSS ORCHESTRATION

I'm building **Credd — The Last Believer**, a Discord RPG bot (discord.js v14 + PostgreSQL/Supabase) in a phased build, one phase per session. Phases 1–6 are done, committed on branch `master`, and live-tested: foundation/middleware, register/profile, bag/open/equip, deity gacha, weapon enhance/lock/sell, and — most recently — **Phase 6: the pure battle engine** (`src/engine/battleEngine.js`, `statAssembly.js`, refactored `passiveRegistry.js`, `battleRender.js`, seeded-RNG selftest harness, and a `crd dev battle` command).

**Before planning anything, read and understand these, in this order:**
1. `CREDD_Master_Export_v4_v3.md` — the game design source of truth. §13 (raid), §13.1 (conflict rules), §14 (duel), §16 (boss), §17 (leveling), §35 (authoritative battle timing/stats — it WINS on any conflict with older sections).
2. `credd_schema_v4.sql` — the DB. **Schema is FROZEN. Never ALTER/CREATE tables.** Pay attention to `active_battles`, `boss_state`, `boss_attack_log`, `users.last_boss_attack_date`, `user_guild_activity`, `game_logs`.
3. `ENGINE_HOOKS.md` + `src/engine/*` — the Phase 6 engine you are building on. `resolveBattle(fighterA, fighterB, {mode, seed})` is pure (no DB/Discord/Math.random); `statAssembly.buildPlayerFighter / buildMobFighter` produce fighters; `battleRender.js` renders the sim (it already has the optional `rewards` footer slot with separator, weapon-emoji rendering, and Battle Log button — Replay was removed). `sim.totals.netDamage` exists specifically for the Hydra/boss shared-pool rule.
4. `config/raidLoot.js` (or wherever the loot constants landed in the rebalance patch) and the dev command suite under the existing pattern.

**Workflow: this is a money/logic phase. PLAN FIRST, then STOP for my review before writing any code.** Your plan must list every file created/changed, every SQL statement template, all reward/EXP math with §-references, and any deviation from this prompt with a reason.

**DO NOT TOUCH:** schema DDL, seeds, `summonEngine.js`, casino, `.env`, the engine internals (`battleEngine.js` / `passiveRegistry.js` — consume them, don't modify; if you believe an engine change is required, STOP and say why). Keep `// TODO Phase-rep` markers; reputation/daily-quest progress hooks are DEFERRED — add `// TODO Phase-rep` comments at the hook points (raid wins, elite defeats, duel wins/challenges), do not implement them.

---

## SCOPE 1 — `crd raid` / `crd r` (§13)

- 10s per-command cooldown via existing middleware; one live battle per user (`active_battles` UNIQUE on discord_id — reject with a plain-text error if a row exists).
- Spawn: 80/20 regular/elite (the shared constant from the rebalance patch); equal chance within category; `is_available = TRUE` rosters only. Mob level = player level + random(−5..+5), clamp [1,55]. Stats via `buildMobFighter` (base + per_level × level).
- Resolve with the engine (fresh random seed), then animate: post the battleRender card and edit it every 2–3 rounds through the snapshots until the final state (§13 embed layout; victory gold "🏆 Victory!" / defeat red "💀 Defeated!"). Battle Log button after it ends.
- `active_battles` policy: INSERT at battle start (battle_type 'raid', channel/message ids, hp fields), DELETE on completion. The existing 60s battleReaper clears stale rows (crashed mid-animation) — verify its deletion criteria match and adjust the reaper if needed.
- Loot from the loot config (Credux 100–500 / 600–1,000; combat EXP 100–200 / 300–500, loss 50/150; shards 3–5 @100% / 8–10 @~100%; silver ~30% / gold ~30%). **Drops render in the card footer below a separator** via battleRender's `rewards` slot. Losses still show the consolation EXP line.
- Award atomically: credux → users_bag, shards → users_bag, chest → users_bag counts, EXP → shared `awardCombatExp` util (NEW, see Scope 4). One `game_logs` row per currency/item changed, before/after balances, action 'Raid'.
- Win/loss counters: update whatever the schema provides on `user_character` (check the actual columns — don't invent any).

## SCOPE 2 — `crd duel @user` (§14)

- Challenge embed; ONLY the challenged user can ⚔ Accept / 🏃 Decline; 60s expiry → "challenge expired" edit. Challenged user must pass the same middleware gates (registered, character, not banned, no live battle).
- On accept: both fighters via `buildPlayerFighter`, engine mode 'duel' (instakill disabled engine-side; two perspectives — already built in Phase 6). 50/50 first-roll. Animate same as raid, §14 layout (P1 top / P2 bottom), Battle Log button.
- **Entirely in-memory** (schema comment: duels are NOT stored in active_battles) — but block dueling while either party has a live raid/boss row. NO rewards, no EXP of any kind, no loot, no game_logs currency rows (§14: purely friendly). Round-50 tie → challenged player wins (§35.3).

## SCOPE 3 — BOSS SYSTEM (§16, with my v4.1 layout changes below)

### Spawning (scheduler)
- One active boss per guild (`boss_state`, PK guild_id). New scheduler tick: if no row or status dead/escaped for ≥15 min → spawn: random `mob_type='boss'` row (is_available), level = server average player level (registered players via `user_guild_activity`, per §16 note) + random(1–10), scaled stats per §16 formulas, write boss_state (new spawn_id, **expires_at = spawn_at + 2 HOURS** — the Master is updated to 2h; the old "+1 hour" comment in the schema file is stale, ignore it), post the announcement in the configured bot channel.
- Expiry tick: past expires_at while active → status 'escaped', no rewards, final-edit the live message ("escaped" state).

### Spawn announcement message — **Discord Components V2** (this is the layout, follow it exactly)
Use a Components V2 container (`MessageFlags.IsComponentsV2`; requires discord.js ≥14.19 — we're on it):
1. **Header text** — mythology-themed spawn line + boss identity. Use these (pick per boss mythology, boss name bolded, plus level):
   - PH: `🌒 An old terror of the islands stirs… **{Boss}** has risen! (Lv {level})`
   - Norse: `❄️ The Nine Realms tremble… **{Boss}** descends! (Lv {level})`
   - Greek: `⚡ A legend wakes from myth… **{Boss}** emerges! (Lv {level})`
2. **Boss image, centered** — MediaGallery with `/assets/monsters/boss/<boss_slug>.png`. Slug rule = Roster & Asset Conventions Part 1 (lowercase, strip diacritics, non-alphanumerics → `_`). `mob_roster` has NO image column (schema frozen) — derive the filename from the name by convention; if the file is missing, omit the gallery gracefully, never crash. Check wildcard of bossname vs filename in the directory.
3. **Separator**
4. **Participation rewards if defeated:** one line per reward, each with its emoji icon (use the game_items.txt emoji where one exists, unicode fallback):
   - 💰 Credux ×100,000  *(per §16 — flagged to the owner; remove only if he says so)*
   - ✨ Combat EXP ×100,000
   - 🗝️ Boss Treasure Chest ×1
   - 🔮 Belief Shards ×1,000
5. **Separator**
6. **Damage leaderboard** — title `🏆 Top 15 Damage — out of {count} challengers`, then up to 15 rows: `#{rank} · <@id> · {damage}` (from `boss_attack_log` for this spawn_id, ordered by total_damage DESC). Plus the boss HP bar + `current_hp / max_hp` of the shared pool in this block.
7. **Separator**
8. **Footer** — `Disappears <t:{expires_at_unix}:R>` (Discord relative timestamp = auto-counting, no edits needed) — plus the buttons row: **⚔️ Attack** and **📋 Log**.

### Attack flow (the core money/logic path — be exact)
On ⚔️ Attack press:
1. Gates in order, each failing with an ephemeral plain-text error: registered + character → not banned → boss still 'active' and not expired → **global daily lock**: `users.last_boss_attack_date` ≠ today (PHT — same reset clock as the midnight scheduler) → not already attacked THIS spawn (`boss_attack_log` UNIQUE (boss_spawn_id, discord_id)) → no live `active_battles` row.
2. Build the player via statAssembly; boss fighter from boss_state's scaled snapshot + live `base_crit` from mob_roster (DB-8). Resolve with the engine in boss mode — shared-pool % supplied as the engine's boss-pool input (the Phase 6 hades fix); player fights until death or round-50 "timeout, survived"; **damage committed = `sim.totals.netDamage`** (Hydra local regen excluded).
3. Atomic commit (single transaction): `UPDATE boss_state SET current_hp = GREATEST(current_hp - $net, 0) WHERE guild_id = $g AND spawn_id = $s AND status = 'active' RETURNING current_hp` → INSERT boss_attack_log row → SET users.last_boss_attack_date = today. If the RETURNING shows the boss was already dead (or the spawn_id changed), roll back and tell the user the boss just fell. INSERT an active_battles 'boss' row at step-2 start and DELETE it here, so the reaper covers crashes.
4. **NO new battle message** (this is the deliberate difference from raid): instead, EDIT the live boss message in place — updated HP bar/pool, updated Top-15, updated challenger count. Give the attacker an **ephemeral** ack: `You dealt {net} damage to {Boss}! Tap 📋 Log for the blow-by-blow.`
5. **📋 Log** button: ephemeral, shows the pressing user's OWN battle log for this spawn (store each attacker's sim log in memory keyed by spawn_id+userId; if they haven't attacked: "You haven't attacked this boss yet."). Logs don't need to survive a restart.

### Live-message management (schema has no message pointer — by design, keep it in memory)
- Hold `{channelId, messageId}` per guild in an in-memory Map, set on spawn announcement.
- Every update path (attack, defeat, escape) edits via fetched message ID. **If the edit/fetch fails for any reason** (message deleted, unknown, missing ref after a restart): post a FRESH boss status message (same CV2 layout, current data) in the bot channel and repoint the Map — this satisfies "attacked on an expired message → automatically produce a new message."
- **`crd boss` command**: re-displays the current boss status (same layout, fresh data) and makes THAT message the new live/tracked one. If no active boss: state it plainly and show when the next spawn check lands. This is the recovery path for scrolled-away/stale messages and restarts.

### Defeat
Pool hits 0 → status 'dead'; final-edit the live message to a defeated state (keep the final Top-15 visible); distribute participation rewards to EVERY attacker of this spawn_id — Credux 100,000 + Combat EXP 100,000 (via awardCombatExp) + 1 Boss Treasure Chest + 1,000 Belief Shards each, with game_logs rows per §16 (participation-only, NO top-damage bonus); post a defeat announcement crediting the server. All reward writes idempotent per (spawn_id, user) — a crash mid-distribution must not double-pay on retry (plan how).

## SCOPE 4 — Shared `awardCombatExp` util (NEW)

`src/utils/awardCombatExp.js`: adds combat EXP per §17 (read the leveling curve from the doc — do NOT invent numbers), handles multi-level-ups in one award, respects the level cap, persists to user_character, returns `{levelsGained, newLevel}` so callers can append a "⬆️ Level up!" line. Used by raid and boss. **Combat EXP is completely separate from Reputation EXP** — do not touch `awardReputation`/summonEngine.js.

---

## DELIVERABLES FOR THE PLAN (then STOP)

1. File-by-file change list; the boss scheduler design (tick cadence, race-safety if two guilds/ticks overlap); the exact SQL for the atomic boss commit and reward distribution with the idempotency strategy.
2. Reward/EXP math table with §-references; the CV2 component tree for the boss message; how snapshots drive the raid/duel edit cadence.
3. Edge-case ledger: boss dies between gate-check and commit; two users attacking simultaneously; restart mid-spawn (Map empty); duel challenge to a user mid-raid; reaper vs animating raid; expired boss attacked; missing boss PNG.
4. What you'll cover in the selftest/static checks (engine untouched, so the Phase 6 harness must still pass unmodified).
5. Read the plan about boss in config, the damage tick is about self user instance to avoid Hydra being unkillable, the plan also includes attack and deduct to boss HP check per turn in database to get updated HP in the instance of hundreds to thousands of users attacked at the same time. Check if this plan is conserved.

I review the plan, then you build. After build: static validation only — I run the bot live, drop the boss PNGs into `/assets/monsters/boss/`, and smoke-test raid, duel, a full boss spawn→attack→`crd boss`→defeat/escape cycle myself.
