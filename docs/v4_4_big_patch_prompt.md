# BIG PATCH — Profile polish · Dynamic weapon stats · Greater Bosses · Boss-art check

Continuing **Credd — The Last Believer**. Phases 1–9 committed and live-tested. This is a four-part patch. Re-read if context is thin: the existing canvas renderers (profile/`renderBagItems`/`renderQuestRows` for font/emoji-cache conventions), `src/engine/statAssembly.js` + weapon-stat roll code (Phase 3), `src/engine/bossSystem.js` + `bossScheduler.js` (Phase 7), and `game_items.txt` (custom emoji map).

**Mostly render + data/config + two SQL scripts I run myself — build-direct, NO plan gate.** Untouchable: schema DDL, summonEngine.js, casino, .env, engine combat internals, `// TODO Phase-rep` markers. Branch `master`. **Do NOT edit the design doc in my uploads — instead patch the root-folder copy of `CREDD_Master_Export_v4.md` in the repo** with every change below, tagged `[v4.4]`.

---

## 1. `crd profile` Canvas tweaks (Screenshot reference: current profile render)

All in the profile renderer. Keep the same layout skeleton; change these:

- **Header EXP → Combat EXP, no bar, with icon:** The header currently shows a Believer EXP bar — leave the BELIEVER section as-is. The change is in the BODY: replace the combat-exp bar line with a single text line: `{combat_exp_icon} Combat EXP: {current} / {needed}`. Remove the combat-exp progress bar entirely. Use the combat-exp emoji icon (from game_items.txt if one exists; else a fitting unicode like ✨) before the label.
- **"Active Deity Blessing:" → "Active Deity:"** and restructure to mirror the weapon block:
  ```
  Active Deity:
  {deity_emoji} {Deity Name} +{enhance>0}
  Blessing: {blessing_name}
  ```
  Deity emoji on the left before the name (same treatment as the weapon line — pull from game_items.txt, unicode/none fallback). The blessing name moves to its own `Blessing:` line.
- **Character Stats — per-stat emoji icons:** prefix each stat with a fitting icon, e.g. `⚔️ ATK {n}   ❤️ HP {n}   🛡️ DEF {n}   💥 CRIT {n}%` (use game_items.txt icons where the game already has them, otherwise these unicode picks; keep the existing stat colors). Keep them on one line if they fit, else wrap cleanly.
- **Records block — add the words "Combat Record" as a section heading and lower its font size:** add a `Combat Record` label above the boxed cells (matching the screenshot-1 styling you liked), and reduce the heading + cell-label font sizes so the block reads tighter / less oversized.

Everything else in the profile (Believer header, avatar, weapon block, separators, footer quote) stays. Visual-only — no stat-source logic change; totals still come from the engine stat-assembly path.

## 2. Dynamic weapon stats — new roll ranges (NEW DROPS ONLY)

Update the weapon-stat roll table (the Phase-3 roll used when a weapon is **first created/dropped**). New Min/Max per tier:

| Tier | ATK | HP | DEF | CRIT | Bonus |
|---|---|---|---|---|---|
| Rare | 100–150 | 100–200 | 50–75 | 1–5% | — |
| Mythic | 200–350 | 300–400 | 80–150 | 1–5% | — |
| Legendary | 500–600 | 600–800 | 200–300 | 1–5% | 25% chance on drop: BOTH +25% DMG and +25% CRIT DMG (fixed); otherwise none |
| Supreme | Fixed 800 | Fixed 1200 | Fixed 500 | — (no crit) | 50% DMG, 50% CRIT DMG (always) |

- **Existing weapons are NOT affected** — already-owned/rolled rows keep their current values. This applies only to weapons rolled AFTER this patch. Do not write any migration over user_weapons. Confirm in your report that no existing-row rewrite happens.
- Legendary bonus mechanic (25% → both riders +25% fixed) and Supreme (always 50/50, crit 0) are unchanged in spirit from Phase 3 — only the base ATK/HP/DEF ranges changed. Verify the bonus_dmg/crit_dmg roll logic still matches this table.
- Patch the Master `[v4.4]`: the "Dynamic Weapon Stats (Min/Max per Tier)" table to exactly the above.

## 3. GREATER BOSSES — upgraded boss variants + weighted spawn + richer drops

**No schema change required** (confirmed: `mob_roster.special_flags` is free-form JSONB; `boss_state.max_hp/current_hp` are already BIGINT). Implement in code/config:

- **Name the tier "Greater Boss"** (recommended over "special/stronger" — established term for an apex variant; your call to rename). The five Greater Bosses: **Jötunn, Fenrir, Fafnir, Hydra, Cerberus** (match by exact mob_roster name; define them as a single hardcoded `GREATER_BOSSES` Set in the boss config so it's auditable in one place).
- **Stat change: 2× HP only.** At spawn, if the rolled boss is a Greater Boss, double the computed `max_hp` (and `current_hp`) before writing `boss_state`. ATK/DEF/CRIT/level/skill all unchanged. (Doubling at spawn is correct — bosses have no stored total-HP column; they scale from base + per-level, so the ×2 applies to the scaled result.)
- **Weighted spawn:** when the scheduler picks a boss, first roll the tier — **80% normal boss / 20% Greater Boss**. 20% branch → pick uniformly among the five Greater Boss rows that are present in the roster; 80% branch → pick uniformly among the NON-greater boss rows. (If a Greater Boss name isn't seeded, just skip it in the pool — never crash.) This tier roll is separate from and on top of the existing boss-vs-nothing spawn cadence.
- **Drops for Greater Bosses** (participation, same distribution model as normal bosses — every attacker of the spawn gets it):
  - Combat EXP: **30,000** (normal boss stays 20,000)
  - Credux: **150,000** (normal 100,000)
  - Belief Shards: **1,000** (same as normal)
  - Chest: roll **80% → 2× Boss Treasure Chest / 20% → 1× Boss Golden Chest** (normal boss = 1× Boss Treasure Chest). Use the existing chest columns on users_bag (boss_treasure_chest, boss_golden_chest — verify exact names).
- **Spawn announcement:** distinguish a Greater Boss visually — themed header prefix (e.g. `☠️ GREATER` / "A world-ender awakes…") and show the doubled HP in the pool bar. The participation-rewards block must list the Greater drop values when the active boss is Greater. The defeat distribution reads the same GREATER_BOSSES set to pay the richer rewards — keep the reward computation in ONE place keyed off the active boss's greater-ness so announcement and payout never disagree.
- **Optional SQL (cosmetic only — provide it, I decide whether to run it):** `scripts/tag_greater_bosses_v4_4.sql` that sets `special_flags = special_flags || '{"greater": true}'::jsonb` on the five rows. The CODE set is the source of truth either way; this tag is only if I later want it data-driven. State clearly that the feature works WITHOUT running this SQL.
- Patch the Master `[v4.4]` §16: document the Greater Boss tier, the 80/20 tier spawn, 2× HP, and the Greater drop table.

**Tell me explicitly in your report whether item 3 needs any DB table change** (it should not) and include the optional tag SQL.

## 4. Boss art conflict check (Screenshot: boss images updated)

I updated the boss PNGs in `/assets/monsters/boss/`. Verify the slug-lookup still resolves every seeded boss name to a file (run the same slug rule the spawn renderer uses against the actual filenames now in the folder). Report any boss whose name does NOT resolve to a present file (case/diacritic/slug mismatches — e.g. Jötunn → `jotunn.png`). Do not rename my files; just report mismatches so I can fix the asset or you can adjust the slug map. No code change unless a mismatch needs a slug alias.

---

## BUILD & VALIDATION

`node --check` on every touched file; selftest green (engine combat untouched — weapon-roll ranges and boss spawn are outside the pure engine, but if any fixture asserted old weapon ranges or boss HP, re-pin and report). Verify every schema column name used (chest columns, user_weapons fields) against the frozen schema.

Report: files changed; confirmation that NO existing user_weapons rows were rewritten (item 2); the item-3 answer on DB changes + the optional tag SQL + the **30,000 EXP flag**; the boss-art slug resolution results (item 4); the Master `[v4.4]` diff (weapon table, §16 Greater Bosses); and any selftest fixture that moved.

I then: optionally run the tag SQL, restart, and live-test — `crd profile` (combat EXP line + icon, Active Deity / Blessing split, deity emoji, stat icons, Combat Record heading + smaller font), a fresh Legendary/Supreme drop to confirm new ranges (and an OLD weapon to confirm it's unchanged), several boss spawns to see the 80/20 Greater split with doubled HP and the correct richer drops, and the boss art rendering.
