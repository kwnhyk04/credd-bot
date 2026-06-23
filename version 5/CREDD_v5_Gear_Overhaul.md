# CREDD v5 — GEAR OVERHAUL (Weapons split + Armor system)

# Companion DDL: credd_schema_v5_migration.sql (run that to reshape the DB)

# Scope of THIS doc: the weapon/armor split only — the content + stat config + art list you need

# before seeding and before generating armor art. Pantheon / ranked / leaderboards / runes content

# is designed in the thread and scaffolded in the SQL, but not seeded here.

---

## A. WHAT CHANGES (one-paragraph summary)

Shields leave the weapon pool entirely and become the seed of a new **armor** system. Weapons now
carry **ATK + CRIT only** (HP/DEF removed). Armor carries **HP + DEF only** (no CRIT). Gloves **stay**
weapons. Surviving weapon types are **Sword · Staff · Gloves · Bow**. Armor types are **Heavy ·
Medium · Light**. A second equipment slot (`equipped_armor_id`) and a `crd bag armors` view are added.
Aegis and Helm of Darkness are **promoted from Legendary shield → Supreme armor**.

---

## B. WEAPON ROSTER (post-split)

### B.1 Rows that LEAVE weapon_roster (the 14 shields → migrate to armor_roster)

Wooden Shield · Iron Buckler · Steel Kite Shield · Reinforced Targe · Vatican Aspis · Battersea
Shield · Enderby Shield · Dipylon Shield · Pelte · Shield of the Valkyrie · Skjaldmaer · Luzon
Tribal Shield · **Aegis** · **Helm of Darkness**.

> These are re-authored as `armor_roster` rows in §C. The two in **bold** are promoted to Supreme.
> Test-stage guidance: any `user_weapons` row pointing at a shield should be wiped or re-seeded
> (see SQL §5). In production you'd migrate them to `user_armors`.

### B.2 Surviving weapon rows — UNCHANGED

Every non-shield weapon row in `weapon_roster` stays exactly as seeded (name, mythology,
passive_key, lore, image). No edits. The only roster-level change is the `type` CHECK constraint
losing `'Shield'`. Surviving lineup by tier:

- **Common:** Initiate's Blade (Sword, starter)
- **Rare:** Swords — Iron Sword, Steel Longsword, Cutlass, Kampilan · Gloves — Iron Knuckles, Steel Gauntlets, War Club, Bone Crusher · Staffs — Wooden Staff, Apprentice Staff, Crystal Wand, Carved Totem · Bows — Wooden Bow, Hunting Bow, Recurve Bow, Crossbow
- **Mythic:** Swords — Katana, Gladius, Scimitar, Xiphos, Kopis · Gloves — Roman Cestus, Pata, Bagh Nakh, Caestus, Myrmex · Staffs — Japanese Bo, English Quarterstaff, Egyptian Asa, Pilgrim's Bordone, Dory, Thyrsus · Bows — Holmegaard Bow, Scandinavian Glacial Wooden Bow, Scythian Composite Bow, Arrow of Eros, Cretan Bow
- **Legendary:** Swords — Juru Pakal, Gram, Tyrfing, Laevateinn Sword, Harpe, Sword of Damocles, Labrys · Gloves — Jarngreipr, Gridr Iron Gloves, Alan's Reversed Hands, Knuckle Charm Anting-Anting, Hephaestus Hammer · Staffs — Laevateinn Staff, Galdrastafir, Babaylan's Ritual Staff, Badiang Stalk, Caduceus, Spear of Ares · Bows — Gusisnautar, Freyr's Arrow, Apollo's Silver Bow
- **Supreme:** Mjolnir, Gungnir, Thunderbolt of Zeus, Trident of Poseidon

> **OPEN FLAG — Supreme weapon type coverage.** Your 4 Supreme weapons leave **no Supreme Sword** and
> uneven type spread. Stat-wise this barely matters (Supreme ATK is fixed 800, no CRIT), so types only
> differentiate Supreme weapons by passive. Confirm the 4 types against your existing DB rows / art;
> I did **not** reassign them. If you want full type coverage at Supreme, that's a separate "author a
> Supreme Sword" task — out of scope here.

### B.3 Weapon stat banding (NEW — replaces the 4-stat weapon banding in §35.6)

Weapons roll **ATK + CRIT** only. ATK uses your existing per-tier ranges (§7), positioned by type.
CRIT is re-banded by type and **uncapped** (the 40%/45% ceiling is removed — class CRIT growth in §11
still applies and now stacks freely on top).

**ATK roll by tier × type** (position within the tier's ATK range):

| Tier      | Staff (top 20%) | Gloves (top 40%) | Bow (top 40%) | Sword (mid 40–60%) |
| --------- | --------------- | ---------------- | ------------- | ------------------ |
| Rare      | 140–150         | 130–150          | 130–150       | 120–130            |
| Mythic    | 320–350         | 290–350          | 290–350       | 260–290            |
| Legendary | 580–600         | 560–600          | 560–600       | 540–560            |
| Supreme   | 800 fixed       | 800 fixed        | 800 fixed     | 800 fixed          |

**CRIT roll by type** (same across Rare/Mythic/Legendary; Supreme = none):

| Type   | CRIT roll |
| ------ | --------- |
| Bow    | 8–12%     |
| Sword  | 5–8%      |
| Gloves | 2–4%      |
| Staff  | 1–2%      |

Identity logic: Staff = raw ATK / near-zero crit · Bow = crit-fisher · Sword = balanced ATK + strong
crit (its new identity now HP/DEF are gone) · Gloves = high consistent ATK, low crit, leans on passive.

> **DECISION you already made:** ceiling removed, class CRIT growth kept. Consequence to watch in the
> power-budget pass: Archer (~39% class crit at L50) + a 12% Bow + Precision runes can exceed ~50%
> crit with no clamp. Intended (crit-build fantasy), but it's the burst ceiling you tune boss DEF and
> ranked against.

---

## C. ARMOR ROSTER (new table `armor_roster`)

Three types by stat lean: **Heavy** (max DEF, lower HP) · **Medium** (balanced) · **Light** (high HP,
lower DEF). Armor carries **no CRIT**. Existing shields are re-authored as armor rows below; new pieces
fill the Light gap and the empty Supreme tier, weighted toward PH for parity.

Legend: **[migrated]** = was a shield, passive unchanged · **[promoted]** = shield → Supreme ·
**[NEW]** = author art + needs a passiveRegistry function (see §E).

### Common (starter — granted at character creation alongside Initiate's Blade)

| Name            | Type   | Mythology | passive_key | Passive | Status                      |
| --------------- | ------ | --------- | ----------- | ------- | --------------------------- |
| Initiate's Garb | Medium | Common    | none        | —       | **[NEW]** (starter; see §F) |

### Rare

| Name              | Type   | Mythology | passive_key       | Passive                                              | Status                 |
| ----------------- | ------ | --------- | ----------------- | ---------------------------------------------------- | ---------------------- |
| Steel Kite Shield | Heavy  | Common    | steel_kite_shield | Bulwark — 10% chance to block 15% of incoming damage | [migrated]             |
| Kalasag           | Heavy  | PH        | kalasag           | Bulwark Hide — reduces incoming damage by 8%         | **[NEW]**              |
| Iron Buckler      | Medium | Common    | none              | —                                                    | [migrated]             |
| Reinforced Targe  | Medium | Common    | reinforced_targe  | Opening Strike — first hit deals +20% ATK            | [migrated] ⚠ offensive |
| Wooden Shield     | Light  | Common    | none              | —                                                    | [migrated]             |
| Baluti Vest       | Light  | PH        | none              | —                                                    | **[NEW]**              |

### Mythic

| Name             | Type   | Mythology | passive_key      | Passive                                                  | Status              |
| ---------------- | ------ | --------- | ---------------- | -------------------------------------------------------- | ------------------- |
| Vatican Aspis    | Heavy  | Other     | vatican_aspis    | Sacred Guard — all damage taken −10%, ATK +10%           | [migrated] ⚠ hybrid |
| Battersea Shield | Heavy  | Other     | battersea_shield | Iron Stance — DEF +25% for first 2 turns                 | [migrated]          |
| Dipylon Shield   | Heavy  | Greek     | dipylon_shield   | Hoplite Wall — DEF +20% for first 3 turns                | [migrated]          |
| Enderby Shield   | Medium | Norse     | enderby_shield   | Thornward — 10% chance to reflect 30% of incoming damage | [migrated]          |
| Salakot Ward     | Medium | PH        | salakot_ward     | Spirit Ward — 20% chance to negate an incoming debuff    | **[NEW]**           |
| Pelte            | Light  | Greek     | pelte            | Deflection — 15% chance to block 25% of incoming damage  | [migrated]          |
| Wolfskin Cloak   | Light  | Norse     | wolfskin_cloak   | Wolf's Vigor — regen 3% max HP at start of each turn     | **[NEW]**           |

### Legendary

| Name                   | Type   | Mythology | passive_key            | Passive                                                                | Status              |
| ---------------------- | ------ | --------- | ---------------------- | ---------------------------------------------------------------------- | ------------------- |
| Shield of the Valkyrie | Heavy  | Norse     | shield_of_the_valkyrie | Valkyrie's Resolve — each hit taken: +5% DEF & +5% ATK, up to 30% each | [migrated] ⚠ hybrid |
| Hoplite Panoply        | Heavy  | Greek     | hoplite_panoply        | Phalanx Wall — reduces incoming damage by 15%                          | **[NEW]**           |
| Skjaldmaer             | Medium | Norse     | skjaldmaer             | Shieldmaiden's Guard — 15% chance to ignore incoming damage            | [migrated]          |
| Luzon Tribal Shield    | Medium | PH        | luzon_tribal_shield    | Tribal Ward — while debuffed, +40% DEF until it expires                | [migrated]          |
| Anting-Anting Sash     | Light  | PH        | anting_anting_sash     | Charmed Hide — negates the first debuff applied each battle            | **[NEW]**           |
| Valkyrie's Mantle      | Light  | Norse     | valkyrie_mantle        | Chooser's Grace — 15% chance to evade an incoming attack               | **[NEW]**           |

### Supreme

| Name              | Type   | Mythology | passive_key       | Passive                                                                       | Status     |
| ----------------- | ------ | --------- | ----------------- | ----------------------------------------------------------------------------- | ---------- |
| Aegis             | Heavy  | Greek     | aegis             | Medusa's Gaze — 20% on hit: Stone stack; at 3, stun 1 turn, reset             | [promoted] |
| Mail of Brokkr    | Heavy  | Norse     | mail_of_brokkr    | Dwarven Forge — all incoming damage −20%; reflect 15% of damage taken         | **[NEW]**  |
| Mantle of Bathala | Medium | PH        | mantle_of_bathala | Divine Aegis — first 2 hits each battle −50%; every 3rd turn cleanse 1 debuff | **[NEW]**  |
| Helm of Darkness  | Light  | Greek     | helm_of_darkness  | Invisibility — 25% each turn: enemy misses its next attack                    | [promoted] |

**Counts:** Rare 6 (2H/2M/2L) · Mythic 7 (3H/2M/2L) · Legendary 6 (2H/2M/2L) · Supreme 4 (2H/1M/1L)

- 1 Common starter. **PH armor: 1 → 6 pieces.**

### C.1 Armor stat banding (config)

Lower tiers roll within the tier range, positioned by type. Supreme is **fixed by type** (no roll).

| Tier      | HP range | DEF range |
| --------- | -------- | --------- |
| Rare      | 100–200  | 50–75     |
| Mythic    | 300–400  | 80–150    |
| Legendary | 600–800  | 200–300   |

Position within range by type — **Heavy:** HP bottom 40% / DEF top 20% · **Medium:** both mid 40–60% ·
**Light:** HP top 20% / DEF bottom 40%. Resulting effective bands:

| Tier      | Heavy (HP / DEF)  | Medium (HP / DEF) | Light (HP / DEF)  |
| --------- | ----------------- | ----------------- | ----------------- |
| Rare      | 100–140 / 70–75   | 140–160 / 60–65   | 180–200 / 50–60   |
| Mythic    | 300–340 / 136–150 | 340–360 / 108–122 | 380–400 / 80–108  |
| Legendary | 600–680 / 280–300 | 680–720 / 240–260 | 760–800 / 200–240 |

**Supreme — fixed:**

| Type   | HP    | DEF |
| ------ | ----- | --- |
| Heavy  | 1,000 | 600 |
| Medium | 1,200 | 500 |
| Light  | 1,400 | 400 |

> Armor enhancement reuses the **weapon boost table** unchanged (×1.00 … ×2.00, §35.6) — it just
> scales HP/DEF instead of ATK/HP/DEF.

---

## D. ART LIST (what you need to generate)

You only need NEW art for the **[NEW]** pieces — migrated/promoted shields already have art. Filenames
follow your convention (`/assets/armors/<slug>.png`, filename-only in DB, nullable until ready):

| Piece              | Suggested filename     |
| ------------------ | ---------------------- |
| Initiate's Garb    | initiates_garb.png     |
| Kalasag            | kalasag.png            |
| Baluti Vest        | baluti_vest.png        |
| Salakot Ward       | salakot_ward.png       |
| Wolfskin Cloak     | wolfskin_cloak.png     |
| Hoplite Panoply    | hoplite_panoply.png    |
| Anting-Anting Sash | anting_anting_sash.png |
| Valkyrie's Mantle  | valkyrie_mantle.png    |
| Mail of Brokkr     | mail_of_brokkr.png     |
| Mantle of Bathala  | mantle_of_bathala.png  |

> Migrated shields keep their existing shield art (just re-pathed to `/assets/armors/` if you want a
> clean folder split, or leave them under weapons — your call; the renderer reads filename only).

---

## E. NEW passive_keys — need passiveRegistry.js functions

Every key below is referenced by an `armor_roster` row above and currently has **no** implementation.
Add a function for each (per §35.1 timing rules) before these pieces go live, or they no-op:

| passive_key        | Effect to implement                                               |
| ------------------ | ----------------------------------------------------------------- |
| kalasag            | Flat −3% to incoming damage (after DEF mitigation).               |
| salakot_ward       | On debuff application, 20% chance to negate it.                   |
| wolfskin_cloak     | +10% max HP at start of each round.                               |
| hoplite_panoply    | Flat −15% to incoming damage (after DEF mitigation).              |
| anting_anting_sash | Immunity to Stun, Petrify, and Freeze.                            |
| valkyrie_mantle    | 20% per-hit evade roll (independent, see evade cap below).        |
| mail_of_brokkr     | 30% incoming damage AND reflect 15% of damage taken to attacker.  |
| mantle_of_bathala  | Increases HP and DEF by 5% every turn, stacking up to +100% each. |

> **Power-budget interaction:** these stack with pantheon support blessings + armor runes. Watch
> two combos in the retune — (1) multiple evade sources (valkyrie_mantle + Amihan/Loki/Tailwind) →
> cap **total** evade at 40%; (2) stacked flat damage-reduction (kalasag/hoplite_panoply/mail_of_brokkr
>
> - Knight 20% + Vatican Aspis 10%) → consider a combined damage-reduction cap so a wall build can't
>   approach immunity.

---

## F. OPEN DECISIONS (small — won't block art generation)

1. **Offensive passives on armor** (⚠ rows): Reinforced Targe (+20% first-hit ATK), Vatican Aspis
   (+10% ATK), Shield of the Valkyrie (+5% ATK/hit) carry offensive/hybrid riders. Fine as
   "battle-buff armor," or swap them to pure-defensive passives for a strict offense/defense split.
   Default: kept as-is.
2. **Starter armor:** Initiate's Garb is proposed so a fresh character isn't pure glass once HP lives
   only on armor. Grant it at `crd create character` exactly like Initiate's Blade (SQL handles the
   row; wire the grant in your creation flow). If you'd rather class base HP carry the floor alone,
   drop this piece.
3. **Mythology tags** for Vatican Aspis / Battersea (tagged `Other`) and Enderby (`Norse`): set to
   whatever your existing DB rows use — adjust the seed INSERTs if they differ.
4. **Armor chest source:** armor needs a drop faucet. Recommend a dedicated armor chest rather than
   diluting the weapon chest pool. Out of scope here — flag for the drop-table pass.

---

## G. SOCKET / RUNE LANES (recap — scaffolded in SQL, not seeded)

- **Weapon** native sockets = **offensive** runes (Sharpness/ATK, Precision/CRIT, Vampiric/lifesteal,
  Piercing/DEF-ignore, Venom/DOT). Bought "opposite" sockets = defensive.
- **Armor** native sockets = **defensive** runes (Vitality/HP, Bulwark/DEF, Thorns/reflect,
  Warding/DOT-reduction, Aegis/damage-reduction). Bought "opposite" sockets = offensive.
- Native slot counts roll at drop; opposite slots are bought with same-tier essence (Mythic+).
- `native_sockets` / `opposite_sockets` JSONB columns are added to both `user_weapons` and
  `user_armors` now so gear is socket-ready; rune CONTENT seeding is a follow-up.

_End of v5 Gear Overhaul spec._
