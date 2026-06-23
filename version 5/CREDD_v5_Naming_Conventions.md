# CREDD v5 — NAMING CONVENTIONS (read before implementing any phase)

# Consistency across SQL / engine / art is mandatory — a mismatched slug silently breaks lookups.

---

## 1. Slugs (lowercase, snake_case, ASCII)

Rule: lowercase the display name, strip apostrophes/punctuation, replace spaces & hyphens with `_`,
collapse repeats. The slug is the single shared token used for passive_key, effect_key, image filename
(slug + `.png`), and asset lookups.

| Display name       | slug               |
| ------------------ | ------------------ |
| Initiate's Garb    | initiates_garb     |
| Steel Kite Shield  | steel_kite_shield  |
| Kalasag            | kalasag            |
| Baluti Vest        | baluti_vest        |
| Reinforced Targe   | reinforced_targe   |
| Vatican Aspis      | vatican_aspis      |
| Salakot Ward       | salakot_ward       |
| Wolfskin Cloak     | wolfskin_cloak     |
| Hoplite Panoply    | hoplite_panoply    |
| Anting-Anting Sash | anting_anting_sash |
| Valkyrie's Mantle  | valkyrie_mantle    |
| Mail of Brokkr     | mail_of_brokkr     |
| Mantle of Bathala  | mantle_of_bathala  |
| Helm of Darkness   | helm_of_darkness   |

> Apostrophes are dropped, NOT converted (`Valkyrie's` → `valkyrie`). Hyphens become `_`
> (`Anting-Anting` → `anting_anting`). This matches your existing weapon/deity slug rules.

---

## 2. Keys

- **passive_key** (armor_roster.passive_key) = the armor's slug. `none` for no-passive pieces.
  Each non-`none` key MUST have a function in passiveRegistry.js (Master §35.1 effect text).
- **effect_key** (rune_roster.effect_key) = the rune family's mechanical key (NOT the display name
  when they'd collide). Fixed list — these are engine hooks:
  `sharpness, precision, vampiric, piercing, venom, vitality, bulwark, thorns, warding, aegis_rune`.
  (`aegis_rune`, not `aegis`, to avoid colliding with the Aegis ARMOR passive_key.)
- **blessing_scaling** (deity_roster) = `scalable` | `binary`.

---

## 3. Tiers & types (exact CHECK strings)

- Weapon type: `Sword` `Staff` `Gloves` `Bow` (Shield removed)
- Armor type: `Heavy` `Medium` `Light`
- Gear tier: `Common` `Rare` `Mythic` `Legendary` `Supreme` (armor uses all five; weapons unchanged)
- Rune lane: `offense` `defense`
- Rune tier: same five-tier ladder as gear
- PvP bracket (code-side enum, not a DB CHECK unless you add one):
  `Mortal` `Champion` `Demigod` `Ascendant` `Divine`

---

## 4. IDs

- weapon_id / armor_id / rune_uid: app-generated, 8-char, globally unique, VARCHAR(8). Same generator
  as existing weapon_id. **weapon_id and armor_id must be unique across BOTH gear tables** — when
  generating an armor_id, check uniqueness against user_weapons AND user_armors (and vice-versa), so
  `crd equip` / `crd equipment info` / `crd enhance` never hit an ambiguous id. rune_uid lives in its
  own namespace (user_runes) and need not be unique against gear ids.

---

## 5. Socket JSONB shape

`native_sockets` / `opposite_sockets` on user_weapons and user_armors are JSONB ARRAYS, one entry per
slot. A slot is either empty or holds a rune reference:

```json
[
  { "slot": 1, "rune_uid": "a1b2c3d4" },
  { "slot": 2, "rune_uid": null }
]
```

- Array length = the slot COUNT rolled at drop (native) or bought (opposite). An empty array = 0 slots.
- `rune_uid` null = empty socket. Non-null = points at a user_runes row (which back-references via
  user_runes.socketed_into = this gear's id).
- Lane is implicit by which array the slot lives in:
  - WEAPON: native_sockets = offense lane · opposite_sockets = defense lane
  - ARMOR: native_sockets = defense lane · opposite_sockets = offense lane
- Socketing validates: rune.lane must equal the slot's lane.

---

## 6. Asset paths

- Armor art: `/assets/armors/<slug>.png` (DB stores filename only, e.g. `kalasag.png`, nullable)
- Weapon art: `/assets/weapons/<slug>.png` (unchanged)
- Rune icons: `/assets/runes/<effect_key>.png` (one icon per family; tier shown via frame/color)
- Armor chest animation: `/assets/animations/chests/armor_chest_<1..4>_<idle|shake|crack|burst>.png`
  (mirror the existing chest animation naming)

---

## 7. Command names (canonical; add aliases in aliases.js)

| Command                                   | Purpose                                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------ |
| `crd bag armors`                          | armor inventory (mirror `crd bag weapons`)                                                 |
| `crd equipment info [id]`                 | UNIFIED weapon+armor info card (alias `crd eq info`; `crd weapon info` = deprecated alias) |
| `crd bag runes`                           | rune inventory                                                                             |
| `crd open eb/geb/deb [amount]`            | open Lesser/Greater/Divine Essence Bag                                                     |
| `crd socket [gear_id] [rune_uid] [slot#]` | slot a rune                                                                                |
| `crd unsocket [gear_id] [slot#]`          | remove a rune                                                                              |
| `crd unlock socket [gear_id]`             | buy next opposite slot                                                                     |
| `crd exchange`                            | essence tier-up shop (one-way)                                                             |
| `crd deity equip [name] [slot]`           | set pantheon slot 1/2/3                                                                    |
| `crd ranked`                              | ranked PvP                                                                                 |
| `crd duel wager @user [amt]`              | wager duel                                                                                 |
| `crd leaderboard [category]`              | leaderboards (server/global toggle)                                                        |
| `crd title`                               | browse/equip titles                                                                        |
| `crd dev resetweapons [@user]`            | DEV: zero a user's weapons + armors ONLY (gear cleanup; logged)                            |

> `crd equip [id]` stays one command and auto-detects weapon vs armor by id lookup. `crd lock`,
> `crd unlock`, `crd enhance`, `crd sell` extend to armors (and optionally runes) — same verbs,
> id-type detection inside. **No separate armor chest** — armor drops from the existing chests via the
> weapon/armor gear-class roll (Blueprint Phase 1.2). There is no `crd open ac`.

---

## 8. users_bag additions (new columns this overhaul implies)

No `armor_chest` column — armor drops from the EXISTING chests via the weapon/armor gear-class roll
(Blueprint Phase 1.2), so no new chest currency is needed. The only possible additions are for essence
bags IF you choose to stockpile them: `lesser_essence_bag` / `greater_essence_bag` / `divine_essence_bag`.
If essence bags are crafted-and-opened instantly instead, no columns are needed at all. Decide
stockpile-vs-instant when you build Phase 2.

_End of naming conventions._
