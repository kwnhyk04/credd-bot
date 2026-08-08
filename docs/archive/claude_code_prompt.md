# Paste this into Claude Code (run from the repo root, with the blueprint file copied into the repo or docs folder)

You are implementing a finalized patch for this Discord RPG bot (Credd). The complete, approved specification is in `CREDD_Ascension_Patch_Blueprint_v1.md` — read it fully before writing any code. Also read `CREDD_Current_Masterfile.md` for how the current systems work. On any conflict: the blueprint wins, then the live code, then the masterfile.

Hard rules, no exceptions:

1. Do not change any behavior, logic, balance, or output outside what the blueprint explicitly specifies. If something seems to need a change the blueprint doesn't cover, STOP and ask me — do not improvise.
2. Do not weaken or remove any existing egress/memory optimization (canvas cache, asset LRU caches, R2 fallbacks, attachment guards). Optimization code may only be touched in Sub-Patch 5, and only to make it MORE efficient with identical output.
3. Every currency/item mutation (essence, Credux, sigils, ascension, cosmetics grants) must be transactional with row locks, matching existing patterns in the codebase.
4. All SQL you hand me must be idempotent and delivered as script files, not run by you.
5. New numbers (cost tables, rates, badge size, attack caps) go in config files.

Work in this exact order, one sub-patch at a time. After each sub-patch: run `npm run selftest`, summarize what changed file-by-file, and WAIT for my approval before starting the next one.

- Sub-Patch 1 — Bug fixes: rebuild the equipment info embed with real Components V2 Separator components in the layout specified in blueprint §1.1 (thumbnail top-right; name/tier/enhancement header; separated Stats / Passive / Rune slots / Lore / Details / Help sections; remove all literal `____` divider strings). Fix `crd stats` to render the equipped R2 avatar via the same resolver `crd profile` uses (§1.3). Fix the boss system so 2 attacks per day work — trace the guard, make the cap a config constant, add a selftest (§1.4). Do NOT touch the deity embed yet.
- Sub-Patch 2 — Cosmetics: class default battle skins with catalog rows, collision-checked 2-char skin codes, raid-canvas panel geometry reuse, creation-time grant + auto-equip, and an idempotent backfill SQL script for me (§2.1). Founder avatar as ONE class-resolved catalog row wired into the dev manual founder grant command, plus an audit that granted skins actually appear in `crd skin collection` (§2.2). Token stipends 2/4/20 (§2.3). Tester avatar row with graceful blank rendering when images are missing (§2.4). Supporter badge (~30px) below the title on profile and stats cards, active subscribers only, cache-keyed (§2.5).
- Sub-Patch 3 — Sigils & Ascension deity rework: follow §3 exactly — user*deity backup export + wipe script, new rates 64.5/34.4/1/0.1, sigils/ascended columns, read-time stat computation replacing curr*\* usage, cost tables from §3.4 in a config file, repurposed `crd deity enhance`, pantheon slot rules with the existing blessing-category config, the rebuilt deity info embed with the dynamic Unlock Sigil → Ascend → hidden button, and the Supreme Relic 15,000 Valor change.
- Sub-Patch 4 — `crd glossary` per §4: dropdown header (Deities/Weapons/Armors/Runes), emoji-based embeds only (no canvas), one mythology per page for deities showing fully-ascended reference stats + blessing, 10 per page tier-descending for gear.
- Sub-Patch 5 — Optimization pass per §5, LAST and isolated: recompression script (WebP quality flag, no resizing, before/after report, staging output), ASSET_VERSION bump instructions for me, then a measured codebase efficiency pass — one change at a time, `npm run selftest:full` after each, before/after RSS and R2 PUT metrics, visually diff one render per affected command.

Before you start Sub-Patch 1, give me a short plan: the files you expect to touch per sub-patch and any blueprint ambiguity you want resolved. Then begin.

Patches 1-2 Opus 4.8
Patch 3: Fable 5
Patch 4-5: Opus 4.8
