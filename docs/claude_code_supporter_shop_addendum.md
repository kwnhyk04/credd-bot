# CREDD — Supporter Shop ADDENDUM: per-skin layout configs + dev shop bypass

Append this to the supporter-shop implementation prompt. It changes the render approach from a hardcoded layout to a **data-driven, per-skin layout config**, and adds a dev command to open the shop without a subscription.

**No SQL needed for this addendum** — layout configs are colocated JSON files (convention-based), not DB rows.

---

## 1. The problem
Each skin's art puts its panels, ornament, and the top-label "1 word" space in different places. A single hardcoded layout cannot serve every skin. So: **one layout config per skin design.**

## 2. Per-skin layout config (convention-based, colocated)
- Every renderable skin (profile / battle / battle_result) ships a layout config **next to its asset**, same basename: `c_divine_radiance_p1.png` → `c_divine_radiance_p1.layout.json`. The base set uses `assets/skins/supporters/base/profile.layout.json`, etc.
- The renderer loads `<asset_basename>.layout.json`, **caches** it (invalidate on file mtime change in dev), and draws every content element from it.
- **Fallback:** if a skin has no config file, fall back to a per-category default config (`assets/skins/_defaults/profile.layout.json`, etc.) so nothing crashes — but log a warning so missing configs are visible.
- The config is the **single source of truth for placement**; the engine has no hardcoded coordinates. Designers tune a skin by editing its JSON, no code change.

A complete, real example is provided: **`base_profile.layout.json`** (derived from the live base render at 1536×1024). Use it as the schema reference and the clone-template for every new profile skin.

### Config schema (profile)
Top-level: `canvas {w,h}`, `icons_dir`. Then one block per element, each carrying its own position + text style:
- `top_label` — `{enabled, x, y, anchor, font, weight, size, color, uppercase}`. Content: `Founder <NNN>` (zero-padded founder_number) if founder; else tier name; **the two DEV_ACCOUNT_IDS render `Founder 000`**. Each skin positions this wherever its art left room (the example sits it just under the torch medallion).
- `avatar` — `{x, y, size, radius, glow{color,alpha,blur}}`.
- `name`, `tier_line`, `exp_text`, `class`, `combat_exp`, `weapon_label/value`, `deity_label/value`, `blessing`, `stats_label`, `record_label`, `quote` — each `{x, y, anchor?, font, weight, size, color, italic?, icon?, icon_gap?}`.
- `exp_bar` — `{x, y, w, h, radius, fill, track}`.
- `stats` — `{y, seg, chip_w/h, chip_radius, label_gap, value_gap, font, weight, size, value_color, cols:[{key,x,label,color}]}`.
- `record` — `{y, box_w, box_h, gap, radius, box_fill, box_outline, label_*, value_*, cols:[{key,x,label}]}`.

### Config schema (battle) — author one per battle skin
- `canvas`, `top_band {x,y,w,h}`, `bottom_band {x,y,w,h}` (player / enemy zones), and per-band: `name {x,y,...}`, `hp_bar {x,y,w,h,radius,fill,track}`, `hp_text`, `stat_line`, optional `portrait {x,y,size}`. Plus a `clash_label` slot if the frame has a center VS plate.

### Config schema (battle_result) — author one per result skin
- `canvas`, `headline {x,y,anchor,font,...}` (e.g. "VICTORY" / "DEFEAT"), `name {...}`, and a **`reward_zone {x,y,w,h}`** rectangle = the reserved space below the result art where loot is drawn. The renderer lays the run's rewards inside `reward_zone` (grid or list). Verify rewards never overflow this rect.
- Victory and defeated share the same config but load `victory_filename` / `defeated_filename` as the base art.

### Summon
- No layout config needed — the equipped `.webp` is a complete pre-rendered flip animation; the bot just plays it, then reveals the deity card.

## 3. Data-driven renderer
Rewrite the profile/battle/result renderers to:
1. Resolve the equipped skin (precedence: `override_path` > `cosmetic_id` > base > free default).
2. Load the skin's base art → `drawImage` normalize to `canvas.w/h`.
3. Load the skin's `.layout.json` (or category default).
4. Iterate the config blocks and draw each element at its configured position/style. Register Inter at boot; draw icons from `icons_dir` PNGs (no emoji).
5. For `top_label`, only draw when `enabled` and resolve the Founder/tier/`Founder 000` text per §2.

One generic renderer per category, fully driven by config — so a new skin is "drop the art + a layout.json," zero engine edits.

## 4. Dev command: open the shop without a subscription
Add `crd dev supporter shop` (dev/owner-gated): opens the full Supporter Shop UI **bypassing the access gate and tier gate**, with every category and every skin visible (owned or not), so you can browse and preview designs. From here (and via the existing `crd dev use ...` equips) you can render any skin to check its layout config. Mark the embed clearly as DEV MODE.

## 5. Acceptance additions
- [ ] Renderer has **no hardcoded coordinates**; all placement comes from the skin's `.layout.json`.
- [ ] Every shipped skin (base, store, tester, founder) has a colocated `.layout.json`; missing → category default + warning.
- [ ] `top_label` renders Founder NNN / tier / `Founder 000` (dev accounts) at the per-skin position.
- [ ] `battle_result` rewards draw inside `reward_zone` with no overflow, for every result skin.
- [ ] `crd dev supporter shop` opens the shop with full access for design checking.
- [ ] Canvas-fit test (from the base prompt §10) now validates each skin **against its own config**.
