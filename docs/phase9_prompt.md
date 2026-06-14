# PHASE 9 — `crd profile` Canvas + Phase-8 polish + mob scaling rescale

Continuing **Credd — The Last Believer** (discord.js v14 + Supabase), same build. Phases 1–8 are committed and live-tested. Phase 9's other targets are done; the ONLY feature remaining is `crd profile` / `crd stats` as a full Canvas PNG. This message adds that plus three tweaks.

Re-read if context is thin: `CREDD_Master_Export_v4.md` (§35 stat assembly is authoritative — Total ATK/HP/DEF = class + weapon curr_* + active deity curr_*; CRIT = class+weapon, never enhancement-scaled), `credd_schema_v4.sql` (schema FROZEN), and the existing canvas renderers (`renderBagItems.js`, `renderQuestRows.js`) for the font/box/emoji-cache conventions to reuse.

**This is mostly render + one balance SQL — build-direct is fine, NO plan gate.** Untouchable as always: schema DDL, seeds (except the seed-file value sync explicitly requested in §3), summonEngine.js, casino, .env, engine internals, `// TODO Phase-rep` markers. Branch `master`.

---

## 1. `crd profile` / `crd stats` — full Canvas PNG

One canvas image, posted as an attachment (with whatever minimal embed/CV2 wrapper matches the other commands). Pull live values through the SAME stat-assembly path the engine uses (so displayed totals match what actually fights — class + weapon curr_* + active deity curr_*; CRIT capped per §35.2). Read Discord display name + avatar from the interaction's member object, not the DB.

**Layout — top header band (two columns):**
- LEFT:
  - Line 1: **Discord display name** (server nickname / global display name — NOT the @username)
  - Line 2: `Believer Level {n} · {rank title}` — the account/Believer level with its rank title (e.g. `Wanderer`). Use the §-defined Believer-rank title for the level; if the rank-title table isn't already a constant in the repo, pull it from the Master and add it as a config constant (flag if you can't find it).
  - Line 3: Believer EXP number + a horizontal EXP bar (current / next-level threshold)
- RIGHT: the user's Discord avatar (squared), fetched from the member; cache by avatar URL; graceful fallback to the default Discord avatar if fetch fails (sandbox can't fetch — code it, I verify live).

**Separator line.**

**Body block (single column, left-aligned):**
```
Character Class: {Class}, Lvl {combat_level}
{combat_exp} / {next_level_exp}

Weapon:
{None  |  {Weapon Name} +{enhance_level}}

Active Deity Blessing:
{None  |  {Deity Name} +{deity_enhance_level}}
{Passive/Blessing name only  (omit line if no deity)}

Character Stats:
ATK {atk}   HP {hp}   DEF {def}   CRIT {crit}%
```
- "+{enhance}" shows only when > 0. Weapon emoji from game_items.txt where available (reuse the battleRender emoji path), unicode/none fallback.
- Combat level/EXP is the COMBAT track (§17), separate from the Believer level in the header — do not conflate them.

**Separator line.**

**Records block** — match Screenshot #1's visual style (boxed stat cells, colored numbers): label + value cells for
`Raids · Raids Won · Duels · Duel Wins` (pull the actual schema columns on user_character — use the real column names, don't invent; if a "raids total" vs "raids won" distinction isn't both stored, show what exists and flag the gap). Win-rate cell optional if derivable.

**Footer:** a myth-themed quote line, italic (style of "The gods remember your name, Last Believer."). A small rotating set keyed off discord_id (deterministic, so a user's quote is stable) is nice-to-have, or one fixed line is fine.

Reuse renderBagItems/renderQuestRows constants (font family via GlobalFonts, palette, separators, DejaVu-safe glyphs — no color emoji rasterized directly in canvas; use the CDN-cached PNG-icon approach already in the codebase). Keep one source of truth for fonts/colors.

## 2. TWEAK — quest embed font still too big (Screenshot #2)

In `renderQuestRows.js`, reduce the font sizes further (quest name, progress, reward, status) — the current render is still oversized relative to the box. Scale down proportionally so three rows sit comfortably with breathing room; keep the bar glyphs and icon sizing balanced to the smaller text. Match the tighter density of the bag render. Visual-only; no logic change.

## 3. TWEAK — class images in the create-character embed (Screenshot #3)

The class confirmation embed (`crd create character` class preview) currently shows text only. Add the class image from `/assets/classes/{class_lowercase}.png` (swordsman/fighter/mage/knight/archer — fixed names per Roster Conventions Part 4). Layout: **image on the LEFT at a 3:4 ratio, text to the RIGHT of it.** Use Components V2 (a Section with the text as content and the image as a thumbnail accessory, or a side-by-side container — whichever the lib supports cleanly at 3:4). Missing file → fall back to current text-only, never crash. Applies to every class in the picker, and to the confirm screen shown in Screenshot #3.

## 4. MOB SCALING RESCALE — SQL + doc sync

Per-level mob growth is being **reduced** (mobs scale up more slowly with level; base stats UNCHANGED). New values:
- Regular: HP **+20** / ATK **+8** / DEF **+5** per level  (was +40/+15/+10)
- Elite: HP **+40** / ATK **+15** / DEF **+10** per level  (was +75/+30/+16)

**a) Ship `scripts/patch_mob_scaling_v9.sql` (I run it — your sandbox can't reach the DB):**
```sql
UPDATE mob_roster SET hp_per_level = 20, atk_per_level = 8,  def_per_level = 5
 WHERE mob_type = 'regular';
UPDATE mob_roster SET hp_per_level = 40, atk_per_level = 15, def_per_level = 10
 WHERE mob_type = 'elite';
-- bosses untouched
```
**b) Update CREDD_Master_Export_v4.md** everywhere the per-level scaling appears (§13 scaling lines, §35.6 mob-scaling constants line) to the new values, with a `[v4.3]` note. Base-stat tables in §15 do NOT change.
**c) Update the in-repo mob seed file** `hp_per_level/atk_per_level/def_per_level` columns to match (regular 20/8/5, elite 40/15/10) so a fresh seed equals the post-patch DB.
**d) Re-pin any selftest fixture** that computed a mob's stats at a level > 1 (Lv1 is base-only and unaffected; anything at Lv N>1 changes). Recompute expected values; report which fixtures moved.

Note in your report: "stat scaling values are updated in the SQL (scripts/patch_mob_scaling_v9.sql) — I must run it against Supabase before live-testing."

---

## BUILD & VALIDATION

Build all four. Then: `node --check` on every touched file; selftest green with re-pinned scaling fixtures (§4d); confirm no engine/schema/seed-except-§4c violations; verify every column name used in the profile render against the frozen schema.

Report: files changed, the scaling SQL, which selftest fixtures moved, the Master §13/§35.6 diff, and any column you couldn't find for the records block (§1) or rank-title table (§1 header) — flag rather than invent.

I then run the SQL in Supabase, restart, and live-test: `crd profile` (totals match a known character's gear, avatar, EXP bars, records, weapon/deity enhancement display, no-deity/no-weapon states), the smaller quest font, class images in create-character at 3:4, and a raid against a leveled mob to confirm the gentler scaling feels right.
