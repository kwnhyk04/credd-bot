# CREDD Bot — June 20 2026 Balance & Bugfix Patch (Claude Code instructions)

You are working on **CREDD** ("The Last Believer"), a PostgreSQL + Discord.js RPG bot. The codebase is implemented through Phase 11. This patch gives each class a distinct stat identity, fixes a combat turn-order bug, adds a duel level parameter, retunes several passives, rescales the combat-EXP curve, and adds two small UX fixes.

## Ground rules (read first)

1. **Do not touch the database or any roster seed data.** The human has already run the SQL that updates the player-facing `*_description` text on `weapon_roster`, `deity_roster`, and `mob_roster`. Your job is code only. Do not write migrations, do not edit seed `INSERT`s, do not change `*_description` strings in code if they are sourced from the DB.
2. **Keep DB text and engine numbers in sync.** For every passive whose numbers change below, the DB description already reflects the new numbers; make the registry function match.
3. **No stat columns exist for the character.** `user_character` stores only `class` + `combat_level`. Character ATK/HP/DEF/CRIT are computed at runtime from class + level, so changing the class constants auto-applies to every existing player with no migration.
4. Where a file path is given it is the expected location from the project's config layout; if the actual path differs, locate the real module and apply the change there. Confirm each change compiles and existing battle/profile flows still run.
5. Work through the changes in order. After each, note the file(s) touched.

---

## 1. Class identity — per-class base stats + per-level scaling

**Files:** the class stat config (expected `src/config/classes.js` or equivalent) and any stat-aggregation/level-up/profile code that reads it. Per §35.2, total character ATK/HP/DEF = `class(level) + equipped weapon curr + active deity curr`; class CRIT caps at 40%, total (class+weapon) at 45%.

Replace the old uniform base (HP 500 / ATK 10 / DEF 10 / CRIT 5% for all classes) and the old scaling table with the values below.

**Base stats (Level 1):**

| Class     | HP   | ATK | DEF | CRIT |
| --------- | ---- | --- | --- | ---- |
| Swordsman | 700  | 225 | 225 | 5%   |
| Fighter   | 850  | 300 | 150 | 1%   |
| Mage      | 600  | 350 | 100 | 1%   |
| Knight    | 1000 | 200 | 300 | 5%   |
| Archer    | 600  | 300 | 150 | 5%   |

**Per-level scaling (added per level, i.e. stat = base + (level − 1) × perLevel):**

| Stat   | Swordsman | Fighter | Mage | Knight | Archer |
| ------ | --------- | ------- | ---- | ------ | ------ |
| HP +   | 55        | 70      | 40   | 100    | 55     |
| ATK +  | 55        | 70      | 100  | 30     | 85     |
| DEF +  | 55        | 25      | 25   | 50     | 25     |
| CRIT + | 0.7%      | 0.5%    | 0.5% | 0%     | 0.7%   |

**Requirements**

- `floor()` all computed curr stats (§35.2).
- Apply the CRIT caps: class crit ≤ 40%, total class+weapon ≤ 45%. With these numbers no class exceeds 40% at L50 (Swordsman/Archer reach ~39.3%), so the cap is a safety clamp, not a normal-case trigger. Knight keeps 0% CRIT growth (flat 5%).
- Make sure the new bases/scaling are used everywhere class stats are derived: profile card, raid/boss battle stat build, duel stat build, and any level-up recompute.
- No data migration — verify an existing mid-level player's profile now shows the new totals after deploy.

---

## 2. Combat resolution order — apply passive CC _after_ the attack (turn-order bug)

**File:** the battle engine turn/round resolver (raid + duel share the auto-battle engine).

**Symptom from live logs:** when both sides carry a CC passive (e.g. Thor `thor_mjolnirs_wrath` stun, Skadi `skadi_winters_hunt` freeze), the engine applies both CCs up front, then _neither_ combatant can act — a deadlock ("bot users cannot attack").

**Root cause:** stun/freeze/paralyze from passives are being applied/checked before the acting side has taken its attack, so a proc can cancel an action that was already due this round, and both sides can get pre-emptively locked in the same round.

**Required per-actor turn sequence (use this exact order):**

1. **Start-of-turn — beneficial passives only.** Run _only_ cleanses and heals that are authored "every turn / start of turn" for the actor whose turn it is: e.g. Babaylan's Ritual Staff cleanse, Caduceus (3rd-turn) cleanse+heal, Lakapati regen, Freyr/Idunn/Persephone heals, Bathala start-of-turn ramp (see §4). **No CC, no offensive procs here.**
2. **CC skip check.** If the actor currently has an active skip-CC (`stun`/`paralyze`/`freeze`/`petrify`/`charm`/`confuse`) applied by the opponent on a previous turn, the actor **skips its attack this turn**, and that 1-turn CC is consumed/expires now (§35.1). Then end the actor's turn.
3. **Attack.** If not skipped, the actor attacks: damage formula → DEF mitigation → class/weapon/deity offensive procs → CRIT → damage commit (§13.1 priority order 1–8).
4. **Apply outgoing CC + DOTs to the OPPONENT, after the hit lands.** Any stun/freeze/paralyze/Bleed/Burn the actor's passives proc now is written onto the **opponent** with 1-turn (CC) / 2-tick (DOT) duration. These take effect on the **opponent's next turn** — they must never retroactively cancel an action already resolved this round, and never re-lock the actor itself.
5. End the actor's turn; control passes to the opponent, which runs this same sequence.

**Critical invariants**

- Whoever wins the first-attack roll (raid/duel 50/50; player-first vs bosses; `first_strike` overrides) attacks first and therefore lands the first CC. The loser of the roll is **not** pre-stunned out of its own first action by a "simultaneous" proc.
- A CC only ever gates the **recipient's** next turn. Procced CC is directional (attacker → defender).
- Two opposing CC passives can no longer deadlock the round: each only affects the other side's upcoming turn, evaluated when that side's turn begins.
- Keep using the single round clock (`active_battles.current_turn`); do not add per-attack counters (§35.1).

---

## 3. `crd duel @user [level N]` — optional level normalization

**File:** the `crd duel` command parser + duel setup.

Extend the command to accept an optional trailing level argument:

- Accept all of: `crd duel @user level 50`, `crd duel @user level50`, `crd duel @user lvl 50`, `crd duel @user lvl50` (case-insensitive, space optional).
- Valid range **1–50** (50 is current max level). Reject/clamp out-of-range with a clear error message.
- **If omitted:** keep current behavior — each duelist fights at their own actual `combat_level`.
- **If provided:** both duelists are temporarily set to level **N** for that duel instance only. Recompute each player's **class-level stat component** (the §1 class base + scaling) at level N for both sides. Equipped weapon and active deity stats still apply as owned (this normalizes character level, not gear). Nothing is persisted — `user_character.combat_level` is untouched.

> ASSUMPTION (flag to the human): "same level" normalizes the class-stat component only; owned weapon/deity stats are unchanged. If the intent is to also strip or normalize gear, confirm and I'll adjust.

---

## 4. Passive registry number changes

**File:** `/engine/passiveRegistry.js`. The DB descriptions already match these; update the functions. Interpret everything per §35.1 (one round clock, `currentTurn % N === 0` cadence, 1-turn CC, 2-tick DOT, bonus hits are riders) and §35.2 (DEF-mitigated `+X% bonus ATK`).

**Weapon passives**

- `gungnir` — pierce-all-DEF proc chance **30% → 10%**. (Still ignores 40% DEF baseline; on a pierce, zero mitigation + enemy `def_down` 25% for 1 turn.)
- `mjolnir` — per-turn bonus **+20% → +30% ATK**; crush cadence **every 4th → every 3rd turn** (`currentTurn % 3 === 0`), crush stays 200% ATK.
- `trident_of_poseidon` — cadence **every 3rd → every 2nd turn** (`currentTurn % 2 === 0`); on proc: +100% bonus ATK **and** enemy `def_down` −20% for 1 turn; stun chance **25% → 30%** (1 turn).
- `thunderbolt_of_zeus` — bonus ATK **80% → 100%**; unchanged: 30% chance, paralyze 1 turn, auto-triggers on CRIT.

**Deity blessings**

- `zeus_thunder_sovereign` — bonus ATK **80% → 100%**; unchanged: every 3rd turn, enemy `def_down` −20% for 1 turn.
- `bathala_divine_vessel` — **full rework.** Old: "all stats +20% for first 3 turns." New: at the **start of each turn, before attacking** (this runs in step 1 of §2's sequence), add **+15%** to current ATK and DEF, **stacking additively up to a maximum of +105%** (i.e. +15% per turn, 7 stacks, cap reached on turn 7; hold at cap thereafter). Implement the % as additive-on-base (base × (1 + 0.15 × stacks), stacks ≤ 7), not compounding, since the +105% cap = 7 × 15%.
  - DEF/ATK just scale.
  - This is a self-buff window, not a debuff — it is unaffected by the 1-turn rule and does not get cleansed off Bathala.
    > ASSUMPTION (flag to the human): the HP portion heals as it grows (max and current both rise). If you want max-only (no heal), confirm.

**Mob / boss skill**

- `hydra_regen` — regen **5% → 1%** max HP every 3rd turn. Mechanic unchanged: per-instance local heal only; only NET damage commits to the shared boss pool; the shared pool is never healed.

---

## 5. Deity gacha drop rates

**File:** `config/dropRates.js` (deity gacha tier rates).

| Tier (display)       | Old | New                |
| -------------------- | --- | ------------------ |
| Epic (Remnant)       | 69% | **64.5%**          |
| Mythic (Awakened)    | 25% | **30%**            |
| Legendary (Undying)  | 5%  | **5%** (unchanged) |
| Supreme (Primordial) | 1%  | **0.5%**           |

New rates sum to 100.0%. Leave the pity system untouched (forced Legendary at 500; reset on any Legendary/Supreme).

---

## 6. Combat-EXP curve rescale (anti auto-grind)

**File:** `config/expTable.js` (combat-level EXP thresholds, L1–50).

**Why:** a user auto-raiding ~4 hours reached level 22 — the early curve is too shallow for the fixed 100–500 EXP/raid rewards, so auto-grinders blow through Tier 1. This rescale raises the floor most where the exploit lives (early/mid game), tapers toward the original shape at the top, keeps every per-level cost **strictly increasing**, and **fixes the old bug where 40→41 dropped below 39→40**.

Replace the EXP-required-to-next-level table with these values (EXP to go from level → level+1):

```
 1→2:        100      11→12:    17,000     21→22:   265,000     31→32:  1,450,000     41→42:  5,800,000
 2→3:        250      12→13:    24,000     22→23:   325,000     32→33:  1,680,000     42→43:  6,600,000
 3→4:        500      13→14:    33,000     23→24:   395,000     33→34:  1,950,000     43→44:  7,500,000
 4→5:        900      14→15:    45,000     24→25:   475,000     34→35:  2,250,000     44→45:  8,500,000
 5→6:      1,500      15→16:    60,000     25→26:   565,000     35→36:  2,600,000     45→46:  9,600,000
 6→7:      2,400      16→17:    80,000     26→27:   670,000     36→37:  3,000,000     46→47: 10,800,000
 7→8:      3,700      17→18:   105,000     27→28:   790,000     37→38:  3,450,000     47→48: 12,100,000
 8→9:      5,500      18→19:   135,000     28→29:   925,000     38→39:  3,950,000     48→49: 13,500,000
 9→10:     8,000      19→20:   175,000     29→30: 1,080,000     39→40:  4,500,000     49→50: 15,000,000
10→11:    12,000      20→21:   215,000     30→31: 1,250,000     40→41:  5,100,000
```

**Cumulative totals (for sanity / display):**

| Milestone | Old total  | New total   |
| --------- | ---------- | ----------- |
| Reach L20 | 220,150    | 708,850     |
| Reach L30 | 1,755,150  | 6,413,850   |
| Reach L40 | 10,055,150 | 32,493,850  |
| Reach L50 | 33,555,150 | 126,993,850 |

**Anti-grind check (the reason for the change):** at ~190 EXP/raid average (80% mob / 20% elite, ~90% win-rate), a hard auto-grinder doing ~576 raids in 4 h at the live 25 s raid cooldown earns ~109k EXP → now lands around **L14** instead of the previous ~L17–L22. Even an aggressive ~10 s-cooldown botter (~273k EXP/4 h) now reaches only ~L16 instead of ~L21–22. The first few levels are barely changed, so legitimate new players keep their early-game pace.

> If you'd prefer the absolute endgame to stay closer to the original "~12 months to L50," flatten Tiers 3–4 (levels 31–50) while keeping Tiers 1–2 as above — the exploit fix lives entirely in the early/mid curve. Ask the human if unsure; otherwise implement the table as given.

Update any displayed "total EXP to L50 (~33.5M)" copy to the new ~127M if such a string exists in profile/help text.

---

## 7. Category display "?" → weapon-drop-rates-per-box embed

**File:** the chest/category display command + its interaction handler.

In the category display, the question-mark icon should be interactive: clicking it shows a **floating (ephemeral) embed** listing **weapon drop rates per box/chest**, sourced from `config/dropRates.js` (chest weapon-tier rates). Implement as a Discord button (or select) → ephemeral reply so it doesn't clutter the channel. Show, per chest type, the weapon-tier percentage breakdown. Pull the numbers live from config so the embed never drifts from the real rates.

---

## 8. Spawn-countdown message auto-deletes at 0s

**File:** the mob/boss spawn-countdown announcer (Screenshot #1 — the "Next spawn" countdown).

When the countdown reaches **0 seconds**, **delete** the countdown message instead of leaving the expired "Next spawn" text in the channel. Handle the already-deleted / missing-message case gracefully (catch and ignore Unknown Message errors).

---

## Decisions to confirm with the human

1. **Duel `level N`** — normalizes the **class-level stat component** only; owned weapon/deity stats still apply. Confirm, or also normalize/strip gear.
2. **EXP endgame** — table as given roughly ~3.8× the old L50 total. Confirm, or flatten Tiers 3–4 to preserve the original ~12-month endgame.

## Acceptance checklist

- [ ] New class bases/scaling reflected in profile + both battle types; floor() + CRIT caps applied; no migration needed; existing players show updated totals.
- [ ] Two opposing CC passives no longer deadlock a round; CC only gates the recipient's next turn; first-attack-roll winner lands the first stun; only cleanse/heal run at start-of-turn.
- [ ] `crd duel @user level 50` / `level50` / `lvl 50` / `lvl50` parsed; clamp 1–50; both sides recomputed to N; nothing persisted.
- [ ] `passiveRegistry.js`: gungnir 10%, mjolnir +30%/3rd-turn crush, trident 2nd-turn/30% stun, thunderbolt 100%, zeus 100%, bathala ramp +15%→+105%, hydra 1%. All match the DB descriptions.
- [ ] Deity gacha rates 64.5/30/5/0.5 (sum 100).
- [ ] `expTable.js` replaced; strictly increasing; no 40→41 dip; cumulative milestones match the table above.
- [ ] Category "?" opens an ephemeral weapon-drop-rate-per-box embed sourced from config.
- [ ] Spawn countdown message is deleted at 0s, with safe error handling.
