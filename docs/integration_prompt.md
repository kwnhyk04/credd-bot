# TASK: Integrate & fix the chest/relic opening system

I have dropped these files into the project root. Move them to the right places, then integrate and FIX the currently broken chest opening so the full flow works end to end.

## Dropped files → destinations
- `animations_chests_centered/*.gif` (7 files) → `animations/chests/` — **REPLACE any existing gifs with the same names.** These are padded to a wide 640×240 canvas so the animation appears centered in the Discord embed instead of left-aligned. Do not crop or resize them.
- `chestOpen.js` → wherever this project keeps command handlers/utils (detect the existing structure first — e.g. `src/commands/`, `handlers/`, `utils/` — and follow it). Fix its relative paths (`../animations/chests`, renderer import) to match where you put it.
- `weaponResultRenderer.js` → same module/util folder. Fix its `../assets/weapons` path to the project's real assets folder.

## Before coding
1. Read the existing project: the gacha backend, the existing chest config (max opens per chest), the existing 10-roll deity summon (the one that renders deity cards with Canvas — see `crd summon 10`), `game_items.txt`, and the currently broken chest-opening command. Understand WHY it's broken and fix the root cause — do not paper over it.
2. Detect which canvas package the project already uses (`canvas` vs `@napi-rs/canvas`) and make `weaponResultRenderer.js` use that one. Register a font at startup (node-canvas: `registerFont`, napi-rs: `GlobalFonts.registerFromPath`) and use that family in the renderer, otherwise tier icons (❖ ★) render as empty boxes on Linux.

## Flow (applies to ALL opens)
Backend rolls FIRST → send embed with the matching gif from `animations/chests/` as the embed image → wait PLAY ONCE → EDIT the same message into the result embed. On edit you MUST pass `attachments: []` or discord.js keeps the old gif attached. Replay button replays the same animation + same already-rolled results (never re-rolls), restricted to the opener.

## 1) Weapon chests — tier comes from the command argument
The chest tier in the command selects both the gif and the loot table:
| command tier | gif | open quantities allowed | result type |
|---|---|---|---|
| silver | silver_chest.gif | 1 / 5 / 10 | weapons |
| gold | gold_chest.gif | 1 / 5 / 10 | weapons |
| boss | boss_treasure_chest.gif | 1 / 5 / 10 | weapons |
| boss golden | boss_golden_chest.gif | 1 / 5 / 10 | weapons |
| supreme | supreme_chest.gif | **1 only** | weapons |

- The project ALREADY has config for how many chests can be opened — use it as the source of truth; the table above is from memory, so if the existing config disagrees, **the existing config wins**. Enforce supreme = single open.
- Results render through `weaponResultRenderer.js`: weapon sprites load from the assets weapons dir using `name.toLowerCase().replace(/\s+/g,'_') + '.png'`; each card bakes in the unique weapon id, tier, and stats. Wire the gacha backend's weapon objects (and `game_items.txt` data) into the `{ id, name, tier, stats }` shape the renderer expects.
- Result embed layout: header → italic flavor → separator → weapon grid image → tier summary line (e.g. `❖ Mythic ×4 · ★ Legendary ×1`) → separator → `[icon] Sacred Relics: N · [icon] Supreme Relics: N` (use the project's existing custom emoji ids if any).

## 2) Sacred relic — deity gacha, NOT weapons
- 1 open = 10 rolls on the **deity** gacha. The 10-roll deity summon already exists — DO NOT rebuild it. Reuse its backend roll AND its existing Canvas deity-card render exactly as-is.
- The only change: prepend the animation phase using `sacred_relic.gif`, then edit into the existing deity 10-roll result embed (same edit/`attachments: []`/Replay pattern).

## 3) Supreme relic — single deity pull
- 1 open = exactly **1 roll** on the deity gacha. Single pull ONLY — reject any quantity argument.
- Reuse the existing deity card render for that single deity, but the lone card must be **horizontally centered** in the embed image: pad the canvas to the same width the 10-roll render uses (or ≥ ~640px) with the card centered, because Discord left-aligns narrow images. Apply the same min-width + centering rule in `weaponResultRenderer.js` for any render with fewer cards than a full row (e.g. a 1-weapon supreme chest open).
- Animation: `supreme_relic.gif`.

## 4) Supreme relic — single deity pull
- Fix render of deity emoji Bathala is rendering instead of Sidapa showing 2 Bathala renders.

## Acceptance checklist
- [ ] Chest command works again for every tier; tier arg picks the correct gif + loot table
- [ ] Quantity limits enforced from existing config; supreme chest & supreme relic = 1 only
- [ ] Sacred relic = 10 deity rolls with existing deity render; supreme relic = 1 deity roll, centered
- [ ] Animation → edit → result works; old gif removed on edit; Replay reuses the same roll
- [ ] All gifs and any narrow result image appear centered in the embed
- [ ] Relic counts in footer reflect post-open balances
- [ ] Run/lint the bot and do a dry-run test of each command path before finishing
