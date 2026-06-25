# CREDD v5 — STAT ASSEMBLY REFERENCE
# How a character's final battle stats are computed from class + level + weapon + armor + runes (+ pantheon).
# This is the glue that turns equipped_weapon_id / equipped_armor_id into actual combat numbers.
# Companion: CREDD_v5_Gear_Overhaul.md (rosters/banding) + credd_schema_v5_migration.sql (columns).

---

## 0. The four stats

A character fights with exactly four numbers: **HP, ATK, DEF, CRIT** — plus the equipped weapon's
**unified damage bonus** (`bonus_dmg_pct`), carried separately into the per-hit damage step (§1b).
- **ATK** comes from class + weapon (+ offensive runes + pantheon).
- **HP / DEF** come from class + armor (+ defensive runes).
- **CRIT** comes from class + weapon + Precision runes. **No ceiling** (v5 removed the 40/45 clamp).
- **Unified bonus** (`bonus_dmg_pct`) comes from the weapon's passive (Legendary 25% proc / Supreme 50%
  guaranteed); it is general damage that is crit-eligible and stacks ADDITIVELY with crit (see §1b).

Source of each, post-split:

| Stat | Class+Level | Weapon | Armor |
|---|---|---|---|
| HP   | ✅ | ❌ (removed) | ✅ |
| ATK  | ✅ | ✅ | ❌ |
| DEF  | ✅ | ❌ (removed) | ✅ |
| CRIT | ✅ (growth) | ✅ (rolled) | ❌ (none) |

---

## 1. The pipeline (run in this exact order)

Compute once at battle start; the result is the character's pre-combat stat block. Per-turn blessings,
buffs, and DOTs (§35.1) apply ON TOP of this block during the fight — they are NOT part of assembly.

### Step 1 — Class base (level-scaled)
From §11 class tables. For each of HP/ATK/DEF/CRIT:
```
classStat = base[class] + perLevel[class] × (combat_level − 1)
```
This is the floor every character has with NO gear.

### Step 2 — Weapon contribution (ATK + CRIT only)
Read the equipped row from `user_weapons` (via `equipped_weapon_id`). Its `curr_atk` and `crit`
already include weapon enhancement (curr_atk = floor(base_atk × weaponBoostTable[enhancement])).
```
weaponATK  = curr_atk
weaponCRIT = crit
```
If `equipped_weapon_id IS NULL` → weaponATK = 0, weaponCRIT = 0 (character fights bare-handed).

### Step 3 — Armor contribution (HP + DEF only)
Read the equipped row from `user_armors` (via `equipped_armor_id`). `curr_hp` / `curr_def` already
include armor enhancement (same weaponBoostTable).
```
armorHP  = curr_hp
armorDEF = curr_def
```
If `equipped_armor_id IS NULL` → armorHP = 0, armorDEF = 0.
**This is why a starter armor (Initiate's Garb) matters:** with no armor, ALL survivability rests on
class HP alone. Grant the starter, or accept fresh characters are glass by design.

### Step 4 — Rune contribution (from BOTH gear pieces' sockets)
Walk every socketed rune on the equipped weapon AND the equipped armor — native and opposite slots —
and accumulate by stat. Runes are stored in `native_sockets` / `opposite_sockets` JSONB on each gear
row; each entry resolves to a `user_runes` + `rune_roster` row. Use
`COALESCE(user_runes.rolled_value, rune_roster.value)` as the rune value:
owned runes roll once at acquisition, while rune_roster.value remains the fallback.

```
Σ runeATK%   = sum of Sharpness  values   (offense lane)
Σ runeCRIT   = sum of Precision  values   (offense lane, flat % points)
Σ runeHP%    = sum of Vitality   values   (defense lane)
Σ runeDEF%   = sum of Bulwark    values   (defense lane)
# effect runes (Vampiric/Piercing/Venom/Thorns/Warding/Aegis) are NOT stat-adds —
# they register as combat hooks for the engine, applied during the fight, not here.
```
Reminder on lanes: weapon native = offense runes, weapon opposite (bought) = defense runes;
armor native = defense runes, armor opposite (bought) = offense runes. Assembly doesn't care which
piece a rune sits on — it sums by lane/effect. The socket RULES only gate what can be slotted where.

### Step 5 — Combine into the pre-combat block
Stat-% runes apply to the COMBINED base of that stat (class + gear), not to gear alone:
```
finalHP   = (classHP  + armorHP)  × (1 + ΣruneHP%/100)
finalDEF  = (classDEF + armorDEF) × (1 + ΣruneDEF%/100)
finalATK  = (classATK + weaponATK) × (1 + ΣruneATK%/100)
finalCRIT =  classCRIT + weaponCRIT + ΣruneCRIT        # additive flat %, uncapped
```

### Step 6 — Pantheon (if slots 2/3 used)
Deity stat contribution is added to the block per the pantheon rule (main 100% / slot3 50% / slot2 25%
of the deity's curr_hp/curr_atk/curr_def). Deity stats add as FLAT values to finalHP/finalATK/finalDEF
AFTER the rune multiplier (deities are not gear, runes don't scale them):
```
finalHP  += mainDeityHP×1.0  + slot3HP×0.50  + slot2HP×0.25
finalATK += mainDeityATK×1.0 + slot3ATK×0.50 + slot2ATK×0.25
finalDEF += mainDeityDEF×1.0 + slot3DEF×0.50 + slot2DEF×0.25
```
(Blessings — the per-turn effects — are separate; they fire during combat. Binary blessings only fire
from the MAIN slot; scalable blessings fire at 100/50/25 per slot. See blessing_scaling tag.)

### Result
`{ finalHP, finalATK, finalDEF, finalCRIT, weaponBonusDmgPct }` = the block the battle engine starts
the fight with. Everything in §35.1 (DOTs, CC, stacking buffs, blessings, weapon/armor passives, effect
runes) layers on top of this during turns.

> `weaponBonusDmgPct` = the equipped weapon's `bonus_dmg_pct` (the UNIFIED passive damage bonus —
> Legendary 25% chance-proc / Supreme 50% guaranteed; 0 if the weapon has no such passive). It is read
> straight off user_weapons.bonus_dmg_pct, NOT rolled or scaled by runes. Carry it into the damage step
> below.

---

## 1b. Per-hit damage resolution (where CRIT and the unified bonus combine)

Assembly (above) produces the stat block ONCE. The following runs PER HIT during combat. The unified
weapon bonus is **general damage that is itself crit-eligible**, and it stacks **ADDITIVELY** with the
crit multiplier — it does NOT multiply it.

```
baseHit   = finalATK × (1 - enemyDEFmitigation)        # normal damage math, DEF/(DEF+200) etc.
critRoll  = random() < finalCRIT/100                    # uncapped crit chance
critMult  = critRoll ? 2.0 : 1.0                        # base crit is ×2.0

# unified weapon bonus: applies to the hit, and ADDS to the multiplier (does not multiply it)
bonusMult = weaponBonusDmgPct / 100                     # Supreme 50% -> 0.50, Legendary proc 25% -> 0.25
                                                         # (Legendary: only when its chance-proc fires this hit)
finalHit  = baseHit × (critMult + bonusMult)
```

Worked cases for a Supreme weapon (weaponBonusDmgPct = 50):
- non-crit hit: ×(1.0 + 0.50) = **×1.5**
- crit hit:     ×(2.0 + 0.50) = **×2.5**   ← additive, NOT ×3.0

Legendary (25% chance-proc): on hits where the proc fires, add 0.25 the same way (crit+proc = ×2.25);
on hits where it doesn't fire, bonusMult = 0. Katana-style weapon passives that add their OWN crit-damage
(e.g. "+30% on crit") stack into this as additional additive terms on the multiplier, same rule.

> Phase-6 note: because it's additive, the unified bonus is bounded and easy to tune — a maxed crit+bonus
> hit tops out near ×2.5–2.8, not ×3+. Keep any future crit-damage sources ADDITIVE to preserve this.

---

## 2. Worked example (no pantheon, no runes — the clean baseline)

Level 50 **Knight**, Legendary **Heavy** armor (curr 660 HP / 290 DEF), Mythic **Bow** (curr 340 ATK / 10% crit):

```
Step 1 class@50: HP 1000+150×49=8350 · ATK 200+30×49=1670 · DEF 300+50×49=2750 · CRIT 5%+0×49=5%
Step 2 weapon:   ATK 340 · CRIT 10%
Step 3 armor:    HP 660 · DEF 290
Step 4 runes:    none
Step 5 combine:  finalHP 9010 · finalATK 2010 · finalDEF 3040 · finalCRIT 15%
```
Same Knight with **no armor**: finalHP 8350, finalDEF 2750 — survivable on class alone, but ~7% less
HP and ~10% less DEF, and zero defensive passive/socket access. The gap widens hard at low levels
(early class HP is small), which is the whole argument for a starter armor piece.

---

## 3. Implementation notes / gotchas

- **One enhancement table, two slots.** Both `user_weapons` and `user_armors` use weaponBoostTable
  (×1.00…×2.00). curr_* columns are pre-computed on enhancement, so assembly just reads them — no
  re-derivation at battle time.
- **NULL slots are valid.** Treat missing weapon/armor as zero contribution, never an error. A
  registered-but-bare character must still produce a legal stat block.
- **Stat-% runes scale the combined base, effect runes don't touch assembly.** Keep the two rune
  kinds in separate code paths: stat runes feed Step 4/5; effect runes (lifesteal, DEF-ignore, DOT,
  reflect, DOT-reduction, damage-reduction) register as engine hooks consumed during turns.
- **CRIT is flat-additive and uncapped.** class + weapon + Precision, summed. Confirm nothing else
  re-imposes the old 45% clamp downstream.
- **Order matters for the power budget.** Because stat-% runes multiply (class+gear) and deities add
  flat after, a whale stacks: big class base × rune multiplier + flat deity stack. That compounding
  is exactly what the pre-launch boss retune must be measured against — model a max build through
  this pipeline and tune boss HP/DEF to it.
- **Profile/battle embeds** now read both slots: show equipped weapon (ATK/CRIT contribution) and
  equipped armor (HP/DEF contribution) as separate lines.

*End of stat assembly reference.*
