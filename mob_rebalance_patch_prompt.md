# PATCH — Mob Rebalance + Battle Render Tweaks + Deprecation Fix

Build-direct patch (no plan gate needed), EXCEPT item 1 produces a SQL script I run myself — your sandbox cannot reach the DB. Do not touch: schema DDL, summonEngine.js, casino, .env. Branch is `master`.

Context: regular mobs are too easy and there's no margin between regular and elite. Elites should require great weapons + an active deity blessing to beat — that's the grind incentive. Drops are raised to compensate.

---

## 1. Mob roster rebalance (SQL script — I run it, you write it)

Ship `scripts/patch_mob_rebalance.sql` containing exactly this logic (verify column names against the seeds in the repo before finalizing):

```sql
-- Regular mobs: +80 base ATK, +50 base DEF; per-level HP 20→40, ATK 8→15, DEF 5→10
UPDATE mob_roster
SET base_atk = base_atk + 80, base_def = base_def + 50,
    hp_per_level = 40, atk_per_level = 15, def_per_level = 10
WHERE mob_type = 'regular';

-- Elite mobs: +100 base ATK, +100 base DEF; per-level HP 38→75, ATK 10→30, DEF 8→16
UPDATE mob_roster
SET base_atk = base_atk + 100, base_def = base_def + 100,
    hp_per_level = 75, atk_per_level = 30, def_per_level = 16
WHERE mob_type = 'elite';

-- Bosses untouched.
```

Base HP values do NOT change — only ATK/DEF bases and the three per-level columns. Also update the in-repo seed file for mob_roster (if present) so a fresh seed matches the live DB after my patch. No other roster touched.

## 2. Spawn rate 75/25 → 80/20

The common/elite spawn roll becomes 80% regular / 20% elite. Update it in the `crd dev battle` random-spawn path now (currently 75/25), and anywhere the constant is defined so Phase 7's raid command inherits 80/20 automatically. Single named constant preferred (e.g. `ELITE_SPAWN_CHANCE = 0.20`).

## 3. Raid loot rescale (constants/spec — raid command is Phase 7)

New loot table (only the changed cells; Credux, EXP, gold chest unchanged):

| Source | Belief Shards | Chest |
|---|---|---|
| Mob win | **3–5 (100%)** (was 1–3 ~50%) | **Silver ~30%** (was ~50%) |
| Elite win | **8–10 (~100%)** (was 3–5) | Gold ~30% (unchanged) |

If a loot constants file already exists, update it; if not, create the constants where Phase 7 will consume them (e.g. `config/raidLoot.js`) with the FULL §13 table (Credux 100–500 / 600–1,000, EXP 100–200 / 300–500 / loss 50/150, shards and chests as above) so Phase 7 reads config, not the doc. The Master doc copy has already been patched on my side — update the in-repo copy of CREDD_Master_Export_v4.md too if one exists (§13 spawn rates, §13 scaling, §13 loot table, §15 mob tables, §35.6 mob scaling line).

## 4. battleRender: weapon emoji from game_items.txt

The player card currently renders a generic ◆ glyph next to the weapon name. Replace it with the weapon's actual custom emoji from `game_items.txt`:

- Parse `game_items.txt` for the weapon → emoji mapping (custom emoji format `<:name:id>`; extract the numeric ID).
- In canvas, draw the emoji image fetched from `https://cdn.discordapp.com/emojis/<id>.png` at the glyph's position, sized to the text line. Cache fetched images in-memory (Map keyed by emoji ID) — never re-fetch per frame/battle.
- Fallback: if the weapon has no mapping or the fetch fails, keep the current ◆ glyph. Never crash the render over a missing emoji.
- Same treatment for the deity/blessing glyph ONLY if game_items.txt has deity emoji too; otherwise leave it.
- Your sandbox can't fetch the CDN — code it, validate statically, I verify live.

## 5. battleRender: rewards footer slot

Add an optional `rewards` field to the render input. When present, render it at the bottom of the card below a horizontal separator line (drops listed inline, e.g. `💰 342 Credux · ✨ 156 EXP · 🔮 4 Shards · 🗝️ Silver Chest`). Dev battle passes nothing (keeps showing "No rewards granted." in the message text as now). Phase 7's raid command will pass actual drops — this patch just builds the slot.

## 6. Remove the Replay button

Battle Log stays; Replay button and its handler are removed entirely (component row, collector branch, any replay state). The seed still prints in the dev battle output for reproduction.

## 7. discord.js deprecation: ephemeral → flags

The bot logs `(node:5888) Warning: Supplying "ephemeral" for interaction response options is deprecated. Utilize flags instead.` Sweep the ENTIRE codebase: every `ephemeral: true` in `reply` / `followUp` / `deferReply` / `update` / `showModal`-adjacent options becomes `flags: MessageFlags.Ephemeral`, importing `MessageFlags` from discord.js where missing. If an options object already has a `flags` value, combine with bitwise OR. Grep `ephemeral` afterward — zero remaining occurrences except comments. Do not change any reply from ephemeral to public or vice versa.

---

## EXIT CRITERIA

1. `node scripts/battle-selftest.js` still passes clean — update any harness fixtures/expected values that hardcoded the OLD mob scaling (e.g. the C1 level-formula spot checks), but do not weaken invariants.
2. `grep -rn "ephemeral" src/` shows no remaining option usages.
3. Report: files changed, the final SQL script, and confirmation of which loot constants file Phase 7 should read.
4. STOP after static validation. I will: run the SQL in Supabase, restart, then live-test `crd dev battle` (emoji render, no Replay button, 80/20 spawn over several runs, elite difficulty feel) and one ephemeral reply path.
