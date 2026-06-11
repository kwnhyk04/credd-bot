# CREDD BOT — ROSTER & ASSET CONVENTIONS
*Companion to credd_schema_v4.sql. Use this when seeding weapon_roster, deity_roster, mob_roster, and when organizing PNG assets.*

---

## PART 1 — REGISTRY KEY CONVENTION
*(passive_key · blessing_key · skill_key)*

These keys are the bridge between the DB and `/engine/passiveRegistry.js`. The value you store **must exactly match** a function name in `PASSIVE_REGISTRY`.

**Rules**
- lowercase `snake_case`, characters `[a-z0-9_]` only, max 50 chars.
- **Globally unique** across the entire registry — weapon passives, deity blessings, and mob skills all live in one flat namespace, so a key can never be reused for two different effects.
- Use the literal `none` for "no passive / no active skill" (one shared no-op function handles all of them).

**Recommended pattern (prevents collisions):**

| Roster | Pattern | Examples |
|---|---|---|
| Weapon | `<weapon_slug>` | `freyrs_arrow`, `kampilan`, `mjolnir`, `none` |
| Deity blessing | `<deity_slug>_<blessing_slug>` | `bathala_divine_vessel`, `freya_valkyries_embrace`, `thor_mjolnirs_wrath` |
| Mob / boss skill | `<mob_slug>_<skill_slug>` | `manananggal_viscera_drain`, `dwende_black_hex`, `none` |

Deity- and mob-prefixing is recommended because several effects share a name (e.g. multiple "Bleed"/"Hex" style skills) but differ in numbers; prefixing guarantees uniqueness. **Weapon caution:** some weapon *display names* are NOT unique on their own — keep the disambiguating tier/type suffix so slugs stay distinct (e.g. `laevateinn_sword` vs `laevateinn_staff`). Never seed two weapons whose names slug to the same key, or one will silently overwrite the other in the flat registry.

**Slug rule** (turning a display name into a key): lowercase → drop apostrophes → strip diacritics (ð→d, ö→o) → replace any run of non-`[a-z0-9]` with one `_` → trim leading/trailing `_`.
- `Freyr's Arrow` → `freyrs_arrow`
- `Mjölnir` → `mjolnir`
- `Thyrsus (Mythic)` → `thyrsus_mythic`

---

## PART 2 — IMAGE FILENAME CONVENTION

`image_filename` stores the **filename only** (no path), and exists only on `deity_roster` and `weapon_roster`. The code knows the folder from the table (deity_roster → `/assets/deities/`, etc.). **Mobs have no image_filename.**

- lowercase `snake_case` + `.png`, same slug rule as above.
- Nullable — leave `NULL` until the art exists; the renderer uses a fallback when null.

| Display name | image_filename |
|---|---|
| Freyr's Arrow | `freyrs_arrow.png` |
| Mjölnir | `mjolnir.png` |

---

## PART 3 — ROSTER INSERT TEMPLATES

Copy these, fill in, and batch as multi-row `INSERT`s. Note SQL escapes a single quote by doubling it (`Freyr''s`).

### weapon_roster
```sql
INSERT INTO weapon_roster
  (name, type, tier, mythology, passive_key, passive_name, passive_description, lore, image_filename)
VALUES
  ('Freyr''s Arrow', 'Bow', 'Legendary', 'Norse',
   'freyrs_arrow', 'Auto-Fire',
   '50% chance to auto-fire, dealing 100% ATK as bonus damage.',
   'An arrow loosed by the harvest-god, said to find its mark on its own.',
   'freyrs_arrow.png'),
  -- a "None" passive weapon uses the sentinel:
  ('Iron Sword', 'Sword', 'Rare', 'Common',
   'none', '—', 'No passive ability.',
   'A plain but dependable blade.', 'iron_sword.png');
```

### deity_roster
```sql
INSERT INTO deity_roster
  (name, mythology, tier, base_hp, base_atk, base_def,
   blessing_key, blessing_name, blessing_description, lore, image_filename)
VALUES
  ('Bathala', 'PH', 'Supreme', 1640, 650, 355,
   'bathala_divine_vessel', 'Divine Vessel',
   'All stats +20% for the first 3 rounds.',
   'The supreme creator deity of Tagalog myth, source of all life and order.',
   'bathala.png');
```
> Reminder: `deity_roster.name` is UNIQUE — use **Skadi** (Legendary)

### mob_roster — regular / elite
```sql
INSERT INTO mob_roster
  (name, mythology, mob_type, base_hp, base_atk, base_def, base_crit,
   hp_per_level, atk_per_level, def_per_level,
   skill_key, skill_name, skill_description, immunity_tags, special_flags)
VALUES
  -- regular (example uses pre-rebalance stats; live values per the patched §15/§35.6)
  ('Black Duwende', 'PH', 'regular', 580, 38, 28, 5.0,
   20, 8, 5,
   'dwende_black_hex', 'Hex', '25% chance to reduce player ATK by 15% for 1 turn.',
   '[]'::jsonb, '{}'::jsonb),
  -- elite: scaling 38 / 10 / 8
  ('Manananggal', 'PH', 'elite', 1200, 72, 40, 10.0,
   38, 10, 8,
   'manananggal_viscera_drain', 'Viscera Drain',
   'Every 3 rounds: drains 15% of the player''s max HP and heals itself.',
   '[]'::jsonb, '{}'::jsonb);
```
> Mobs have **no** `lore` / `image_filename` columns — they are grind fodder and need no art.

### mob_roster — boss
```sql
INSERT INTO mob_roster
  (name, mythology, mob_type, base_hp, base_atk, base_def, base_crit,
   hp_per_level, atk_per_level, def_per_level,
   skill_key, skill_name, skill_description, immunity_tags, special_flags)
VALUES
  -- immunity-only boss: skill_key 'none', immunity in immunity_tags
  ('Fenrir', 'Norse', 'boss', 13000, 1100, 280, 25.0,
   260, 32, 10,
   'none', '—', 'Basic attacks only; immune to Bleed and Stun.',
   '["bleed","stun"]'::jsonb, '{}'::jsonb),
  -- boss with first-strike flag
  ('Sleipnir', 'Norse', 'boss', 12000, 1050, 300, 30.0,
   240, 30, 12,
   'none', '—', 'Always strikes first; immune to Stun.',
   '["stun"]'::jsonb, '{"first_strike": true}'::jsonb),
  -- boss with multi-attack flag
  ('Cerberus', 'Greek', 'boss', 14000, 880, 300, 15.0,
   280, 26, 12,
   'none', '—', 'Attacks twice per round (60% ATK each); immune to Stun.',
   '["stun"]'::jsonb, '{"multi_attack": 2, "multi_attack_pct": 0.60}'::jsonb),
  -- boss with an active per-turn skill (skill_key used)
  ('Hydra', 'Greek', 'boss', 17000, 745, 420, 10.0,
   340, 22, 14,
   'hydra_regen', 'Regeneration', 'Regenerates 5% max HP every 3rd turn (local instance; net damage only).',
   '["def_down"]'::jsonb, '{}'::jsonb);
```

**immunity_tags vocabulary** (use these exact strings): `stun`, `paralyze`, `freeze`, `petrify`, `charm`, `confuse`, `miss`, `bleed`, `burn`, `atk_down`, `def_down`, `crit_down`, `armor_pierce`, `hp_pct_dot`, and the catch-all `all_debuffs`. (All bosses are auto-immune to `hp_pct_dot` in the engine, so you don't need to list it.)

**special_flags keys** (boss only): `first_strike` (bool), `multi_attack` (int, hits per round), `multi_attack_pct` (decimal, ATK% per hit).

---

## PART 4 — ASSET STORAGE & FOLDER STRUCTURE

DB stores filenames only (roster art). Static UI/animation assets are referenced by fixed paths in code, so their names must be stable constants. All files: lowercase `snake_case`, `.png`, ASCII only.

```
/assets
  /deities/                 ← <deity_slug>.png      (roster image_filename)
      bathala.png  odin.png  skadi.png  skadi_the_huntress.png  ...
  /weapons/                 ← <weapon_slug>.png     (roster image_filename)
      freyrs_arrow.png  mjolnir.png  ...
  /classes/                 ← character-creation thumbnails
      swordsman.png  fighter.png  mage.png  knight.png  archer.png
  /essence/                 ← NEW (essence resource icons)
      epic_essence.png  mythic_essence.png  legendary_essence.png  supreme_essence.png
  /items/
      credux_coin.png
      sacred_relic.png
      supreme_relic.png
      /chests/              ← static chest icons (bag display)
          silver_chest.png  gold_chest.png  boss_treasure_chest.png
          boss_golden_chest.png  supreme_chest.png
  /animations/
      /gacha/               ← deity card-flip (4 tier colors + flip states)
          card_back.png
          card_flip_a.png  card_flip_b.png
          card_remnant.png  card_awakened.png  card_undying.png  card_primordial.png
      /chests/              ← 4 frames × 5 chests = 20 PNGs
          silver_1_idle.png       silver_2_shake.png       silver_3_crack.png       silver_4_burst.png
          gold_1_idle.png         gold_2_shake.png         gold_3_crack.png         gold_4_burst.png
          boss_treasure_1_idle.png ... boss_treasure_4_burst.png
          boss_golden_1_idle.png   ... boss_golden_4_burst.png
          supreme_1_idle.png       ... supreme_4_burst.png
      /relics/              ← sacred 3 frames, supreme 3 frames
          sacred_1.png  sacred_2.png  sacred_3.png
          supreme_1.png supreme_2.png supreme_3.png
```

**Naming rules by folder**

| Folder | Filename pattern | Source of truth |
|---|---|---|
| `/deities` `/weapons` | `<entity_slug>.png` | the `image_filename` you store in the roster row |
| `/classes` | `<class_lowercase>.png` | fixed (5 classes) |
| `/essence` | `<tier>_essence.png` | fixed (epic/mythic/legendary/supreme) |
| `/items` `/items/chests` | fixed names above | code constants |
| `/animations/gacha` | `card_back`, `card_flip_a/b`, `card_<tier_alias>` | tier aliases: remnant/awakened/undying/primordial |
| `/animations/chests` | `<chest_key>_<frame#>_<state>.png` | chest keys: silver/gold/boss_treasure/boss_golden/supreme; states: idle→shake→crack→burst |
| `/animations/relics` | `<sacred|supreme>_<frame#>.png` | 3 frames each |

**Supreme rainbow shimmer** (Supreme chest + Supreme relic): the burst/reveal frame needs several hue-rotated variants swapped rapidly. Suffix them: `supreme_4_burst_h1.png`, `_h2.png`, `_h3.png` (and `supreme_3_h1.png …` for the relic). Number of hue steps is up to you (3–6 reads well).

**New assets to add for this build** (not in the original asset list): the 4 `/essence/*.png` icons (essence is a new resource). Mobs have no art (no `/mobs` folder).

---

## Status
Master + Blueprint + schema are patched to match these conventions (v4-patch): one round-based clock, 1-turn debuffs / 2-tick DOTs, mob tables have no lore/image, `is_available` soft-delete on weapon/deity rosters, `is_locked` on user_weapons + the lock/sell commands, FK ON DELETE SET NULL, and participation-only boss rewards. Seed the roster INSERTs using the templates above.
