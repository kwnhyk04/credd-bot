# CREDD Ascension Patch — Architecture Blueprint v1

Status: FINALIZED — approved by the owner on 2026-07-10.
Supersedes: the deity enhancement system described in `CREDD_Master_Export_v4_2.md`, and §V5-4 (Pantheon 50%/25% blessing scaling) in `CREDD_Master_Export_v5.md`.
Source-of-truth order for any conflict: (1) this document, (2) the live codebase, (3) `CREDD_Current_Masterfile.md`, (4) older masterfiles.

---

## 0. Ground rules for implementation

These rules apply to every sub-patch and are non-negotiable:

1. **Do not change any behavior, logic, or balance outside what this document explicitly specifies.** If a change seems necessary but is not specified here, stop and ask the owner.
2. **Do not weaken or remove any existing egress/memory optimization** (canvas cache, asset LRU caches, R2 fallback logic, attachment guards). Sub-Patch 5 is the only place optimization code may be touched, and only to make it more efficient with identical output behavior.
3. All currency/item mutations (essence spend, Credux spend, sigil unlock, ascension) must use explicit transactions with row locks (`SELECT ... FOR UPDATE`), matching the existing pattern in the codebase.
4. All new SQL delivered to the owner must be idempotent (`ON CONFLICT DO NOTHING`, `IF NOT EXISTS`) so it can be re-run safely.
5. Run `npm run selftest` after each sub-patch and `npm run selftest:full` before declaring the patch done. Add selftest coverage for every new system (sigils, ascension, glossary routing, boss attack count).
6. New numeric values (essence tables, costs, rates, badge size) go in config files, not hardcoded in command/engine files.
7. Implement sub-patches in the order listed. Each sub-patch must be independently shippable.

---

## Sub-Patch 1 — Bug fixes

### 1.1 Equipment info embed (`crd equipment info <id>`)

Current bug: the embed uses literal underscore strings (`_______`) as fake section separators. The correct design uses real Components V2 Separator components.

Target layout (this matches an earlier working design the owner wants restored, adapted to the thumbnail format):

- Item image rendered as a **thumbnail** (top-right), not a full-width image. The thumbnail is currently correct — keep it.
- Header block to the left of the thumbnail: **item name** (with owner mention), **Tier**, **Enhancement**.
- Then real Separator components between each of these sections, in order:
  1. Stats (HP/DEF for armor; ATK/CRIT for weapons)
  2. Passive (name + description)
  3. Rune slots (one line per slot, "empty" or socketed rune)
  4. Lore (italic) + the AI-image disclaimer line
  5. Details (Owner, ID, Sell Value)
  6. Help (the `crd enhance <id>` / `crd equip <id>` hint line)
- Remove every literal underscore/dash divider string from the component text.

### 1.2 Deity info embed

The deity info embed has the same fake-separator bug. Do **not** patch it here — it is fully rebuilt in Sub-Patch 3.7 with the new Sigil/Ascension layout. Fixing it twice is wasted work.

### 1.3 `crd stats` avatar rendering

Bug: the stats card renders the default avatar instead of the user's equipped avatar cosmetic from Cloudflare R2.

Fix approach:
1. Trace how `crd profile` resolves the equipped avatar (equipped_skins → cosmetic_catalog → R2 URL via `ASSET_BASE_URL`). If profile resolves correctly, make the stats renderer use the exact same resolver function (extract to a shared util if it is currently inlined).
2. If profile is also wrong, fix the shared resolver so both use it.
3. Verify the render goes through the existing canvas cache with the avatar identity as part of the cache key (otherwise a skin change would serve a stale card).

### 1.4 Boss: second daily attack still blocked

The boss system was changed to allow **2 attacks per player per day**, but something still blocks the second attack.

Fix approach:
1. Trace the daily-attack guard in `src/engine/bossSystem.js` and any related scheduler/reset logic. Likely culprits: a guard still checking `attacks >= 1`, a unique constraint on `(discord_id, boss_id, day)` rejecting the second insert, or an in-memory "already attacked today" flag/cache that was never updated for the 2-attack rule.
2. Make the max-attacks-per-day value a named config constant (`MAX_BOSS_ATTACKS_PER_DAY = 2`) in `src/config/bosses.js` and have all guards read it.
3. Verify the daily reset clears the counter correctly.
4. Add a selftest: attack twice succeeds, third attack is blocked, next day resets.

---

## Sub-Patch 2 — Cosmetics & supporter

### 2.1 Class default battle skins

New asset per class at: `credd-assets/classes/battle_base/<class>.png` (swordsman, fighter, mage, knight, archer).

**Catalog rows** (5 rows in `cosmetic_catalog`):
- `category = 'battle'`, `tier = 'believer'`, `token_cost = 0`, `is_base = false`, `is_active = true`
- `render_filename = 'classes/battle_base/<class>.png'`
- `display_name = '<Class> Battle'` (e.g. "Swordsman Battle")
- `cosmetic_key = 'class_battle_<class>'`
- **Skin codes (2 characters):** `ws` swordsman, `fs` fighter, `ms` mage, `ks` knight, `as` archer. Before inserting, grep `assets/data/skins.txt` and the live `cosmetic_catalog` for collisions with existing codes (known taken: pb, bb, rb, sb, p1, p2, b1, b2, b3, p7, pt5, bt5, rt5). If any proposed code collides, shift to the next free letter+`s` pattern and report the final mapping to the owner.

**Render layout:** measure the panel geometry (fighter panels, HP bars, name plates, log area coordinates) of the current **default raid canvas** and reuse the exact same coordinates/arrangement on the class base image. The class image is only a background swap; nothing about panel placement, fonts, or bar logic changes. Renders go through the existing canvas cache; include the skin code in the cache key.

**Grant behavior:**
- On character creation, automatically insert the matching class skin into `user_cosmetics` AND auto-equip it as the user's battle skin (equipped_skins), replacing the base `bb` default for new characters.
- Deliver a **backfill SQL script** (as a file for the owner to run manually) that:
  1. Inserts the 5 catalog rows (`ON CONFLICT DO NOTHING`).
  2. Inserts a `user_cosmetics` ownership row for every existing `user_character`, joined on class.
  3. Updates `equipped_skins` to the class battle skin **only** for users whose current battle skin is the base default (do not override anyone who equipped a purchased/custom battle skin).

### 2.2 Founder avatar

New asset set: `credd-assets/skins/avatars/founder/founder_<class>.png`.

- Create **one** catalog row (not five): `cosmetic_key = 'founder_avatar'`, `category = 'profile'` avatar-type, `token_cost = 0`, tier per the eternal/founder cosmetic convention already in the catalog. Give it a free 2-char skin code (suggest `fa`; check collisions).
- The renderer resolves the actual file **at draw time** from the user's current class: `avatars/founder/founder_<class>.png`. If the user has no character yet, fall back to the normal default avatar until one exists. This avoids granting class-specific rows and survives any future class change.
- **Grant path:** Stripe is not in use. Add the founder avatar grant to the **dev manual founder grant command** (the existing dev simulation/entitlement command that grants founder status). The grant inserts the `user_cosmetics` row idempotently.
- **Audit task:** verify end-to-end that `grantFounderSkinSet` (and the dev grant command that calls it) actually inserts `user_cosmetics` rows that appear in `crd skin collection`, and that the founder avatar appears in the user's avatar options after grant. Report findings; fix any gap found.

### 2.3 Supporter token stipend increase

In `src/config/supporterConfig.js` (or wherever stipends live), set:
- Believer: **2** tokens/month
- Chosen: **4** tokens/month
- Eternal: **20** tokens (one-time grant, replacing the previous 18)

No other entitlement changes.

### 2.4 Beta tester avatar

New asset set: `credd-assets/skins/testers/avatars/<class>.png`.

- Same pattern as the founder avatar: **one** catalog row (`cosmetic_key = 'tester_avatar'`, suggest skin code `ta`; check collisions), class-resolved at render time.
- The owner will insert `user_cosmetics` rows manually for testers — no grant command needed. Provide the exact INSERT template in a comment for the owner.
- **Graceful missing-image behavior (required):** the tester images are not uploaded yet. If the R2/local fetch for the avatar image fails or 404s, the renderer must **skip the avatar layer and render the rest of the card normally** (or fall back to the default avatar) — never throw, never break the card. Extend the existing remote-fetch-fallback machinery; do not build a parallel path.

### 2.5 Supporter badge on profile and stats

New asset set: `credd-assets/skins/supporters/<tier>.png` (one badge image per supporter tier).

- On both the `crd profile` and `crd stats` rendered cards, draw the badge **below the user's Title**, resized very small (target height ≈ **30px**, width proportional; make the size a config constant).
- Show the badge **only while the supporter subscription is active**: resolve via the existing supporter status cache (`getSupporterStatus` / `isActiveSupporter` pattern) using the current tier. Lapsed non-founder = no badge. Eternal/founder = permanent badge (tier is permanent).
- Missing badge image → skip the layer gracefully (same rule as 2.4).
- The badge identity (tier or none) must be part of the canvas cache key for these cards.
- Compress the badge assets aggressively (see Sub-Patch 5.1 — include this folder in the recompression pass).

---

## Sub-Patch 3 — Deity rework: Sigils & Ascension

This replaces the current deity enhancement system (`crd deity enhance`, +10, double stats) entirely.

### 3.1 Wipe and reset

- `user_deity` will be **wiped**. Before deleting, export a full backup (CSV or SQL dump) of `user_deity` — including discord_id, deity_id, enhancement, obtained_at — and hand it to the owner. The owner handles player compensation manually from this export; the bot performs **no automatic compensation**.
- Pity counters: reset to 0 for all users as part of the wipe (fresh economy).

### 3.2 New summon rates

In `src/config/gachaRates.js`:

| Tier | Old | **New** |
|---|---|---|
| Epic (Remnant) | 64.5% | **64.5%** |
| Mythic (Awakened) | 30% | **34.4%** |
| Legendary (Undying) | 5% | **1%** |
| Supreme (Primordial) | 0.5% | **0.1%** |

Sums to 100%. Pity system unchanged: threshold 500; natural Legendary/Supreme resets pity; threshold-forced Legendary resets pity; Supreme Relic forced pulls do not touch pity.

Note: the Mythic display name "Awakened" collides conceptually with the new Ascension mechanic. Do not rename anything; just ensure new UI text uses "Ascend/Ascended/Ascension" (never "awaken") to avoid confusion.

### 3.3 Duplicate essence (unchanged values, confirm wiring)

Duplicates grant tier essence, already live: Epic 1, Mythic 2, Legendary 5, Supreme 10. No change; verify the grant path still works after the rework.

### 3.4 The Sigil system

**Player-facing terms:** constellation pieces = **Sigils** (progress shown as "Sigils: n/10"). Final unlock = **Ascension**. Flavor language may say a Sigil "restores X% of the deity's missing power"; the backend math is linear on base stats.

**Mechanics:**
- First copy of a deity unlocks it at **50% of base stats**, blessing **dormant** (inactive).
- Each Sigil adds **+5% of base stats**. Effective stat = `base_stat × (0.50 + 0.05 × sigils)`, sigils 0–10. At 10 Sigils the deity is at 100% base stats.
- Blessing remains dormant until **Ascension**. Ascension requires 10/10 Sigils and costs additional essence + Credux. After Ascension the blessing is active.
- Sigil unlocks and Ascension consume **essence of the deity's own tier** (Epic deity consumes Epic Essence, etc.) plus Credux for Ascension only.

**Cost tables** (config-driven, e.g. `src/config/ascension.js`):

| Sigil | Epic | Mythic | Legendary | Supreme |
|---|---|---|---|---|
| 1–3 (each) | 5 | 5 | 4 | 2 |
| 4–7 (each) | 10 | 8 | 6 | 3 |
| 8–10 (each) | 15 | 12 | 8 | 4 |
| **Sigil total** | **100** | **83** | **60** | **30** |
| **Ascension** | 50 + 100,000 Credux | 40 + 250,000 | 30 + 500,000 | 15 + 1,000,000 |
| **Grand total essence** | 150 | 123 | 90 | 45 |

### 3.5 Schema changes

On `user_deity`:
```sql
ALTER TABLE user_deity ADD COLUMN IF NOT EXISTS sigils   SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE user_deity ADD COLUMN IF NOT EXISTS ascended BOOLEAN  NOT NULL DEFAULT FALSE;
```
- Stats are **computed at read time** in `statAssembly` from `deities.base_hp/base_atk/base_def × (0.50 + 0.05 × sigils)`. Stop writing/relying on `curr_atk`, `curr_hp`, `curr_def` for deity power. Audit every reader of `curr_*`; migrate them to the computed path. Keep the columns for now (drop in a later cleanup patch once nothing reads them).
- The `enhancement` column becomes legacy: stop writing it; audit and migrate readers.
- `crd deity enhance <name>` is **repurposed** as the sigil-unlock/ascend command (keeps player muscle memory): if sigils < 10 it unlocks the next Sigil; at 10/10 and not ascended it performs Ascension; if ascended it reports "already ascended." The embed button (3.7) calls the same underlying function.

### 3.6 Pantheon slots and blessing categories

Three deity slots:
- **Slot 1:** always available. Full sigil-scaled stats. Blessing (if Ascended) fires at full power. Both blessing categories may be equipped here.
- **Slot 2:** unlocks at **Believer level 15**. Contributes **50% of the deity's sigil-scaled stats**.
- **Slot 3:** unlocks at **Believer level 30**. Contributes **50% of the deity's sigil-scaled stats**. Unlocking slot 3 grants the right to run a **second active blessing**.

Blessing categories (the category config **already exists in the codebase** — read it, do not invent a new classification):
- **Divine** blessings: equippable/active in **slot 1 only**.
- **Echo** blessings: active in slot 1, **or** in exactly one of slots 2/3 (player's choice of which side slot carries it). At most one echo blessing fires from the side slots.
- Any blessing, in any slot, fires **only if that deity is Ascended**. Un-ascended deities contribute stats only.
- Same-family blessing non-stacking and combat caps from the existing engine rules remain in force.

This section supersedes v5 §V5-4 (50%/25% blessing scaling). Remove/disable the old scaling logic where it exists.

### 3.7 New deity info embed (Components V2, real separators)

Layout mirrors the fixed equipment embed (1.1):
- Deity image as thumbnail (top-right).
- Header block: deity name, tier (display name), mythology.
- Real Separator components between sections:
  1. **Sigils** — progress `n/10`, plus next-Sigil cost (or "Ready to Ascend" at 10/10, or "Ascended ✦").
  2. **Stats** — current computed HP/ATK/DEF at the deity's sigil multiplier.
  3. **Blessing** — if ascended: blessing name + description. If not: `Blessing dormant — ascend this deity to awaken it.` (do not show the blessing text before Ascension).
  4. Lore + AI-image disclaimer.
- **Dynamic button** (one button, three states):
  - sigils < 10 → label `Unlock Sigil (cost: N <Tier> Essence)`
  - sigils = 10 and not ascended → label `Ascend (N Essence + N Credux)`
  - ascended → button not rendered.
- Button `custom_id` encodes deity_id + owner discord_id; the interaction handler rejects clicks from anyone but the owner. The spend + increment runs in a single transaction with row locks on `users_bag` and the `user_deity` row; re-check state inside the transaction so double-clicks cannot double-spend or over-increment.
- On success, edit the message in place with the updated embed/button state.

### 3.8 PvP shop rescale

In the PvP shop config: **Supreme Relic 9,000 → 15,000 Valor** (per-season cap remains 1). Sacred Relic (800) and Supreme Chest (6,000) unchanged — the Supreme Chest drops gear, not deities, so the rate change does not affect it.

### 3.9 Glossary dependency

Sub-Patch 4's deity pages display fully-ascended values; implement 3.x before 4.

---

## Sub-Patch 4 — Glossary (`crd glossary`)

A reference browser. **Embed/text only — no canvas rendering** (deity art is already uploaded as custom emojis; use the emoji registry).

- Header with a **dropdown** (Components V2 select): `Deities`, `Weapons`, `Armors`, `Runes`. Plus previous/next page buttons.
- **Deities:** one **mythology per page** (same grouping behavior as `crd deity collection`). Each entry: deity emoji, name, tier — new line: stats — new line: blessing. Stats shown are the **fully-ascended reference values** (100% base stats), and the blessing text is always shown (this is a codex/reference, independent of what the viewer owns).
- **Weapons:** 10 per page, sorted by tier descending. Each entry: emoji, name, tier — stats (ATK/CRIT) — passive.
- **Armors:** same as weapons (HP/DEF).
- **Runes:** rune families/tiers with their stat or effect values, same entry format.
- Query catalog tables with `is_available = true` / active flags only.
- Prefix command first (`crd glossary`); add to help. Slash coverage optional/later, consistent with other prefix-first systems.

---

## Sub-Patch 5 — Egress & memory optimization pass (LAST, isolated)

No behavior or logic changes. No visual layout changes. Output must be visually identical (compression aside).

### 5.1 Asset recompression script

Write a one-off script (`scripts/recompress-assets.js`) that:
- Walks the raid battle skins, battle-result skins, the new class battle bases (`classes/battle_base/`), supporter badges (`skins/supporters/`), and avatar sets.
- Re-encodes to WebP at a lower quality via `sharp`. **Do not resize** — dimensions stay identical. Start at quality ≈ 72; make quality a CLI flag.
- Outputs a before/after size report (per file + totals) for the owner to review, and writes recompressed files to a staging folder — the owner uploads to R2 after visually approving.

### 5.2 Cache-version bump

After the owner re-uploads recompressed assets to R2, bump `ASSET_VERSION`. Document clearly for the owner: canvas cache keys include `ASSET_VERSION`, so all cached renders regenerate once — expect a one-time render/egress spike, then permanently lower egress per render. Recommend doing the swap during low-traffic hours.

### 5.3 Codebase efficiency pass

Hunt and fix, with output-identical results:
- Redundant buffer copies and unnecessary re-encodes (e.g. canvas → PNG → sharp → WebP chains that can be collapsed).
- Repeated remote fetches of the same asset within one render that should hit the in-memory cache.
- Oversized intermediate canvases (rendering larger than final output then downscaling — render at target size where the result is identical).
- Renders that bypass the canvas cache but are deterministic and cacheable.
- Any messy/duplicated render code that can be simplified without changing output.

Process requirements: measure before/after (process RSS, R2 PUT count per session, bytes uploaded per render), change one thing at a time, run `npm run selftest:full` after each change, and visually diff at least one render per affected command (profile, stats, raid, battle result, summon, bag).

---

## Verification checklist (end of patch)

- [ ] Equipment info and deity info embeds use real Separator components; no literal `____` strings remain anywhere in embed builders.
- [ ] `crd stats` shows the equipped R2 avatar; skin change invalidates/rekeys the cached card.
- [ ] Boss allows exactly 2 attacks/day; resets daily; selftest covers it.
- [ ] New character creation grants + auto-equips the class battle skin; backfill SQL delivered and idempotent; skin codes collision-checked and reported.
- [ ] Founder avatar in dev grant; founder skin set audit findings reported; tokens 2/4/20.
- [ ] Tester avatar and supporter badge render, and skip gracefully when images are missing.
- [ ] Deity wipe backup exported; rates 64.5/34.4/1/0.1; sigil math `base × (0.50 + 0.05n)`; ascension unlocks blessing; costs match §3.4 tables; all spends transactional.
- [ ] Pantheon: slot 2 @ Believer 15, slot 3 @ Believer 30, side slots 50% sigil-scaled stats, divine slot-1-only, one echo from side slots, no blessing without Ascension.
- [ ] Supreme Relic costs 15,000 Valor.
- [ ] Glossary dropdown + pagination works for all four categories; deity pages show ascended reference values.
- [ ] Optimization report delivered: per-file compression savings, RSS/egress before-after, zero behavior diffs, selftest:full green.
