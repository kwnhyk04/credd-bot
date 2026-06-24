# CREDD BOT — MASTER EXPORT FILE v4 (FINAL)
# Consolidated from all source files + all session revisions + Decision Log v1 resolutions
# Source files: Mechanics_Updated_06012026.txt · Credd_Master_Export_v2.md · Additional_Mechanics.md
# Database fully revised: see credd_schema_v4.sql (runnable DDL) and Technical Blueprint v4
# Jun-2026 mob rebalance (DB): all regular/elite/boss base stats raised and per-level scaling steepened — regular +80 HP/+65 ATK/+20 DEF, elite +90 HP/+75 ATK/+25 DEF, bosses authored per row (§15, §16). Stats live from `mob_roster`; no code constants to change.
# Jun-2026 balance & bugfix patch: per-class base stats + scaling — distinct class identities (§1/§11, no migration); combat turn-order fix — procced skip-CC is directional and gates only the recipient's NEXT turn, two opposing CC passives no longer deadlock (§2/§35.1); `crd duel @user [level N]` normalizes both duelists' class-stat component to level 1–50 (gear unchanged, nothing persisted) (§3/§14); passive retune — Gungnir 30%→10%, Mjolnir +20%/4th→+30%/3rd, Trident 3rd→2nd & stun 25%→30%, Thunderbolt 80%→100%, Zeus 80%→100%, Bathala reworked to +15%→+105% ramping self-buff, Hydra 5%→1% (§4); deity gacha rates 64.5/30/5/0.5 (§5); combat-EXP curve rescaled (anti auto-grind, strictly increasing, no 40→41 dip, ~127M to L50) (§6/§17); category "?" → ephemeral weapon-drop-rate-per-box embed (§7); boss spawn-countdown message deleted at 0s (§8)
# v4.5 balance patch (06/2026): raid chest drops adjusted (regular Silver 30%→20%, elite Gold 50%→30%); mob dynamic level now player + random(−2..+15); regular scaling set to HP+30/ATK+15/DEF+10 and elite scaling to HP+50/ATK+35/DEF+20 per level; all boss base HP +50,000 (§13, §15, §16, §35.6)
# v4.4 patch (06/2026): Greater Boss tier (Jotun/Fenrir/Fafnir/Hydra/Cerberus — 80/20 weighted spawn, 2× HP, richer drops: 150k credux / 30k EXP / 2× Treasure or 1× Golden chest); weapon-drop ranges raised (Rare/Mythic/Legendary up, Supreme DEF 400→500 — new drops only); profile card polish (combat-EXP line, Active Deity/Blessing split, stat icons, Combat Record heading); BUGFIX — "+X% ATK" bonus passives now DEF-mitigated (were flat post-mitigation, ~2×/~6× too strong); portrait-card layout for weapon/deity info + create-character (art left, text right); crd profile @user; crd dev spawnboss [name] (§7, §12, §16)
# v4.3 patch (06/2026): mob per-level scaling REDUCED — regular HP+40/ATK+15/DEF+10 → HP+20/ATK+8/DEF+5, elite HP+75/ATK+30/DEF+16 → HP+40/ATK+15/DEF+10 (base stats unchanged); `crd profile` full Canvas card; quest embed fonts reduced; class art in create-character preview (§13, §35.6)
# v4.2 patch (06/2026): class base HP 100→500; all regular/elite mob base HP +500; Overcharge reworked to every-3-turns (no crit, roll suppressed); player always first vs bosses (first_strike overrides); raid embed edits odd rounds, duel every round; bestow + quest CV2 embed layouts (§3, §11, §12, §13, §14, §15, §16, §20)
# v4.1 patch (06/2026): boss timer 1h→2h; boss art at /assets/monsters/boss; mob rebalance — regular/elite base ATK/DEF raised, per-level scaling raised, spawn 80/20, shard drops raised, silver chest 30% (§13, §15, §35.6)
# This is the single source of truth — upload at the start of every new thread
# NOTE: §35 (Passive Registry & Backend Constants) is AUTHORITATIVE where any older section conflicts

---

## 1. BOT IDENTITY

- **Bot Name:** Credd
- **Meaning:** Rooted in Latin "Credo" meaning "I Believe" — personal story of belief in God and self
- **Base Command:** `crd` (default prefix, server admins can customize e.g. `c`)
- **Platform:** Discord Bot (discord.js / Node.js)
- **Database:** PostgreSQL
- **CDN:** Discord CDN (starting out) → Cloudflare R2 (scale)
- **Image Generation:** node-canvas (pure Canvas rendering)
- **Main Game:** The Last Believer (mythology-themed RPG battle system)
- **Casino:** Separate casino games using Credux

---

## 2. DEVELOPER ACCOUNTS

| Account | Discord ID | Role |
|---|---|---|
| Personal (Main) | `980773258238492762` | Superuser · Player · Tester |
| Dev Front Account | `1508745825315196979` | Primary command tester · Superuser |

- Both IDs stored in `.env` as `DEV_IDS=980773258238492762,1508745825315196979`
- Both accounts have full `crd dev` superuser access
- All dev actions logged in `dev_logs` table

---

## 3. CURRENCY SYSTEM

| Currency | Type | Usage |
|---|---|---|
| Belief Shards | Free (earned by playing) | Gacha — 100 shards = 1 pull |
| Sacred Relics | Item/Ticket (boss drops) | Gacha — 1 relic = 10 rolls |
| Supreme Relics | Item/Ticket (rare) | Gacha — 1 relic = 1 Supreme deity pull |
| Credux | Earned currency | Weapon enhancement, economy, casino games |

### Credux Design
- Name origin: Credo (I Believe) + ux (light in Latin)
- Icon: Gold coin with dashed inner ring, diamond corner ornaments, centered flame
- PNG asset: credux_coin.png

### Credux Drop Rates
| Source | Amount |
|---|---|
| Common Mob win | 100–500 (dynamic) |
| Elite Mob win | 600–1,000 (dynamic) |
| Server Boss (all participants) | 100,000 (fixed) |
| World Boss (all participants) | 1,000,000 (fixed) |
| World Boss 1st Place | 15,000,000 |
| World Boss 2nd–5th Place | 10,000,000 |
| World Boss 6th–10th Place | 5,000,000 |

### Bestow System [REVISED]
- Command: `crd bestow @user [amount]`
- Daily cap: 1,000,000 Credux per day (receiver cap)
- `crd dev givecredux` — bypasses daily cap entirely
- Embed shows: **Sender, Receiver, Amount only** — no balance display, with confirm/cancel buttons (clickable by the sender only)
- Balance processing happens entirely on backend
- [v4.2] Embed (Components V2): header "Bestow" line → separator → myth-themed bestow message with amount + exact bestow timestamp → separator → RMT warning (bestowing Credux for real money or anything of monetary value is prohibited; RMT = ban) → Confirm / Cancel buttons (sender only)

---

## 4. GACHA SYSTEM (INVOCATIONS)

### Commands
- `crd summon` — 1 pull (100 Belief Shards)
- `crd summon 5` — 5 pulls (500 Belief Shards)
- `crd summon 10` — 10 pulls (1,000 Belief Shards)
- Maximum: 10 pulls per command
- Belief Shards deducted BEFORE animation plays

### Animation Flow
1. Bot sends initial embed
2. Single card appears at center — flips dynamically cycling colors UP TO highest tier pulled
3. Colors cycle: Remnant Blue → Awakened Purple → Undying Gold → Primordial Red (only up to highest tier in result)
4. Card flip disappears → all results revealed simultaneously
5. Embed border + title color updates to match highest tier pulled
6. Summary shown below results (e.g. Remnant ×3, Awakened ×1, Undying ×1)
7. Footer shows: Belief Shards remaining + Sacred Relics count

### Results Layout
- 1 pull: Single large card centered
- 5 pulls: 1 row of 5 cards
- 10 pulls: 2 rows of 5 cards each

### Deity Drop Rates [REVISED]
| Tier | Display Name | Rate |
|---|---|---|
| Epic | Remnant | 64.5% |
| Mythic | Awakened | 30% |
| Legendary | Undying | 5% |
| Supreme | Primordial | 0.5% |

<!-- [Jun-2026 §5] was 69 / 25 / 5 / 1; weight shifted Epic→Mythic, Supreme halved. Sum = 100.0%. Pity unchanged (forced Legendary at 500; reset on any Legendary/Supreme). -->

### Deity Gacha Pity
- 500 rolls → Guaranteed Legendary (Undying) deity
- Supreme (Primordial) → No pity of its own, raw luck only (1%)
- **Pity resets to 0 on ANY Legendary OR Supreme pull** — natural or pity-forced
- Pity tracked per player in DB, checked per individual roll (not per batch)
- Pity is **backend-only — NEVER shown to players**
- Example: 497 pity + 5 rolls → Legendary triggers on roll 3, resets to 0, rolls 4–5 continue fresh

### Two-Step Roll System
- Step 1: Tier roll (e.g. 5% proc = Legendary tier confirmed)
- Step 2: Specific deity roll within that tier pool (get all legendary tier in deities table in Database then roll based on their id to avoid overcomplicate)
- Example: 6 Legendary deities in pool = 1/6 chance (~16.7%) per specific deity

---

## 5. CHEST SYSTEM

### Weapon Tiers
Common → Rare → Mythic → Legendary → Supreme
- Epic does NOT exist in weapons (Epic is deity-only terminology)
- Common starter weapon = **Initiate's Blade** (Sword, Common, ATK 15 / HP 30 / DEF 12 / CRIT 1%, passive_key `none`). It is a real weapon_roster row: on character creation a user_weapons row is generated and equipped. NOT dropped from chests. (See §35.)

### Chest Drop Rates [REVISED]
| Chest | Rare | Mythic | Legendary | Supreme | Open Command |
|---|---|---|---|---|---|
| Silver Chest | 85% | 15% | — | — | `crd open sc [amount]` |
| Gold Chest | 65% | 30% | 5% | — | `crd open gc [amount]` |
| Boss Treasure Chest | 50% | 40% | 10% | — | `crd open btc [amount]` |
| Boss Golden Chest | — | 45% | 45% | 10% | `crd open bgtc [amount]` |
| Supreme Chest | — | — | 70% | 30% | `crd open supc [amount]` |

- Maximum 10 chests per open command
- Cannot open more than owned
- Chest count deducted BEFORE animation plays
- Boss Golden Chest is a future **World Boss** reward (World Boss is shelved at launch); the Server Boss no longer grants it (top-damage reward removed — rewards are participation-only)

### Chest Opening Animation Flow
1. Chest shown idle/centered
2. Chest shakes
3. Chest cracks open — light bleeds out (color matches highest tier in result)
4. Chest bursts/disappears → all weapons revealed simultaneously
5. Embed border updates to highest tier color
6. Footer shows ALL chest counts after deduction (text only):
   > Silver Chest: 5 · Gold Chest: 3 · Boss Treasure: 10 · Boss Golden: 1 · Supreme: 0

---

## 6. RELIC SYSTEM

### Commands
- `crd open sr` — opens 1 Sacred Relic → triggers 10-roll deity gacha
- `crd open supr` — opens 1 Supreme Relic → triggers 1 Supreme deity pull
- No amount parameter — fixed per command

### Sacred Relic Opening Animation
1. Sacred Relic shown centered → glows/pulses (arcane purple)
2. Relic dissolves into light
3. Deity gacha card flip plays (same as deity summon)
4. 10 deity results revealed — 2 rows of 5

### Supreme Relic Opening Animation
1. Supreme Relic shown floating
2. Relic cracks open → portal tears open (circular, rainbow shimmer)
3. Deity symbol appears from portal → fades
4. Single Supreme deity card revealed, embed border turns Supreme Red

---

## 7. WEAPON SYSTEM

### Weapon Types & Stat Distribution
| Type | ATK | HP | DEF | CRIT |
|---|---|---|---|---|
| Swords | Balanced | Balanced | Balanced | Low |
| Staffs | Highest | Low | Lowest | Low |
| Gloves | High | High | Low | Low |
| Shields | Low | High | Highest | Low |
| Bows | High | Low | Low | High |

NOTE: Weapons are NOT class-locked. Any class can equip any weapon.

### Dynamic Weapon Stats (Min/Max per Tier)
<!-- [v4.4] ranges raised (new drops only; existing user_weapons rows unchanged). Prev: Rare 25–50/50–100/20–40, Mythic 100–150/150–200/60–80, Legendary 300–400/400–600/150–200, Supreme DEF 400 -->
| Tier | ATK | HP | DEF | CRIT | Bonus |
|---|---|---|---|---|---|
| Rare | 100–150 | 100–200 | 50–75 | 1–5% | — |
| Mythic | 200–350 | 300–400 | 80–150 | 1–5% | — |
| Legendary | 500–600 | 600–800 | 200–300 | 3–7% [v5] | 25% chance on drop: +25% damage (fixed); otherwise none |
| Supreme | Fixed 800 | Fixed 1200 | Fixed 500 | Fixed 10% [v5] | +50% damage (always) |

### Weapon Enhancement System
- Command: `crd enhance [weapon ID]`
- Continuous forge session — buttons remain after each attempt
- Cancel button closes the session
- On fail: weapon stays at current level, Credux still consumed
- Stat boost applies to weapon's rolled base stats only

#### Success Rates (Same across all tiers)
| Level | Success Rate |
|---|---|
| +1 | 100% |
| +2 | 95% |
| +3 | 85% |
| +4 | 75% |
| +5 | 65% |
| +6 | 55% |
| +7 | 40% |
| +8 | 30% |
| +9 | 20% |
| +10 | 10% |

#### Credux Cost per Tier
| Level | Rare | Mythic | Legendary | Supreme |
|---|---|---|---|---|
| +1 | 1,000 | 5,000 | 15,000 | 50,000 |
| +2 | 3,000 | 12,000 | 35,000 | 100,000 |
| +3 | 6,000 | 25,000 | 70,000 | 200,000 |
| +4 | 12,000 | 50,000 | 130,000 | 400,000 |
| +5 | 20,000 | 90,000 | 220,000 | 650,000 |
| +6 | 35,000 | 150,000 | 380,000 | 1,000,000 |
| +7 | 55,000 | 250,000 | 600,000 | 1,500,000 |
| +8 | 90,000 | 400,000 | 900,000 | 3,000,000 |
| +9 | 100,000 | 650,000 | 1,500,000 | 3,000,000 |
| +10 | 100,000 | 1,000,000 | 2,000,000 | 3,000,000 |

#### Stat Boost per Enhancement Level
| Level | Stat Boost |
|---|---|
| +1 | +5% all stats |
| +2 | +10% all stats |
| +3 | +15% all stats |
| +4 | +20% all stats |
| +5 | +25% all stats |
| +6 | +32% all stats |
| +7 | +40% all stats |
| +8 | +50% all stats |
| +9 | +70% all stats |
| +10 | +100% all stats |

### Weapon ID System
- All weapon IDs randomly generated (8 characters, globally unique)
- Generated as an 8-char id (e.g. `crypto.randomBytes` → hex/base36 slice) with a DB uniqueness check (column is VARCHAR(8))
- IDs are clickable in bag embed — tapping copies to clipboard

### Weapon Info Command
- `crd weapon info [weapon ID]` — player must own the weapon
- If not owned → plain text: *"You don't own a weapon with that ID."*
- Rendered as Canvas PNG
- Card shows: weapon name + tier (with tier color), type + icon, current stats with all enhancements applied, enhancement level, passive ability, lore line, weapon artwork image (if available)
- Footnote: *"Want to enhance this weapon? Use `crd enhance [weapon ID]`"*

---

## 8. WEAPON ROSTER

> **Timing & durations follow §35.1:** all periodic procs are round-based ("every Nth turn"); stacking buffs are "+X% every turn, up to Y%"; CC + stat debuffs last **1 turn**; Bleed/Burn DOTs tick **2 turns**; "first hit" effects use a first-action flag.

### Status Effect Naming Convention
- **Flat Damage (ATK based) — works on bosses unless individually blocked:**
  - Bleed — Flat DOT per turn (ATK based)
  - Burn — Flat DOT per turn (ATK based)
- **HP% Damage — blocked by ALL bosses universally:**
  - Hemorrhage — HP% bleed DOT variant
  - Ignite — HP% burn DOT variant
  - Rupture — Chance-based HP% burst damage (proc)

### Rare Tier Weapons

**Swords**
| Weapon | Passive |
|---|---|
| Iron Sword | None |
| Steel Longsword | None |
| Cutlass | 10% chance to apply flat Bleed on hit |
| Kampilan | First hit deals +20% ATK |

**Gloves**
| Weapon | Passive |
|---|---|
| Iron Knuckles | None |
| Steel Gauntlets | None |
| War Club | 10% chance to Stun enemy for 1 turn |
| Bone Crusher | First hit deals +20% ATK |

**Staffs**
| Weapon | Passive |
|---|---|
| Wooden Staff | None |
| Apprentice Staff | None |
| Crystal Wand | 10% chance to deal +15% ATK bonus hit |
| Carved Totem | First hit deals +20% ATK |

**Shields**
| Weapon | Passive |
|---|---|
| Wooden Shield | None |
| Iron Buckler | None |
| Steel Kite Shield | 10% chance to block 15% of incoming damage |
| Reinforced Targe | First hit deals +20% ATK |

**Bows**
| Weapon | Passive |
|---|---|
| Wooden Bow | None |
| Hunting Bow | None |
| Recurve Bow | 10% chance to deal +20% ATK bonus hit |
| Crossbow | First hit deals +20% ATK ignoring 25% DEF |

### Mythic Tier Weapons (PH & Norse)

**Swords**
| Weapon | Passive |
|---|---|
| Katana | +30% damage [v4.4 unified] — ×1.30 on a normal hit, ×2.30 on a crit |
| Gladius | 30% chance to deal +50% bonus ATK |
| Scimitar | Each consecutive hit +3% ATK, stacking up to 15% |

**Gloves**
| Weapon | Passive |
|---|---|
| Roman Cestus | Deals 50% more damage to stunned enemies |
| Pata | Flat Bleed on hit: 30% ATK per turn for 2 turns |
| Bagh Nakh | ATK +5% each turn, stacking up to 25% |

**Staffs**
| Weapon | Passive |
|---|---|
| Japanese Bo | 25% chance to heal 50% of damage dealt |
| English Quarterstaff | 20% chance to deal +50% bonus ATK |
| Egyptian Asa (Tahtib) | Each turn gains 3% DEF ignore, stacking to 15% |
| Pilgrim's Bordone | 50% chance to reduce enemy DEF by 15% for 1 turn |

**Shields**
| Weapon | Passive |
|---|---|
| Vatican Aspis | All damage received -10%; ATK +10% |
| Battersea Shield | DEF +25% for first 2 turns |
| Enderby Shield | 10% chance to reflect 30% incoming damage to attacker |

**Bows**
| Weapon | Passive |
|---|---|
| Holmegaard Bow | Each hit +3% ATK, stacking up to 15% |
| Scandinavian Glacial Wooden Bow | 10% chance to take another turn |
| Scythian Composite Bow | 20% chance to deal +50% ATK bonus damage |

### Mythic Tier Weapons (Greek)

**Swords**
| Weapon | Passive |
|---|---|
| Xiphos | Each hit +4% ATK, stacking up to 20% |
| Kopis | 25% chance to deal +60% bonus ATK |

**Gloves**
| Weapon | Passive |
|---|---|
| Caestus | 35% chance to deal +40% bonus ATK |
| Myrmex | Deals 40% more damage to stunned enemies |

**Staffs**
| Weapon | Passive |
|---|---|
| Dory | ATK +6% every 2 turns, stacking up to 18% |
| Thyrsus (Mythic) | 20% chance each turn to apply flat Bleed (ATK×0.30 for 2 turns) |

**Shields**
| Weapon | Passive |
|---|---|
| Dipylon Shield | DEF +20% for first 3 turns |
| Pelte | 15% chance to block 25% of incoming damage |

**Bows**
| Weapon | Passive |
|---|---|
| Arrow of Eros | 30% chance to deal +45% ATK bonus damage |
| Cretan Bow | Each hit +4% ATK, stacking up to 20% |

### Legendary Tier Weapons (PH & Norse)

**Swords**
| Weapon | Passive |
|---|---|
| Juru Pakal (PH) | Deals 30% more damage to bleeding enemies |
| Gram (Norse) | Ignores 20% of enemy DEF |
| Tyrfing (Norse) | Each hit +10% ATK, stacking up to 30% |
| Laevateinn Sword (Norse) | Each attack reduces enemy DEF by 10%, stacking up to 30% |

**Gloves**
| Weapon | Passive |
|---|---|
| Jarngreipr (Norse) | Stunning enemies triggers Bash: +60% bonus damage |
| Gridr Iron Gloves (Norse) | 20% chance to ignore incoming damage |
| Alan's Reversed Hands (PH) | Immune to all status effects |
| Knuckle Charm Anting-Anting (PH) | 5% chance to instantly kill opponent (except Bosses) |

**Staffs**
| Weapon | Passive |
|---|---|
| Laevateinn Staff (Norse) | Attacks ignore 15% of enemy DEF |
| Galdrastafir (Norse) | 50% chance to reduce enemy DEF by 30% for 1 turn |
| Babaylan's Ritual Staff (PH) | Auto-cleanses all debuffs every turn; ATK +100% for 1 turn after cleansing |
| Badiang Stalk (PH) | 30% chance Rupture: 10% enemy max HP. Blocked by all bosses. |

**Shields**
| Weapon | Passive |
|---|---|
| Shield of the Valkyrie (Norse) | Every hit received: DEF +5% and ATK +5%, stacking up to 30% each |
| Skjaldmaer (Norse) | 15% chance to ignore incoming damage |
| Luzon Tribal Shield (PH) | While debuffed, gains 40% DEF boost until debuff expires |

**Bows**
| Weapon | Passive |
|---|---|
| Gusisnautar (Norse) | 50% chance Hemorrhage: 10% enemy max HP for 1 turn + DEF -15% during Hemorrhage. Blocked by bosses. |
| Freyr's Arrow (Norse) | 50% chance to auto-fire dealing 100% ATK damage |

### Legendary Tier Weapons (Greek)

**Swords**
| Weapon | Passive |
|---|---|
| Harpe | Gorgon Slayer — Ignores 30% DEF |
| Sword of Damocles | Impending Doom — ATK +5% every turn, stacking up to +100%; player takes 5% more damage |
| Labrys | Double Strike — Every 3rd turn the attack hits twice; 2nd hit deals 70% ATK; both can CRIT |

**Gloves**
| Weapon | Passive |
|---|---|
| Hephaestus Hammer | Forged Armor — DEF +20% for battle; every 4th turn deals 150% ATK forge strike |

**Staffs**
| Weapon | Passive |
|---|---|
| Caduceus | Herald's Touch — Every 3rd turn: cleanses all player debuffs + restores 8% max HP |
| Spear of Ares | Bloodlust — ATK +8% every 2 turns, stacking up to 40% |

**Shields**
| Weapon | Passive |
|---|---|
| Helm of Darkness | Invisibility — 25% chance each turn: enemy misses next attack completely |
| Aegis | Medusa's Gaze — 20% chance on hit: Stone Stack. At 3 stacks: stun 1 turn. Resets after. |

**Bows**
| Weapon | Passive |
|---|---|
| Apollo's Silver Bow | Unerring Arrow — Ignores 25% DEF; every 4th turn the attack is a guaranteed CRIT |

### Supreme Tier Weapons

| Weapon | Mythology | Passive |
|---|---|---|
| Mjolnir | Norse | Crushing Force — Every turn +30% ATK bonus; every 3rd turn: 200% ATK crush  [Jun-2026 §4: was +20% / every 4th] |
| Gungnir | Norse | Never Misses — Ignores 40% of enemy DEF; 25% chance to pierce ALL DEF (zero mitigation)  [v5] |
| Thunderbolt of Zeus | Greek | Divine Thunder — on a CRIT: +100% bonus ATK and paralyze 1 turn  [v5] |
| Trident of Poseidon | Greek | Tidal Wrath — Every 2nd turn: 100% ATK bonus; 30% chance stun 1 turn; enemy DEF -20% for 1 turn  [Jun-2026 §4: was every 3rd / 25% stun] |

---

## 9. DEITY SYSTEM

### Deity Tiers
| Internal Tier | Display Name (Alias — Deities Only) | Color Hex |
|---|---|---|
| Epic | Remnant | #5865F2 (Blue) |
| Mythic | Awakened | #9b59b6 (Purple) |
| Legendary | Undying | #FFD700 (Gold) |
| Supreme | Primordial | #e74c3c (Red) |

### Deity Tier Stat Ranges
| Tier | HP | ATK | DEF |
|---|---|---|---|
| Epic (Remnant) | 320–420 | 80–115 | 50–75 |
| Mythical (Awakened) | 645–750 | 175–220 | 112–148 |
| Legendary (Undying) | 1,000–1,090 | 370–430 | 215–268 |
| Supreme (Primordial) | 1,500–1,640 | 595–650 | 355–420 |

NOTE: No CRIT stats from deities. War/battle deities receive higher ATK. All Blessings are battle-duration only — reset after battle ends.

### Deity Collection Command (`crd deity collection`) [REVISED]
- Paginated by mythology — one page per mythology (PH, Norse, Greek, Japanese, etc.)
- New mythology = new page automatically
- Each deity card shows: icon, name, tier alias (owned = full color, unowned = locked). Tier essence balances shown on the page footer.
- Buttons: ◀ Previous / Next ▶ — loops infinitely
- **No footer**
- Element system REMOVED entirely

### Deity Info Command (`crd deity info [deity name]`) [REVISED]
- Player must own the deity
- If not owned → plain text: *"You haven't summoned [deity name] yet."*
- Rendered as Canvas PNG
- Card shows:
  - Deity name + tier display name (with tier color)
  - Mythology origin
  - Current stats (base + all enhancement bonuses)
  - Blessing name + what the blessing does in battle
  - Current enhancement level
  - Tier essence available (e.g. "Legendary Essence: 9") — duplicates convert to tier essence
  - Lore line (educational description of deity's historical/mythological background)
  - Deity artwork image (if PNG asset available)
- Footnote: *"Want to enhance this deity? Use `crd deity enhance [deity name]`"*

### Deity Enhancement Command (`crd deity enhance [deity name]`)
- Player must own the deity
- Consumes **tier essence** as material (Epic/Mythic/Legendary/Supreme essence; cost table in §35)
- Full table below

### Deity Enhancement System

**Rules:**
- Enhancement range: +1 to +10
- Percentage applied to deity's own base stats
- **Uniform: all three stats (HP, ATK, DEF) gain the SAME +10% per level** — no dominant/non-dominant distinction
- All enhancement bonuses are battle-duration only — reset after battle

**Stat Boost % Per Level:**
| Tier | +1 | +10 Total |
|---|---|---|---|---|
| Epic | +10% | +100% |
| Mythical | +10% | +100% |
| Legendary | +10% | +100% |
| Supreme | +10% | +100% |

**Essence Cost Per Enhancement** (spend essence of the deity's own tier):
| Level | Epic | Mythical | Legendary | Supreme |
|---|---|---|---|---|
| +1 | 2 | 2 | 2 | 2 |
| +2 | 3 | 3 | 2 | 2 |
| +3 | 4 | 3 | 3 | 2 |
| +4 | 5 | 4 | 3 | 2 |
| +5 | 7 | 5 | 4 | 3 |
| +6 | 9 | 6 | 4 | 3 |
| +7 | 12 | 8 | 5 | 3 |
| +8 | 15 | 10 | 6 | 4 |
| +9 | 20 | 13 | 7 | 4 |
| +10 | 25 | 16 | 8 | 5 |
| **Total** | **102** | **70** | **44** | **30** |

---

## 10. DEITY ROSTER

> **Timing & durations follow §35.1:** periodic procs are round-based; stacking buffs are per-turn; CC + stat debuffs last **1 turn**; Burn DOTs tick **2 turns**; "first attack" effects use a first-action flag. Self-buff windows ("for the first N turns") apply as authored.

### PH Myths — Supreme
| Name | HP | ATK | DEF | Identity | Blessing |
|---|---|---|---|---|---|
| Bathala | 1,640 | 650 | 355 | Creator — dominant HP & ATK | Divine Vessel — At the start of each turn (before attacking) +20% ATK/DEF (no HP), stacking additively up to +100% (5 stacks; cap on turn 5, held after). Self-buff, never cleansed.  [Supporter-stage §9: HP removed; step +15%→+20%, cap +105%/7-stack → +100%/5-stack] |

### PH Myths — Legendary
| Name | HP | ATK | DEF | Identity | Blessing |
|---|---|---|---|---|---|
| Sidapa | 1,055 | 388 | 248 | Death — balanced, survival skew | Death's Reprieve — Once per battle survive lethal damage at 1 HP for 1 turn |
| Magwayen | 1,085 | 370 | 268 | Soul Ferryman — highest DEF | Soul Drain — Each attack steals 10% of damage dealt as HP |
| Mandarangan | 1,000 | 430 | 220 | War — max ATK, lowest HP & DEF | War Frenzy — ATK +10% every turn, capped at 30% (max Turn 3) |

### PH Myths — Mythical
| Name | HP | ATK | DEF | Identity | Blessing |
|---|---|---|---|---|---|
| Apolaki | 658 | 216 | 118 | Sun — high ATK, low DEF | Solar Burn — Every 3rd turn ignites enemy: 15% ATK flat Burn for 2 turns |
| Mayari | 742 | 178 | 144 | Moon — highest HP, high DEF | Lunar Veil — When HP < 50%, DEF +30% |
| Dian Masalanta | 718 | 188 | 125 | Love — HP skew, moderate | Devotion — When HP < 30%, ATK +25% |

### PH Myths — Epic
| Name | HP | ATK | DEF | Identity | Blessing |
|---|---|---|---|---|---|
| Amihan | 385 | 88 | 63 | Wind — light, evasion | Tailwind — 20% chance to evade any incoming attack |
| Habagat | 335 | 110 | 55 | Storm — high ATK, low DEF | Monsoon Fury — Every turn, 25% chance: storm strike dealing +50% ATK bonus damage |
| Lakapati | 412 | 82 | 63 | Fertility — high HP | Abundance — Regenerate 3% max HP at start of each turn |
| Idiyanale | 378 | 92 | 68 | Diligence — balanced, slight DEF lean | Persistence — Every 5 turns, next attack deals double damage |

### Norse Myths — Supreme
| Name | HP | ATK | DEF | Identity | Blessing |
|---|---|---|---|---|---|
| Odin | 1,500 | 595 | 420 | Wisdom/War — highest DEF | All-Father's Wisdom — Every even turn (2/4/6…), character takes 50% reduced damage |

### Norse Myths — Legendary
| Name | HP | ATK | DEF | Identity | Blessing |
|---|---|---|---|---|---|
| Thor | 1,020 | 415 | 232 | Thunder — high ATK, moderate DEF | Mjolnir's Wrath — Every 3rd turn: 50% ATK bonus + stun enemy 1 turn |
| Freya | 1,090 | 375 | 255 | Fertility/War — balanced, high DEF | Valkyrie's Embrace — Once per battle at ≤40% HP: restore 20% max HP and gain ATK +15% for 2 rounds |
| Loki | 1,000 | 430 | 215 | Trickster — high ATK | Illusory Double — 20% chance each round to evade an attack and counter for 50% ATK |
| Tyr | 1,040 | 395 | 260 | Justice — DEF-leaning | Oathkeeper — DEF +20% for the battle; while HP < 50%, reflect 15% of incoming damage |
| Skadi | 1,020 | 410 | 240 | Hunt/Winter — balanced ATK | Winter's Hunt — Every 3rd turn: +40% ATK and apply Freeze (enemy skips next turn) |
| Surt | 1,000 | 430 | 215 | Fire — max ATK, Burn-based | Muspell's Flame — Every attack applies flat Burn (25% ATK for 2 rounds); Burn deals +50% vs already-burning enemies |

### Norse Myths — Mythical
| Name | HP | ATK | DEF | Identity | Blessing |
|---|---|---|---|---|---|
| Heimdall | 668 | 182 | 148 | Guardian — highest DEF in tier | Eternal Vigilance — First hit taken each battle negated by 50% |
| Baldur | 750 | 175 | 132 | Light — highest HP, lowest ATK | Invulnerability — Once per battle: remove all debuffs + restore 10% max HP |
| Hel | 732 | 185 | 138 | Half-dead — HP and DEF skew | Half-Dead — When HP < 50%: DEF +15% and ATK +15% |
| Mimir | 690 | 195 | 122 | Wisdom — balanced | Runic Knowledge — Every 4 turns, next ATK deals 65% more damage |

### Norse Myths — Epic
| Name | HP | ATK | DEF | Identity | Blessing |
|---|---|---|---|---|---|
| Freyr | 405 | 84 | 65 | Harvest — high HP, lower ATK | Harvest Bounty — Restore 5% max HP every 2 turns |
| Njord | 372 | 82 | 75 | Sea — highest DEF in tier | Sea's Favor — 15% chance each turn to reduce incoming damage by 30% |
| Bragi | 368 | 95 | 62 | Battle Hymn — balanced, moderate ATK | Battle Hymn — Every 3 turns: ATK +8% for 2 turns |
| Idunn | 420 | 80 | 61 | Rejuvenation — highest HP, lowest ATK | Golden Apple — Once per battle at ≤50% HP: restore 15% max HP |
| Vidar | 355 | 100 | 60 | Vengeance — moderate ATK | Silent Vengeance — When hit by a crit, next attack auto-crits back |
| Magni | 328 | 112 | 53 | Strength — high ATK, low HP | Might of Magni — ATK +5% for every 10% HP lost, capped at 25% |

### Greek Myths — Supreme
| Name | HP | ATK | DEF | Identity | Blessing |
|---|---|---|---|---|---|
| Zeus | 1,620 | 640 | 380 | King — strong all-stats, ATK lean | Thunder Sovereign — Every 3rd turn: 100% ATK bonus + enemy DEF -20% for 1 turn  [Jun-2026 §4: was 80%] |

### Greek Myths — Legendary
| Name | HP | ATK | DEF | Identity | Blessing |
|---|---|---|---|---|---|
| Ares | 1,005 | 428 | 218 | War — max ATK, lowest DEF | Blood Frenzy — ATK +8% every 2 turns, stacking up to 40% (max Turn 10) |
| Poseidon | 1,075 | 385 | 245 | Sea — high HP, moderate ATK | Tidal Force — Every 4 turns: 60% ATK bonus + 40% chance stun 1 turn |
| Hades | 1,060 | 372 | 265 | Underworld — high DEF | Soul Harvest — When enemy HP < 30%: ATK +35% for remainder of battle |
| Hera | 1,080 | 378 | 252 | Queen — balanced, HP lean | Divine Wrath — When hit by CRIT: DEF +10% and ATK +10%, stacking up to 3× |

### Greek Myths — Mythical
| Name | HP | ATK | DEF | Blessing |
|---|---|---|---|---|
| Athena | 692 | 198 | 140 | Aegis Shield — First 2 hits received each battle reduced by 40% |
| Apollo | 655 | 218 | 115 | Solar Radiance -- ATK increased by 20% for the duration of battle. |
| Artemis | 648 | 215 | 112 | Huntress Precision -- First attack each battle always lands as a CRIT. Every 4 turns next attack automatically crits. |
| Hephaestus | 685 | 195 | 145 | Forged Armor -- DEF increased by 20% for theduration of battle. When HP drops below 50%, ATK increases by 15%. |
| Aphrodite | 728 | 180 | 128 | Enchanting Aura -- 20% chance each turn to charm enemy, causing them to skip their attack. |

### Greek Myths — Epic
| Name | HP | ATK | DEF | Identity | Blessing |
|---|---|---|---|---|---|
| Persephone | 415 | 84 | 68 | Spring/Underworld — HP and DEF skew | Cycle of Renewal — When HP < 50%: restore 20% max HP once per battle |
| Dionysus | 418 | 88 | 62 | Chaos/Revelry — high HP | Drunken Haze — 30% chance each turn enemy attacks themselves (30% own ATK as damage) |
| Nike | 345 | 113 | 55 | Victory — high ATK, low HP | Wings of Victory — ATK +25% for duration of battle |

---

## 11. CLASSES

### Base Stats (Per Class — Level 1)  [Jun-2026 §1: each class now has a DISTINCT base; the old uniform HP 500 / ATK 10 / DEF 10 / CRIT 5% is retired]
| Class | HP | ATK | DEF | CRIT |
|---|---|---|---|---|
| Swordsman | 700 | 225 | 225 | 5% |
| Fighter | 850 | 300 | 150 | 1% |
| Mage | 600 | 350 | 100 | 1% |
| Knight | 1000 | 200 | 300 | 5% |
| Archer | 600 | 300 | 150 | 5% |
- MP removed temporarily (returns with skill system)
- Speed removed permanently
- No `user_character` stat columns exist — ATK/HP/DEF/CRIT are computed at runtime from class + level, so this table auto-applies to every existing player (no migration).

### Level-Up Scaling Per Level  [Jun-2026 §1]
| Stat | Swordsman | Fighter | Mage | Knight | Archer |
|---|---|---|---|---|---|
| HP + | +105 | +120 | +90 | +150 | +105 |
| ATK + | +55 | +70 | +100 | +30 | +85 |
| DEF + | +55 | +25 | +25 | +50 | +25 |
| CRIT + | +0.7% | +0.5% | +0.5% | +0% | +0.7% |

**ATK Hierarchy at Level 50:** Mage > Archer > Fighter > Swordsman > Knight
**CRIT Cap:** class crit caps at 40% (Swordsman & Archer reach **39.3%** at Lv50 — the 40% cap is a safety clamp, not normally hit); total class+weapon crit hard ceiling = **45%** (§35.2). Knight has 0% CRIT growth (flat 5%, compensated by passive).

### Class Passives
| Class | Passive | Mechanic |
|---|---|---|
| Swordsman | Bleed | ATK × random(0.30–0.50) flat damage per turn for 2 turns. Refreshes on every new attack. Negated vs. Fenrir. |
| Fighter | Stun | 25% chance stun 1 turn; 10% chance stun 2 turns. Negated vs. stun-immune bosses. |
| Mage | Overcharge | Every 3 turns (rounds 3, 6, 9…): that attack adds a flat +200% ATK bonus, and the ENTIRE overcharge attack cannot crit (crit roll suppressed). [v4.2: was charge-based 50%/turn] |
| Knight | Damage Reduction | All incoming damage reduced by 20% after DEF mitigation. |
| Archer | Pierce | Every attack ignores 25% of enemy DEF (enemy DEF × 0.75). Negated vs. Armor Piercing-immune bosses. |

### Class Flavor Text [UPDATED — all classes finalized]

**Swordsman:**
> *A warrior forged for the battlefield. Neither the strongest nor the fastest, but the most reliable. The Swordsman walks the line between offense and defense, adapting to any fight. Every strike leaves a mark, and every mark bleeds.*
> Passive: Bleed — Every attack opens a wound. Enemies will suffer beyond the moment of impact.

**Fighter:**
> *A warrior who does not wait for the fight to come — they bring it. The Fighter is built on aggression, raw power, and the unshakable belief that the best defense is a fist to the jaw. When a Fighter lands, the enemy feels it. And sometimes, they don't get back up.*
> Passive: Stun — A devastating blow can stop an enemy cold. Not every hit lands the same way.

**Mage:**
> *The Mage does not swing a sword. They do not need to. While others close the distance, the Mage is already three moves ahead, building energy that no armor can absorb. When the charge is ready, there is no blocking what comes next.*
> Passive: Overcharge — Power builds with every turn. When it peaks, the next strike carries everything.

**Knight:**
> *The Knight does not fall easily. Where others break under pressure, the Knight absorbs it, holds the line, and keeps fighting. Every blow the enemy lands is one they will regret. Endurance is not passive — it is a weapon.*
> Passive: Damage Reduction — Every hit taken is softened. The Knight was built to outlast anything in front of them.

**Archer:**
> *Swift, precise, and deadly from a distance. The Archer does not wait for the enemy to come — they are already gone before the enemy arrives. Every arrow finds its mark, and no armor is thick enough to stop what cannot be seen coming.*
> Passive: Armor Pierce — Your arrows do not care for steel or stone. Every shot cuts through the defenses of your enemy, finding the gaps that others cannot.

---

## 12. BATTLE SYSTEM

### Turn Order
- First attack determined by **50/50 random roll** (first attack roll) — raid and duel only. [v4.2] **Boss fights: the player ALWAYS attacks first** (no roll), unless the boss has the `first_strike` passive (Sleipnir), which still overrides.
- Neither side has guaranteed advantage
- Turns alternate after the first roll
- Exception: Sleipnir always attacks first regardless of roll
- Applies to BOTH `crd raid` and `crd duel`

### Damage Formula
```
Final DMG = ATK × (1 − DEF/(DEF+200)) × random(0.90, 1.10)
Crit DMG  = Final DMG × 2.0
Crit Cap  = 40% class / 45% total (§35.2)
```
> **[v4.4] ATK-scaling bonus passives are DEF-mitigated.** Bonus riders (weapon, blessing,
> or mob skill) scale the attacker's ATK *before* mitigation instead of adding a flat
> ATK-fraction after DEF (the old bug let a +45% rider roughly double a hit and a "200%"
> mob nuke land ~6×). Two label conventions:
> - **Player "+X% bonus ATK"** (e.g. Arrow of Eros +45%, Mjolnir crush) = *additional* X%
>   on top → ×(1+X) of the hit. +45% ≈ ×1.45.
> - **Mob "X% ATK" nuke** (e.g. Valkyrie Battle Judgment 200%, Harpy 150%) = *total*
>   multiplier, like a crit → ×X of a normal hit. "200% ATK" = ×2.0, NOT +200%.
>
> Both are then reduced by the defender's DEF.
>
> **[v4.4] Unified damage-% rule (§35.2 / `config/combat.js`).** One `damage %` stat (no
> separate crit-damage stat) stacks additively and applies to crit AND non-crit:
> `hit = base × ((critLevel ? 2.0 : 1) + Σ damage%/100)`. Supreme 50% → ×1.5 / ×2.5; Supreme
> 50% + deity 50% (proc) → ×2.0 / ×3.0. Double (Idiyanale) is a guaranteed crit-level hit
> that takes the rider (Supreme + double → ×2.5); Overcharge is a fixed ×2.5 no-crit lane.

### Class Passives In Combat
- Knight: Final DMG = Final DMG × 0.80 (applied after DEF mitigation)
- Archer: Enemy effective DEF = Enemy DEF × 0.75 (negated vs. Armor Piercing-immune bosses)
- Bleed: ATK × random(0.30, 0.50) per turn for 2 turns. Refreshes on every attack. Negated vs. Fenrir.
- Overcharge: +50% per turn. At 100% adds 200% ATK bonus. Resets to 0% after firing.
- Stun: 25% chance 1 turn, 10% chance 2 turns. Negated vs. stun-immune bosses.

### Status Effects
| Effect | Type | Source | Boss Immunity |
|---|---|---|---|
| Bleed | Flat DOT | Swordsman, weapons | Only if boss passive covers it |
| Burn | Flat DOT | Apolaki, Surt, weapons | Only if boss passive covers it |
| Stun | CC | Fighter, weapons | Only if boss passive covers it |
| Paralyze | CC | Weapons | Only if boss passive covers it |
| Freeze | CC | Weapons | Only if boss passive covers it |
| Hemorrhage | HP% DOT | Weapons | ALL bosses immune |
| Ignite | HP% DOT | Weapons | ALL bosses immune |
| Rupture | HP% Burst | Weapons | ALL bosses immune |

### Elements
Fully removed for initial release. Planned as an end-game update.

---

## 13. RAID SYSTEM (`crd raid`)

### Commands
- `crd raid` / `crd r` — starts battle vs. mob or elite mob
- No separate `crd dungeon` — dungeon IS raid
- `crd raid` cooldown: **25 seconds** (anti-spam) <!-- [v4.8] was 10s -->; most other commands 10s, all casino 25s (see Cooldowns)

### Spawn Rates
- 80% → Common Mob spawns
- 20% → Elite Mob spawns
- Within each category: all mobs of that type have equal spawn chance

### Mob Dynamic Level System
- Mob Level = Player Level + random(−2 to +15)
- Regular Mob scaling: HP +30 / ATK +15 / DEF +10 per level
- Elite Mob scaling: HP +40 / ATK +25 / DEF +15 per level

### Battle Flow
- Fully automatic — no player input
- Turn-based with HP bars
- Embed updates on rounds **1, 4, 7, 10, …** (every 3rd from round 1) + final state  <!-- [v4.8] was odd rounds 1,3,5,… -->
  - Worst-case raid animation (round-50 cap): 17 in-loop snapshots + start + final = 19 frames → 18 × 1.8s ≈ **32.4s** (was ~46.8s)
- After battle ends: 📋 Battle Log button appears

### Embed Layout
- Player section: TOP — Name + Class, Weapon | Blessing: [Name] ([Deity]), HP bar (green→orange→red), HP text, ATK · DEF · CRIT
- Enemy section: BOTTOM — Name + Type, [v4.2] passive **Skill** line (for transparency) then **Debuffs** line, HP bar, HP text, Stats
- Footer: result/rewards rendered as a canvas strip below the battle render (one line each); Combat EXP uses the `combat_exp` icon

### Battle Log Details
- Every action logged per turn: damage, crits, passive procs, debuff application/expiry
- Example entries:
  - Player: "🏹 You attack for 312 DMG (CRIT!)"
  - Passive: "✨ Freyr's Arrow procs! +156 DMG"
  - Enemy: "💀 Shadow Wraith strikes for 140 DMG (debuffed — ATK −50%)"
  - Expiry: "Shadow Wraith's ATK debuff wore off."

### Raid Loot Drop Rates [REVISED]
| Source | Credux | EXP (Combat) | Belief Shards | Chest |
|---|---|---|---|---|
| Mob win | 100–500 | 100–200 | 3–5 (100%) | Silver (~20%) |
| Mob loss | — | 50 | — | — |
| Elite win | 600–1,000 | 300–500 | 8–10 (~100%) | Gold (~30%) |
| Elite loss | — | 150 | — | — |

### Victory / Defeat
- Victory: embed border → Gold, title → "🏆 Victory!"
- Defeat: embed border → Red, title → "💀 Defeated!"

## 13.1 BATTLE CONFLICT RULES

### Priority Order (Every Turn)
1. Compute base damage (ATK formula)
2. Apply DEF mitigation (highest DEF ignore wins — don't stack)
3. Apply class passive (Bleed/Stun/Overcharge/Pierce/Damage Reduction)
4. Apply weapon passive
5. Apply deity blessing
6. Apply CRIT roll (multiplier applied last)
7. Apply all active DOTs (Bleed/Burn — check immunity_tags first)
8. Apply all active buffs/debuffs (ATK stacks summed additively, applied once)
9. Check CC (stun/paralyze — refresh duration if already active, don't extend)
10. Log all actions

### Conflict Resolution Rules

| Conflict | Rule |
|---|---|
| Multiple Bleed sources | Refresh, don't stack — highest ATK value Bleed wins, resets to 2 turns |
| Multiple ATK buffs | All stack additively — sum all % boosts, apply once to base ATK. Uncapped. |
| Multiple Stuns | Refresh, don't extend — new stun resets to full duration |
| Multiple DEF ignore sources | Higher value wins — e.g. Gram 20% + Harpe 30% = 30% only |
| Multiple healing sources | All apply independently — each triggers on its own condition |
| Multiple evasion sources | Independent rolls — not additive, each checked separately |
| Weapon/class Bleed vs boss immunity | immunity_tags covers ALL sources — both negated if boss is immune |
| Mage Overcharge + CRIT | The entire overcharge attack cannot crit — crit roll suppressed on overcharge rounds (3, 6, 9…); fires as flat +200% ATK bonus |
---

## 14. PVP SYSTEM (`crd duel`)

### Commands
- `crd duel @user` — challenge another player to auto-PvP
- Same auto-battle engine as `crd raid` — no player input
- 50/50 first attack roll applies
- No EXP (combat or reputation) earned from duels — purely a friendly mechanic

### Challenge Flow
1. `crd duel @user` → challenge embed appears
2. Only challenged user can click ⚔ Accept or 🏃 Decline
3. On Accept → battle starts immediately (no pre-battle overview)

### Duel Embed Layout
- Player 1 (Top): Name + Class, Weapon | Blessing, HP bar, HP text, ATK · DEF · CRIT
- Player 2 (Bottom): Same as Player 1
- Embed updates on rounds **1, 4, 7, 10, …** (every 3rd from round 1) + final state  <!-- [v4.8] was every round -->
- 📋 Battle Log button after battle ends
- Victory: border Gold, title "🏆 [Winner] Wins!"
- Defeat: border Red

### Future PvP Upgrade (Skill System — Post-Launch)
- Turn-based with player input buttons per turn
- 10–15 second turn timer; auto Normal Hit on timeout
- Active player buttons: Normal Hit, Skill 1, Skill 2
- Buttons locked to active player only
- New embed generated per turn; overview embed stays as permanent reference

---

## 15. MOB / ELITE MOB ROSTER

> **Timing & durations follow §35.1:** mob skills are round-based; CC + stat debuffs applied to the player last **1 turn**; Bleed/Burn/HP%-DOTs tick **2 turns**; "every Nth attack" reads as "every Nth turn."
> **HP/ATK/DEF below are Level-1 base.** [Jun-2026 mob rebalance] per-level scaling is uniform: **regular +80 HP / +65 ATK / +20 DEF**, **elite +90 HP / +75 ATK / +25 DEF** (CRIT does not scale). Live `mob_roster` is the source of truth.

### PH Mobs — Regular
| Name | HP | ATK | DEF | CRIT | Skill |
|---|---|---|---|---|---|
| Black Duwende | 2,110 | 368 | 178 | 5% | Hex — 25% chance reduce player ATK -15% for 1 turn |
| White Duwende | 2,070 | 375 | 172 | 5% | Daze — 20% chance reduce player CRIT -50% for 1 turn |
| Amalanhig | 2,230 | 362 | 168 | 5% | Infectious Bite — 30% on hit: Rot 5% max HP/turn for 2 turns |
| Amomongo | 2,090 | 380 | 165 | 5% | Rend — Every 3rd turn deals 150% ATK |
| Bal-Bal | 2,050 | 368 | 178 | 5% | Carrion Sense — When player HP < 30%: ATK +20% |
| Santelmo | 2,060 | 366 | 174 | 5% | Will-o-Wisp — 20% chance each turn: player skips next attack |

### PH Mobs — Elite
| Name | HP | ATK | DEF | CRIT | Skill |
|---|---|---|---|---|---|
| Manananggal | 2,950 | 422 | 240 | 10% | Viscera Drain — Every 3 turns: drain 15% player max HP + heal self |
| Aswang | 2,650 | 445 | 235 | 10% | Shape Shift — Every 4 turns: copy player current ATK for 2 turns |
| Tikbalang | 2,590 | 438 | 242 | 10% | Disorientation — Every 3 turns: player ATK -20% for 1 turn |
| Kapre | 3,050 | 420 | 238 | 10% | Smoke Cloud — Every 4 turns: player CRIT -30% and ATK -10% for 1 turn |
| Sigbin | 2,550 | 418 | 258 | 10% | Shadow Step — 20% chance to evade any incoming attack |
| Batibat | 3,030 | 424 | 236 | 10% | Sleep Paralysis — Every 4 turns: paralyze player 1 turn (guaranteed skip) |

### Norse Mobs — Regular
| Name | HP | ATK | DEF | CRIT | Skill |
|---|---|---|---|---|---|
| Troll | 2,230 | 366 | 174 | 5% | Regeneration — Recovers 5% max HP at start of each turn |
| Dwarf | 2,130 | 365 | 185 | 5% | Stone Skin — Every 4 turns: absorb next hit up to 20% max HP |
| Dark Elf | 2,070 | 380 | 165 | 5% | Curse of Decay — 25% on hit: DEF -10% for 1 turn |
| Light Elf | 2,110 | 368 | 177 | 5% | Radiant Strike — 20% chance: blind player (CRIT to 0% for 1 turn) |

### Norse Mobs — Elite
| Name | HP | ATK | DEF | CRIT | Skill |
|---|---|---|---|---|---|
| Ratatoskr | 2,550 | 450 | 230 | 10% | Slander — Every 3 turns: player ATK -20% for 1 turn |
| Fossegrim | 2,750 | 428 | 244 | 10% | Enchanting Melody — Every 4 turns: player skips next turn |
| Nokken | 2,650 | 442 | 238 | 10% | Luring Form — Every 3 turns: player DEF -20% for 1 turn |
| Valkyrie | 2,710 | 448 | 248 | 10% | Battle Judgment — Every 4 turns: next attack deals 200% ATK |

### Greek Mobs — Regular
| Name | HP | ATK | DEF | CRIT | Skill |
|---|---|---|---|---|---|
| Satyr | 2,040 | 372 | 178 | 5% | Wild Revelry — 25% chance each turn: player ATK -15% for 1 turn |
| Harpy | 1,970 | 382 | 166 | 5% | Swooping Talons — Every 3rd turn: 150% ATK + DEF -10% for 1 turn |
| Skeleton Warrior | 2,110 | 368 | 185 | 5% | Undying Resolve — When HP < 30%: DEF +25% for remainder of battle |
| Lamia | 2,000 | 378 | 172 | 5% | Serpent Bite — 30% on hit: flat Bleed ATK×0.35/turn for 2 turns |

### Greek Mobs — Elite
| Name | HP | ATK | DEF | CRIT | Skill |
|---|---|---|---|---|---|
| Minotaur | 2,650 | 448 | 238 | 10% | Labyrinth Charge — Every 3 turns: 180% ATK. If player HP > 70%: 220% ATK |
| Cyclops | 3,050 | 422 | 255 | 10% | Boulder Throw — Every 4 turns: 160% ATK + stun 1 turn |
| Chimera | 2,710 | 442 | 242 | 10% | Tri-Form Assault — Rotates: Lion Claw (140% ATK) → Goat Ram (DEF -20%) → Serpent Bite (Burn ATK×0.30 for 2 turns) |

---

## 16. BOSS SYSTEM

### Overview
- 1 active boss per server at a time
- Spawns every 15 minutes after boss is killed or escapes
- Boss timer: 2 hours to kill before it escapes  [v4.1: was 1 hour]
- No rewards if boss escapes
- Boss HP carries over across all player attacks until killed or escaped
- Boss art: `/assets/monsters/boss/<boss_slug>.png` (slug rule from Roster & Asset Conventions; looked up by name convention — mob_roster has NO image column, schema frozen). Renderer falls back gracefully if the file is missing.

### Boss Level & Scaling
```
Boss Level = Server Average Player Level + random(1–10)
Boss HP    = Base HP  + (HP per Level  × Boss Level)
Boss ATK   = Base ATK + (ATK per Level × Boss Level)
Boss DEF   = Base DEF + (DEF per Level × Boss Level)
```
NOTE: Only registered players count toward server average level.

### Boss Encounter Mechanics
- Individual 1v1 turn-based fight (same as mob encounters)
- [v4.2] Player always attacks first in boss fights — no 50/50 roll. Boss `first_strike` passive (Sleipnir) overrides and keeps the boss first.
- Player fights from Turn 1 until they die
- Player cannot kill the boss — only chips shared HP pool
- All player damage deducted from server-wide shared HP pool
- Debuffs and passives are isolated per player instance

### Player Attack Rules (Global)
- Each player gets 1 boss attack per day globally
- Once a player attacks any boss in any server they are locked from attacking any other boss for the rest of that day
- Daily reset unlocks them
- Lock applies whether boss dies or escapes

### Boss Immunities (Universal)
- ALL bosses immune to HP% damage (Hemorrhage, Ignite, Rupture) — no exceptions
- Flat Bleed and Flat Burn still apply unless boss passive specifically blocks them

### Boss Individual Passives
| Boss | Passive |
|---|---|
| Berberoka | Immune to DEF debuffs |
| Bungisngis | Immune to Stun |
| Anggitay | Immune to all debuffs |
| Dalaketnon | Immune to Armor Piercing |
| Jotun | Immune to DEF debuffs |
| Fenrir | Immune to Bleed + Stun |
| Fafnir | Immune to Armor Piercing |
| Sleipnir | Immune to Stun + Always attacks first |
| Cerberus | Immune to Stun |
| Hydra | Immune to DEF debuffs |
| Medusa | Immune to all debuffs |

NOTE: Huginn & Muninn removed from boss lineup.

### PH Boss Roster
| Boss | Base HP | Base ATK | Base DEF | CRIT | HP+/Lv | ATK+/Lv | DEF+/Lv |
|---|---|---|---|---|---|---|---|
| Berberoka | 65,000 | 1,440 | 750 | 8% | +350 | +72 | +30 |
| Bungisngis | 62,000 | 2,000 | 450 | 10% | +300 | +80 | +25 |
| Anggitay | 63,000 | 1,530 | 590 | 12% | +320 | +74 | +27 |
| Dalaketnon | 63,500 | 1,710 | 650 | 20% | +330 | +75 | +27 |

### Norse Boss Roster
| Boss | Base HP | Base ATK | Base DEF | CRIT | HP+/Lv | ATK+/Lv | DEF+/Lv | Special |
|---|---|---|---|---|---|---|---|---|
| Jotun | 68,000 | 1,530 | 710 | 5% | +400 | +72 | +29 | Highest HP |
| Fenrir | 63,000 | 2,200 | 510 | 25% | +310 | +82 | +25 | Highest ATK |
| Fafnir | 66,000 | 1,584 | 1,050 | 8% | +370 | +73 | +33 | Highest DEF |
| Sleipnir | 62,000 | 2,100 | 550 | 30% | +290 | +80 | +27 | Always attacks first |

### Greek Boss Roster
| Boss | Base HP | Base ATK | Base DEF | CRIT | HP+/Lv | ATK+/Lv | DEF+/Lv | Special |
|---|---|---|---|---|---|---|---|---|
| Cerberus | 64,000 | 1,760 | 550 | 15% | +330 | +76 | +27 | Attacks twice per round (60% ATK each, both can crit) |
| Hydra | 67,000 | 1,490 | 790 | 10% | +390 | +72 | +29 | Regenerates 1% max HP every 3rd turn (per-instance; only NET damage commits to the shared pool)  [Jun-2026 §4: was 5%] |
| Medusa | 63,500 | 1,640 | 610 | 20% | +315 | +74 | +27 | Stone Stare — Every 3rd turn: Petrify player 1 turn, then the counter resets |

### Boss Rewards
| Reward | Amount |
|---|---|
| Credux | 100,000 |
| EXP (Combat) | 20,000 |
| Boss Treasure Chest | 1× |
| Belief Shards (participation) | 1,000 |

Condition: Boss must be killed. Player must have personally attacked that boss during that spawn. **All rewards are participation-only — no top-damage reward.** (Boss Golden Chest is a future World-Boss reward, not granted by the server boss.)

### Greater Boss Tier [v4.4]
Apex boss variants. The five Greater Bosses are **Jotun, Fenrir, Fafnir, Hydra, Cerberus** (matched by exact `mob_roster` name; source of truth is the `GREATER_BOSSES` set in `src/config/bosses.js`). No schema change — uses the free-form `special_flags` JSONB / code set; optional tag SQL at `scripts/tag_greater_bosses_v4_4.sql`.

- **Weighted spawn:** when a boss spawns, roll the tier first — **80% normal boss / 20% Greater Boss**. The chosen tier picks uniformly among its rows present in the roster (a missing Greater name is simply skipped). This tier roll is on top of the normal boss-vs-nothing spawn cadence.
- **Stat change — 2× HP only:** at spawn, a Greater Boss's computed `max_hp`/`current_hp` are doubled. ATK / DEF / CRIT / level / skill are unchanged.
- **Greater drops** (participation, same model — every attacker of the spawn receives it):

| Reward | Normal Boss | Greater Boss |
|---|---|---|
| Credux | 100,000 | **150,000** |
| EXP (Combat) | 20,000 | **30,000** |
| Belief Shards | 1,000 | 1,000 |
| Chest | 1× Boss Treasure Chest | **80% → 2× Boss Treasure Chest / 20% → 1× Boss Golden Chest** ([v4.6] rolled ONCE at spawn, fixed for that fight, shown in the spawn announcement) |

- **Announcement:** Greater spawns get a distinct header (`☠️ GREATER BOSS — A world-ender awakes…`) and the doubled HP shows in the pool bar; the participation-rewards block lists the Greater values. Announcement and payout both read the same `GREATER_BOSSES` set, so they never disagree.

---

## 17. LEVELING SYSTEM

### Combat Level (RPG Progression)
- Max Level: 50
- EXP earned through combat only

### Combat EXP Sources
| Source | EXP |
|---|---|
| Common Mob win | 100–200 |
| Common Mob loss | 50 |
| Elite Mob win | 300–500 |
| Elite Mob loss | 150 |
| Boss (on defeat) | 20,000 |
| Duel | 0 |

### Combat EXP Requirements per Level

**Tier 1 — Learning (Levels 1–20)**
| Level | EXP Required | Total EXP |
|---|---|---|
| 1→2 | 100 | 100 |
| 2→3 | 250 | 350 |
| 3→4 | 500 | 850 |
| 4→5 | 900 | 1,750 |
| 5→6 | 1,500 | 3,250 |
| 6→7 | 2,400 | 5,650 |
| 7→8 | 3,700 | 9,350 |
| 8→9 | 5,500 | 14,850 |
| 9→10 | 8,000 | 22,850 |
| 10→11 | 12,000 | 34,850 |
| 11→12 | 17,000 | 51,850 |
| 12→13 | 24,000 | 75,850 |
| 13→14 | 33,000 | 108,850 |
| 14→15 | 45,000 | 153,850 |
| 15→16 | 60,000 | 213,850 |
| 16→17 | 80,000 | 293,850 |
| 17→18 | 105,000 | 398,850 |
| 18→19 | 135,000 | 533,850 |
| 19→20 | 175,000 | 708,850 |

**Tier 2 — Dedicated (Levels 21–30)**
| Level | EXP Required | Total EXP |
|---|---|---|
| 20→21 | 215,000 | 923,850 |
| 21→22 | 265,000 | 1,188,850 |
| 22→23 | 325,000 | 1,513,850 |
| 23→24 | 395,000 | 1,908,850 |
| 24→25 | 475,000 | 2,383,850 |
| 25→26 | 565,000 | 2,948,850 |
| 26→27 | 670,000 | 3,618,850 |
| 27→28 | 790,000 | 4,408,850 |
| 28→29 | 925,000 | 5,333,850 |
| 29→30 | 1,080,000 | 6,413,850 |

**Tier 3 — Veteran (Levels 31–40)**
| Level | EXP Required | Total EXP |
|---|---|---|
| 30→31 | 1,250,000 | 7,663,850 |
| 31→32 | 1,450,000 | 9,113,850 |
| 32→33 | 1,680,000 | 10,793,850 |
| 33→34 | 1,950,000 | 12,743,850 |
| 34→35 | 2,250,000 | 14,993,850 |
| 35→36 | 2,600,000 | 17,593,850 |
| 36→37 | 3,000,000 | 20,593,850 |
| 37→38 | 3,450,000 | 24,043,850 |
| 38→39 | 3,950,000 | 27,993,850 |
| 39→40 | 4,500,000 | 32,493,850 |

**Tier 4 — Endgame (Levels 41–50)**
| Level | EXP Required | Total EXP |
|---|---|---|
| 40→41 | 5,100,000 | 37,593,850 |
| 41→42 | 5,800,000 | 43,393,850 |
| 42→43 | 6,600,000 | 49,993,850 |
| 43→44 | 7,500,000 | 57,493,850 |
| 44→45 | 8,500,000 | 65,993,850 |
| 45→46 | 9,600,000 | 75,593,850 |
| 46→47 | 10,800,000 | 86,393,850 |
| 47→48 | 12,100,000 | 98,493,850 |
| 48→49 | 13,500,000 | 111,993,850 |
| 49→50 | 15,000,000 | 126,993,850 |

**Total EXP to Level 50: ~127 Million** (was ~33.5M before the Jun-2026 anti auto-grind rescale)
**Timeline:** Level 20 in ~1–2 weeks · curve raised most in early/mid game so auto-grinders no longer blow through Tier 1

---

## 18. REPUTATION SYSTEM (BELIEVER LEVEL)

- Tracks bot usage activity — **cosmetic/prestige only, no gameplay effect**
- No max level (unlimited)
- EXP flat: **3,000 Reputation EXP per level** (no scaling)

### Reputation EXP Sources [REVISED — 5,000/day cap]
| Action | Reputation EXP |
|---|---|
| `crd daily` | 200 |
| `crd summon` (per pull) | 10 |
| `crd enhance` weapon | 50 |
| `crd deity enhance` | 50 |
| `crd bestow` | 50 |
| Complete a daily quest | 500 |

- **Daily cap: 5,000 Reputation EXP per day**
- Cap resets at midnight PHT alongside daily reset
- Raid EXP and Boss EXP are Combat EXP — entirely separate from Reputation EXP

### Believer Level Titles
| Level Range | Title |
|---|---|
| 1–9 | Wanderer |
| 10–24 | Devotee |
| 25–49 | Disciple |
| 50–99 | Zealot |
| 100–199 | Champion of Faith |
| 200–499 | Chosen One |
| 500+ | Last Believer |

---

## 19. DAILY SYSTEM

### Command
- `crd daily` — collect daily reward
- Resets at midnight PHT (UTC+8)
- Miss a day → FULL RESET of both streaks and chest progress back to Day 1

### Streak Trackers (Two Independent)
- **Monthly Streak:** 1–30 days, resets each 30-day cycle
- **Overall Streak:** Lifetime consecutive days, never resets
- Display: "Month: 20 / 30 · Overall: 100 days"

### Daily Chest Rewards
| Days | Chest |
|---|---|
| Day 1–6 | 1 Silver Chest |
| Day 7 | 1 Gold Chest |
| Day 8–13 | 1 Silver Chest |
| Day 14 | 1 Gold Chest |
| Day 15–20 | 1 Silver Chest |
| Day 21 | 1 Gold Chest |
| Day 22–27 | 1 Silver Chest |
| Day 28 | 1 Gold Chest |
| Day 29 | 1 Gold Chest |
| Day 30 | 1 Gold Chest |

*(Fixed 30-day rolling cycle: Day 30 → loops to Day 1. No calendar/31st-day handling. Miss a day → monthly streak resets to Day 1.)*

### Daily Credux & Belief Shard Scaling
| Day | Credux | Belief Shards |
|---|---|---|
| Day 1–6 | 1,000 | 3 |
| Day 7 | 5,000 | 10 |
| Day 8–13 | 2,000 | 5 |
| Day 14 | 8,000 | 15 |
| Day 15–20 | 3,000 | 8 |
| Day 21 | 12,000 | 20 |
| Day 22–27 | 4,000 | 10 |
| Day 28 | 15,000 | 25 |
| Day 29 | 18,000 | 28 |
| Day 30 | 25,000 | 35 |

*(Monthly streak = day position 1–30 in the fixed cycle.)*

### Daily Embed Layout
- Title: "📅 Daily Attendance — Day X"
- Monthly + overall streak: "Month: X / 30 · Overall: X days"
>Separator
- Rewards received today: (Credux, Belief Shards, Chest) One line each
>Separator
- Footer line Lore line: *"The gods take note of your devotion."*
---

## 20. DAILY QUESTS

### Command
- `crd quest` / `crd quests` — view progress and rewards embed (3 quests labeled Q1/Q2/Q3)
- `crd quest refresh <Q1|Q2|Q3>` — reroll one quest line; **2 refreshes per player per day** (PHT)
- Resets at midnight PHT alongside daily
- Independent from daily streak — purely bonus rewards, no penalty for incomplete

### Quest Structure
- 3 quests rolled daily from pool at midnight PHT
- No duplicate quest types in same day
- Counts randomized within range on rollover
- Progress tracked automatically from game actions
- [v4.2] Refresh: a refresh rerolls one line into a fresh quest of a type not currently
  active and resets its progress. Allowance is 2/day (PHT), tracked on
  `users.quest_refreshes_today` / `last_quest_refresh_date`. Dev `crd dev quest refresh`
  bypasses the cap.

### Quest Pool & Count Ranges
| Quest | Min | Max |
|---|---|---|
| Win battles via `crd raid` | 3 | 10 |
| Defeat elite mobs | 2 | 5 |
| Spend Credux on enhancement | 5,000 | 50,000 |
| Enhance a weapon X times | 2 | 5 |
| Win a duel via `crd duel` | 1 | 3 |
| Challenge X players to a duel | 2 | 5 |

### Quest Rewards (Scaling by Count)
**Combat Quests**
| Count Rolled | Credux | Belief Shards |
|---|---|---|
| Win 3–5 raids | 3,000 | 5 |
| Win 6–8 raids | 6,000 | 10 |
| Win 9–10 raids | 10,000 | 15 |
| Defeat 2–3 elites | 5,000 | 8 |
| Defeat 4–5 elites | 10,000 | 15 |

**Economy Quests**
| Count Rolled | Credux | Belief Shards |
|---|---|---|
| Spend 5k–20k Credux | 4,000 | 5 |
| Spend 21k–50k Credux | 9,000 | 12 |
| Enhance 2–3 times | 4,000 | 5 |
| Enhance 4–5 times | 8,000 | 10 |

**Social Quests**
| Count Rolled | Credux | Belief Shards |
|---|---|---|
| Win 1 duel | 5,000 | 8 |
| Win 2–3 duels | 12,000 | 18 |
| Challenge 2–3 players | 3,000 | 5 |
| Challenge 4–5 players | 6,000 | 10 |

### Quest Embed Layout [v4.2 — Components V2 + canvas render]
- Header: Title "📋 Daily Quests"
- Separator
- "Resets in X hours" (countdown to midnight PHT)
- Body: CANVAS RENDER (same format as the `crd bag` chests embed body) — 3 quest entries: name, progress bar (▓▓▓░░ X/Y), reward, status (✅ or 🔄)
- Separator
- Footer lore line: *"The gods reward those who prove their worth."*

---

## 21. PROFILE & STATS

### Commands
- `crd profile` / `crd stats` — shows full profile card (Canvas PNG)

### Rendering
- Pure node-canvas rendering — generates PNG on the fly
- Discord avatar fetched via Discord API
- ~200–500ms generation time

### Profile Card Layout
- **Top:** Discord avatar (circle), username, Believer Level + Title badge, EXP progress bar
- **Bottom:** Class · Deity: [Blessing Name] ([Deity Name]) · Weapon Equipped (tier color), Total Stats: ATK · DEF · HP · CRIT, Raids Won, Duels: X Won / X Lost · Win Rate X%

---

## 22. INVENTORY / BAG SYSTEM

### Commands
- `crd bag` / `crd b` — overview of everything
- `crd bag chests` — chest inventory with open commands
- `crd bag weapons` — weapon list (paginated, 10 per page, sorted by tier)
- `crd open [id] [amount]` — open chests (max 10)
- `crd open sr` — open 1 Sacred Relic (10 deity rolls)
- `crd open supr` — open 1 Supreme Relic (1 Supreme pull)
- `crd equip [weapon ID]` — equip a weapon (1 at a time, equipping replaces current)

### Bag Overview (`crd bag`)
- Shows: Chests section, Relics section, Weapons preview (equipped + top 2)
- Footer: Credux balance + Belief Shards + **Sacred Relic: X · Supreme Relic: X**
- Help text: `crd bag chests`, `crd bag weapons`

### Bag Weapons (`crd bag weapons`)
- Sort: Legendary → Mythic → Rare (highest tier first)
- 10 weapons per page, paginated
- Each weapon: ID, icon, name, tier, enhancement level, stats
- Equipped weapon: green border + "Equipped" badge
- Weapon ID clickable → copies to clipboard
- Filter dropdowns: Filter by Tier, Filter by Type
- Footer: Credux + Belief Shards + Relic counts
- Help text: `crd equip [id]`, `crd weapon info [weapon ID]`

### Relics in Bag [REVISED]
- **No separate `crd bag relics` command**
- Relics shown in footer of ALL bag embeds: `Sacred Relic: 8 · Supreme Relic: 0`

### Weapon Lock & Sell [NEW]
Weapons over-populate `user_weapons` fast (every chest drops one). Locking protects keepers; selling clears the rest for a small Credux refund.

**Lock**
- `crd lock [weapon ID]` — sets `is_locked = TRUE` (🔒). Locked weapons are **excluded** from every `crd sell`.
- `crd unlock [weapon ID]` — sets `is_locked = FALSE`.
- The bag weapon list shows a 🔒 badge on locked weapons.

**Sell (permanent — deletes the rows)**
- `crd sell [weapon ID]` — sell one specific weapon (blocked if it's equipped → *"Unequip it first."*).
- `crd sell common` / `rare` / `mythic` / `legendary` / `supreme` — sell every unlocked, unequipped weapon of that tier.
- `crd sell all` — sell every unlocked, unequipped weapon **except Legendary and Supreme** (those can only be sold by explicit ID, to prevent accidental loss).
- Always excludes: locked weapons **and** the currently equipped weapon.

**Fixed sell prices (Credux per weapon):**
| Tier | Price |
|---|---|
| Common | 100 |
| Rare | 1,000 |
| Mythic | 50,000 |
| Legendary | 100,000 |
| Supreme | 1,000,000 |

**Confirmation (plain text + buttons — NOT an embed):**
> ⚠️ *Are you sure you want to sell **[count]** weapons for **[total] Credux**? This will **permanently delete** them and cannot be undone. Locked and equipped weapons are excluded.*
> **[ ✅ Confirm ]  [ ❌ Cancel ]**

- Count + payout are computed at prompt time and **recomputed on Confirm** (so a weapon obtained between prompt and click isn't mis-sold).
- On Confirm (single transaction): `DELETE` the matching rows, credit Credux, INSERT `game_logs` (action = `Sell Weapon`, `item_type` = sold tier or `all`, previous/updated Credux).
- On Cancel: nothing happens.

**Delete query shape** (tier example; `weapon_roster` join because `tier` lives there, not on `user_weapons`):
```sql
DELETE FROM user_weapons uw
USING weapon_roster wr
WHERE uw.weapon_roster_id = wr.weapon_roster_id
  AND uw.discord_id = $1
  AND wr.tier = 'Rare'
  AND uw.is_locked = FALSE
  AND uw.weapon_id <> $equipped_weapon_id;
-- `crd sell all`: drop the wr.tier line AND add wr.tier NOT IN ('Legendary','Supreme')
```

---

## 23. REGISTRATION & CHARACTER CREATION

### Bot Registration [REVISED]
- Any bot command from an unregistered player → redirects to registration
- Bot sends welcome message + story + mechanics explanation
- Single confirm button: **"I Understand"** only — no "Not Yet" or Cancel button
- On confirm: player registered, granted access to all commands
- Does NOT create character — character is a separate step

### Welcome Message
> *Welcome to Credd, the home of many adventures. One of them is waiting for you.*

### The Story
> *In the age before silence, the world thrived under the watch of gods and spirits. Mortals prayed, offered, and remembered, and in return, the divine kept the darkness at bay.*
>
> *But slowly, the prayers stopped. The offerings ceased. One by one, gods faded as the last whisper of their names died on human lips. Without belief, there is no power. Without power, there is no protection.*
>
> *The monsters came first in shadows, then in floods. Creatures long kept in the depths of the earth and sea rose unchallenged. The world that was once guarded by divine hands crumbled into chaos. Cities fell. The faithful were scattered. And the gods were forgotten.*
>
> *But not all of them.*
>
> *Somewhere, in the ruins of a world that stopped believing, you still remember. A name. A story. A prayer. That single act of remembrance is enough to pull a forgotten god back from the void, weak, faded, but alive.*
>
> *You are the Last Believer. And the fate of gods rests in your memory.*

### Mechanics Explanation (Lore-Toned) [REVISED]
> **Your journey begins here, Last Believer. Here is what you must know:**
>
> **1. Your Warrior** `crd create character`
> *Every believer needs a vessel. Create your warrior and choose the path you walk, whether as a blade-wielding Swordsman, an iron-fisted Fighter, a spell-weaving Mage, an unbreakable Knight, or a swift Archer. Your class defines how you fight.*
>
> **2. The Forgotten Gods** `crd summon` / `crd s`
> *Speak their names and they will answer. Perform an Invocation to summon forgotten deities from the void. Channel their power and carry their will into battle. The stronger your belief, the greater the god you may awaken.*
>
> **3. Your Arsenal** `crd bag` / `crd b`
> *A believer does not fight with faith alone. Collect and equip weapons forged from history and myth. Each weapon carries its own power, and in the hands of the right warrior, it can turn the tide of any battle.*
>
> **4. The Battle** `crd raid` / `crd r`
> *The monsters will not wait. March into battle against creatures and elite beasts that have overtaken the land. Every victory weakens the chaos. Every defeat is a reminder of what is at stake.*
>
> **5. Wealth of the Believer** `crd cred` / `crd g`
> *Belief Shards fuel your Invocations. Sacred Relics open greater summons. Credux strengthens your weapons. Manage your resources wisely, for the road ahead is long.*

### Confirm Button
**"I Understand"** — single button only

### Character Creation (`crd create character`) [REVISED]
- Separate command from registration
- Goes straight to class selection (no welcome embed)
- Discord embed with 5 class buttons: ⚔ Swordsman · 👊 Fighter · 🔮 Mage · 🛡 Knight · 🏹 Archer
- On button click: embed updates to show class flavor text + passive preview (NO stats shown)
- Confirm / Go Back buttons
- On confirm: character created in DB; a real starter weapon row (Initiate's Blade) is generated and equipped
- **On character creation completion: player receives 1,000 Belief Shards + 10 Silver Chests** (granted ONLY here — not at registration; users_bag defaults are 0)
- If unregistered RPG command used → *"You don't have a character yet. Use `crd create character` to get started."*

---

## 24. CASINO SYSTEM

### Commands [NEW]
| Command | Alias | Options |
|---|---|---|
| `crd coin toss [amount] heads/tails` | `crd ct [amount] h/t` | heads / tails |
| `crd dice roll [amount] odd/even` | `crd dr [amount] o/e` | odd / even |
| `crd baccarat [amount] banker/player` | `crd bac [amount] b/p` | banker / player |
| `crd blackjack [amount]` | `crd bj [amount]` | — |
| `crd slot machine [amount]` | `crd sm [amount]` | — |
| `crd crash [amount]` | none | — |

- Game mechanics handled on backend
- All bets in Credux
- All activity logged in `casino_logs`

### Mechanics [v4.5] — BUILD (Phase 10, authoritative)

**Core principles.** All randomness is decided on the backend BEFORE anything renders; the
embed only visualizes a settled result. Every draw uses a single crypto-backed RNG
(`crypto.randomInt`), never `Math.random`. **Virtual economy: all wins pay 100% of the stated
multiplier — no house edge, no baccarat commission, no payout shaving.** Entry gate: a
registered account with sufficient Credux (a created *character* is NOT required). Per-command
**25s cooldown for every casino game** (anti-spam) <!-- [v4.8] was 10s -->. Currency: `users_bag.credux`.

**Max bets.** 150,000 for every game **except crash = 25,000**.

| Game | Header | Win condition | Multiplier |
|---|---|---|---|
| Coin Toss | Coin of Fates | match Heads (**Aeternvm**) / Tails (**Obscvrvm**), true 50/50 | 2× |
| Dice Roll | Trial of the Ancients | two independent d6; total parity matches odd/even | 2× |
| Baccarat | The Oracle's Table | bet side wins; **tie → push** (bet returned); no commission | 2× |
| Blackjack | The Sacred XXI | beat dealer; dealer hits to 17 (stands soft 17); bust = loss; natural 21 = normal 2× | 2× (push returns bet) |
| Slot Machine | The Vault of Relics | three matching faces on the payline | see ladder |
| Crash | The Ascension | cash out before the ascension collapses | see curve |

**Suit mapping (cards) [v4.6]:** Pegasus = Clubs, Trident = Spades, Laurel = Hearts, Hammer =
Diamonds (display names are title-cased slugs). Card assets are STATIC PNGs at
`assets/casino/cards/img/{suit}_{rank}.png` (e.g. `pegasus_a.png`, `trident_10.png`); dealer hole
card `card_back.png`. Baccarat points A=1 / 2–9 pip / 10·J·Q·K=0 (score = Σ mod 10); blackjack
A=1 or 11 (best). **[v4.7]** each round deals from a single 52-card deck **without replacement**
(`cardDeck.newDeck(rng).draw()`), so a hand can never hold the same suit+rank twice (e.g. two
Hammer 6s); the first draw is uniform over 52, keeping rank/suit distributions flat. A baccarat
hand (≤6 cards) or blackjack hand never exhausts the deck, so single-deck-per-round is the model.
(Suit slugs + assets unchanged from [v4.6].)

**Render.** SPIN frames show the animated GIFs padded to a fixed canvas via `sharp` (coin one,
dice two, slot three reels). RESULT frames are composited on canvas (`@napi-rs/canvas`) as a small
CENTERED image strip plus a CENTERED win/lose banner (Discord text can't be centered, so the
banner is drawn). Cards render as one small centered card-strip per hand (avoids the media-gallery
mosaic that oversized 3+ items). The **slot spin is one composited animated
strip** (`imagePad.reelStripGif` joins the 3 reels into a single one-line GIF, cached — Discord
would otherwise mosaic 3 gallery items as 1-big-2-small). The GIF→PNG swap uses fixed waits
**[v4.7]**: coin reveal at **4.5s** (pulled −0.5s from the prior effective ~5.0s so it lands on the
intended mark); dice roll 0–2s, reveal at **2.5s**; slot reveal at **9s** so all three staggered
reels fully land first (measured longest reel ≈ 8.1s, clearing 9s by ~0.9s). Settlement/balance
update fires at the reveal, not before. Result text is tiny and auto-shrinks to never overflow;
cards are composited as-is — **[v4.7]** no rank-text overlay (the PNG art already shows the rank);
crash uses compact fonts.
**Baccarat is a sequential reveal:** deal four face-down `card_back` cards (Player 2, Banker 2),
then flip one at a time in baccarat order — Player 1st, Banker 1st, Player 2nd, Banker 2nd —
editing the message in place (~0.75s/flip); any third card is dealt face-down then flipped the same
way; final frame shows all face-up + scores + verdict. Settlement is computed up front (locks funds
+ outcome) but the new balance is shown only on the final frame. The dealer hole / face-down backs
load `cards/img/card_back.png`. **Blackjack** hands are card-strips (active = hole hidden; final = revealed
+ centered banner). Crash body is a drawn panel (compact fonts). Result assets: coin
`coin/{heads|tails}.png`, dice `dice/face_{n}.png`, cards `cards/img/{suit}_{rank}.png`
([v4.6] static PNG), slot faces `slots/{face}_face.png`. Separators divide header/body and the
player↔banker / dealer↔player sections. Fixed (non-card) padded GIFs + durations are pre-warmed at
startup. Deps: `sharp` (GIF padding/duration), `@napi-rs/canvas` (result strips + crash panel).

**Slot ladder** (highest-prize-first; each rung an independent crypto roll at its own
probability; first hit wins and stops; miss every rung → a non-winning combo that is never
three-of-a-kind):

| Rung | Face | Probability | Payout |
|---|---|---|---|
| 1 | Wings | 1% | ×20 |
| 2 | Trident | 5% | ×10 |
| 3 | Skull | 10% | ×5 |
| 4 | Lightning | 30% | ×2 |
| 5 | Horus | 30% | ×1.5 |
| — | (lose) | remainder | — |

<!-- [v4.7] Lightning & Horus lowered 50%→30% each; net win rate ≈ 58.52% (was ≈ 78.84%). Multipliers unchanged. -->


Reels stagger via GIF length: reel 1 `slots/3s/` (3s), reel 2 `slots/4s/` (4s), reel 3
`slots/5s/` (5s); filenames `{3s|4s|5s}_{face}_{n}.gif` (horus_1, lightning_2, skull_3,
trident_4, wings_5). Fractional multipliers floor the gross payout.

**Crash progression** (each push rolls the crash chance FIRST; survive → lock the cash-out
multiplier; crash → lose the already-debited bet and the crash point shown is that push's
multiplier):

| Push | Crash chance | Cash-out multiplier |
|---|---|---|
| 1 | 20% | 1.45× |
| 2 | 25% | 2.10× |
| 3 | 30% | 3.05× |
| 4 | 35% | 4.42× |
| 5 | 40% | 6.40× |
| 6 | 45% | 9.28× |

**Extension past push 6:** crash chance = `min(75, 15 + 5·push)` (push 7 = 50%, push 8 = 55%, …
capped at **75%**); cash-out multiplier = `round2(9.28 · 1.45^(push−6))` (push 7 ≈ 13.46×, push
8 ≈ 19.51×, …) — the ×1.45 geometric step reproduces the published rows. **60s inactivity →
AUTO-CASH-OUT** at the current safe multiplier (player-friendly).

**The money path.** *Instant games* (coin, dice, baccarat, slot): outcome computed first, then
ONE atomic transaction settles the NET (`credux += payout − bet`, guarded `WHERE credux ≥ bet`);
the stake is never debited separately. *Stateful games* (blackjack, crash): the bet is DEBITED
up front (locks funds against double-spend; one active session per user, enforced in memory),
and the full payout is CREDITED on resolution; a restart mid-session leaves the bet debited =
a loss. `casino_logs.result` is binary (`win`/`loss`): logged `win` iff `payout > 0`, so a push
(stake returned, net 0) logs as `win` with `payout = bet`. `payout` is always the GROSS returned.

**`casino_logs.metadata` (JSONB) per game:**
- coin_toss: `{ pick, result }`
- dice_roll: `{ pick, d1, d2, sum, parity }`
- baccarat: `{ pick, winner, pScore, bScore, push }`
- blackjack: `{ outcome, player_value, dealer_value, player:[ranks], dealer:[ranks] }`
- slot_machine: `{ reels:[face×3], face, mult }`
- crash: `{ pushes, crashed, multiplier, crash_point }`

> Supersedes the §35-era draft note ("coin/dice 1.95×, baccarat 5% commission, BJ 3:2, slots
> ~90% RTP, crash ~3% edge"): under the [v4.5] virtual-economy rule there is no edge or
> commission and all even-money wins pay a clean 2×.

---

## 25. HELP SYSTEM [REVISED]

`crd help` shows category list only — no command wall. Dev commands hidden entirely.

| Category | Shows |
|---|---|
| `crd help battle` | raid, duel |
| `crd help casino` | coin toss, dice roll, baccarat, blackjack, slot machine, crash |
| `crd help deity` | summon, deity collection, deity info, deity enhance |
| `crd help inventory` | bag, bag chests, bag weapons, open, equip, enhance, weapon info, lock, unlock, sell |
| `crd help economy` | crd cred, bestow, daily, quests |
| `crd help profile` | profile, stats |

---

## 26. FULL COMMAND LIST [REVISED]

### Player Commands
| Command | Alias | Description |
|---|---|---|
| `crd register` | — | Register to use the bot |
| `crd create character` | — | Create RPG character + choose class |
| `crd profile` | `crd stats` | View profile card (Canvas PNG) |
| `crd summon` | `crd s` | 1 deity pull (100 Belief Shards) — requires a character |
| `crd summon 5` | — | 5 deity pulls (500 Belief Shards) |
| `crd summon 10` | — | 10 deity pulls (1,000 Belief Shards) |
| `crd raid` | `crd r` | Battle vs mob or elite mob |
| `crd duel @user` | — | Challenge player to auto-PvP |
| `crd bag` | `crd b` | View inventory overview |
| `crd bag chests` | — | View chest inventory |
| `crd bag weapons` | — | View weapon inventory |
| `crd open [id] [amount]` | — | Open chests (sc/gc/btc/bgtc/supc) |
| `crd open sr` | — | Open 1 Sacred Relic (10 deity rolls) |
| `crd open supr` | — | Open 1 Supreme Relic (1 Supreme pull) |
| `crd equip [weapon ID]` | — | Equip a weapon |
| `crd enhance [weapon ID]` | — | Enhance a weapon |
| `crd lock [weapon ID]` | — | Lock a weapon (excluded from selling) |
| `crd unlock [weapon ID]` | — | Unlock a weapon |
| `crd sell [weapon ID]` | — | Sell one weapon (permanent; not if equipped) |
| `crd sell [tier]` | — | Sell all unlocked, unequipped weapons of a tier (common/rare/mythic/legendary/supreme) |
| `crd sell all` | — | Sell all unlocked, unequipped weapons except Legendary/Supreme |
| `crd deity collection` | — | View owned deity collection (paginated) |
| `crd deity info [deity name]` | — | View deity info card |
| `crd deity equip [deity name]` | `crd de` | Set the active deity (its blessing applies in battle) |
| `crd deity enhance [deity name]` | — | Enhance a deity using tier essence |
| `crd weapon info [weapon ID]` | — | View weapon info card |
| `crd bestow @user [amount]` | — | Give Credux to another player |
| `crd cred` | `crd g` | View Credux + Belief Shards balance |
| `crd daily` | — | Claim daily attendance reward |
| `crd quest` | `crd quests` | View daily quests (Q1/Q2/Q3) and progress |
| `crd quest refresh [Q1\|Q2\|Q3]` | — | Reroll one quest line (2 refreshes/day, PHT) |
| `crd help` | — | View command categories |
| `crd coin toss [amount] h/t` | `crd ct` | Casino: Coin toss |
| `crd dice roll [amount] o/e` | `crd dr` | Casino: Dice roll |
| `crd baccarat [amount] b/p` | `crd bac` | Casino: Baccarat |
| `crd blackjack [amount]` | `crd bj` | Casino: Blackjack |
| `crd slot machine [amount]` | `crd sm` | Casino: Slot machine |
| `crd crash [amount]` | — | Casino: Crash |

### Admin Commands
*All `crd admin …` commands require the Discord **Manage Server** permission.*
| Command | Description |
|---|---|
| `crd admin setprefix [prefix]` | Change bot prefix for server |
| `crd admin setannouncementchannel [#channel]` | Set general bot announcement channel |
| `crd admin setbosschannel [#channel]` | Set boss spawn/death/escape announcement channel |
| `crd admin setbotchannel [#channel]` | Restrict commands to specific channel |
| `crd admin stats` | Show active players (last 7 days) |

### Dev Commands (Superuser Only — Hidden from help)
| Command | Description |
|---|---|
| `crd dev givecredux @user [amount]` | Give Credux — bypasses daily cap |
| `crd dev givebeliefshards @user [amount]` | Give Belief Shards |
| `crd dev givechest @user [type] [amount]` | Give chests |
| `crd dev giverelic @user [type] [amount]` | Give relics |
| `crd dev ban @user` | Ban player from bot |
| `crd dev unban @user` | Unban player |
| `crd dev resetplayer @user` | Full reset (logged with snapshot) |
| `crd dev enhanceweapon [weapon ID] [+level]` | Enhance weapon to level (no cost, globally unique ID) |
| `crd dev enhancedeity @user [deity name] [+level]` | Enhance deity to level (bypasses essence cost) |
| `crd dev battle [mob name] [seed n]` | Engine smoke test (no rewards) |
| `crd dev setbosshp [boss name] [hp]` | Set the live boss's HP (smoke test) |
| `crd dev spawnboss` | Force-spawn a boss (15-min cooldown bypassed; test boss takes multiple attacks) |
| `crd dev quest` | View own quests |
| `crd dev quest refresh [Q1\|Q2\|Q3]` | Reroll a quest line (2/day cap bypassed) |
| `crd dev daily @user` | Grant a daily claim (once-per-day attendance bypassed) |

---

## 27. COMMAND BEHAVIOR

### Per-Command Cooldowns <!-- [v4.8] was universal 10s -->
- `crd raid` → **25 seconds** (anti-spam)
- All casino games (coin toss, dice roll, baccarat, blackjack, slot machine, crash) → **25 seconds** (anti-spam)
- Everything else (bag, open, summon, weapon/deity info, equip, enhance, profile, cred, bestow, daily, quests, duel, …) → **10 seconds**
- Per-command windows (compound key per user); buttons are NOT cooldown-gated. Config: `src/config/cooldowns.js`.

## 28. PHASE 11 — HELP · ADMIN · CUSTOM PREFIX · SLASH COMMANDS  [v4.9]

**Custom prefix.** The bot accepts TWO triggers at once: `crd` (permanent, every server) and the
guild's `server_config.prefix` (when set and ≠ `crd`). `crd` always wins resolution, so `crd bag`
works even when the custom prefix is `c`. All `server_config` rows load once at startup into an
in-memory `guildConfigCache` (prefix + bot/announcement/boss channel ids); middleware reads prefix
and bot-channel from the cache (no per-command DB hit). `crd admin set*` UPSERTs `server_config`
AND updates the cache in the same code path (no stale reads).

**`crd admin` (Manage Server only; plain-text error otherwise).** `setprefix [1–5 alnum, not crd]`,
`setbotchannel`, `setannouncementchannel`, `setbosschannel` (UPSERT + cache), and read-only `stats`
(registered players / active in 7 days / avg combat level of active, from `user_guild_activity ⋈
user_character`).

**`crd help [category]`** — categorized embed (no Canvas); a 🛠️ Developer section is appended only
for `DEV_IDS`. Optional category filter: `account|battle|casino|gacha|inventory|economy|admin`.

**Aliases.** Single source of truth `src/config/aliases.js` (e.g. `ct → coin toss`, `b → bag`,
`sl`/`sm → slot machine`, `g → cred`); expanded to the canonical token stream before routing.

**Slash commands.** Every non-dev command has a `/slash` equivalent (`src/commands/slashDefinitions.js`);
dev commands do NOT. A `CommandContext` adapter (`src/utils/commandContext.js`) lets every handler
run unchanged on both the prefix and slash paths. Each slash command carries an **arg-assembler**
that rebuilds the exact canonical token array (incl. literal subcommand tokens like `toss`/`info`).
Slash flow: middleware first (rejections are ephemeral) → `deferReply` → same handler as prefix.
Bot-channel rejection on slash is ephemeral. Register with `node scripts/deploy-commands.js`
(`CLIENT_ID` + optional `GUILD_IDS` in `.env`). Static check: `node scripts/help-selftest.js`.

### Error Messages (Plain text only — no embed)
- *"You are not registered. Use `crd register` to get started."*
- *"You don't have a character yet. Use `crd create character` to get started."*
- *"Insufficient Credux."*
- *"You are on cooldown. Try again in X seconds."*
- *"You don't have enough Belief Shards."*
- *"You don't have enough chests."*
- *"You haven't summoned [deity name] yet."*
- *"You don't own a weapon with that ID."*

---

## 28. DATABASE STRUCTURE

NOTE: Enhancement stored as 1–11. Displayed to player as enhancement - 1 (+0 to +10). Default = 1 (no enhancement).

### `users` table
*Lean core account. Checked on every command for ban status.*
| Field | Notes |
|---|---|
| `discord_id` | PK — Discord snowflake |
| `username` | Display name at registration |
| `monthly_streak` | 0–30 (default 0; cycle position 1–30), resets each 30-day cycle |
| `overall_streak` | Lifetime consecutive days, never resets |
| `last_daily_claim_date` | DATE — PHT date of last `crd daily`; drives streak + dup-claim check (DB-6) |
| `last_bestow_received` | Date — for 1M/day cap enforcement |
| `bestow_received_today` | Running total today |
| `last_boss_attack_date` | DATE — global cross-server boss lock, one attack/day (DB-4) |
| `is_banned` | Boolean — checked on every command |
| `registered_at` | Timestamp |

### `users_bag` table
*All currencies, relics, and chests. Separate from users for query efficiency.*
| Field | Notes |
|---|---|
| `discord_id` | PK + FK → users |
| `credux` | Main currency |
| `belief_shards` | DEFAULT 0; granted 1,000 at character creation |
| `sacred_relics` | Count |
| `supreme_relics` | Count |
| `silver_chest` | DEFAULT 0; granted 10 at character creation |
| `gold_chest` | Count |
| `boss_treasure_chest` | Count |
| `boss_golden_chest` | Count |
| `supreme_chest` | Count |
| `epic_essence` | Duplicate Epic deity pulls convert here (GACHA-2) |
| `mythic_essence` | Duplicate Mythic (Awakened) pulls |
| `legendary_essence` | Duplicate Legendary (Undying) pulls |
| `supreme_essence` | Duplicate Supreme (Primordial) pulls |

### `user_character` table
*RPG character data. Created on `crd create character`.*
| Field | Notes |
|---|---|
| `discord_id` | PK + FK → users |
| `class` | Swordsman/Fighter/Mage/Knight/Archer |
| `combat_level` | 1–50 |
| `combat_exp` | EXP toward next combat level |
| `equipped_weapon_id` | FK → user_weapons (nullable) |
| `active_deity_id` | FK → user_deities (nullable) |
| `raids_won` | Total |
| `raids_lost` | Total |
| `pvp_wins` | Total |
| `pvp_losses` | Total |
| `believer_level` | Reputation level — unlimited |
| `believer_exp` | 3,000 flat per level |
| `reputation_exp_today` | Daily reputation EXP earned — 5,000/day cap (DB-7) |
| `reputation_exp_reset_date` | DATE — PHT anchor for the daily cap reset (DB-7) |
| `created_at` | Timestamp |

### `user_weapons` table
*Every player-owned weapon. One row per drop — never shared between players.*
| Field | Notes |
|---|---|
| `discord_id` | FK → users (owner) — listed first for query readability |
| `weapon_id` | PK — UUID 8-char, globally unique |
| `weapon_roster_id` | FK → weapon_roster (links to name, lore, passive) |
| `curr_atk` | floor(base_atk × weaponBoostTable[enhancement]) — updated on enhancement |
| `curr_hp` | floor(base_hp × weaponBoostTable[enhancement]) — updated on enhancement |
| `curr_def` | floor(base_def × weaponBoostTable[enhancement]) — updated on enhancement |
| `enhancement` | Stored 1–11, displayed as enhancement-1 (+0 to +10) |
| `base_atk` | Rolled on drop — static forever |
| `base_hp` | Rolled on drop — static forever |
| `base_def` | Rolled on drop — static forever |
| `crit` | Rolled on drop |
| `bonus_dmg_pct` | Legendary 25%-on-drop bonus roll: set to 25.00 with bonus_crit_dmg_pct, else NULL. Supreme always 50.00 (nullable) |
| `bonus_crit_dmg_pct` | Legendary 25%-on-drop bonus roll: set to 25.00 with bonus_dmg_pct, else NULL. Supreme always 50.00 (nullable) |
| `is_locked` | Boolean — `crd lock`/`crd unlock`; locked weapons are excluded from `crd sell` |
| `obtained_at` | Timestamp |

**Weapon Enhancement (boost-table lookup — the linear ×0.05 formula is REMOVED):**
```
curr_atk = floor(base_atk × weaponBoostTable[enhancement])   ← table is authoritative
Enhancement 1 (+0) = ×1.00  |  Enhancement 6  (+5)  = ×1.25
Enhancement 2 (+1) = ×1.05  |  Enhancement 7  (+6)  = ×1.32
Enhancement 3 (+2) = ×1.10  |  Enhancement 8  (+7)  = ×1.40
Enhancement 4 (+3) = ×1.15  |  Enhancement 9  (+8)  = ×1.50
Enhancement 5 (+4) = ×1.20  |  Enhancement 10 (+9)  = ×1.70
                              |  Enhancement 11 (+10) = ×2.00
```

### `user_deities` table
*Every player-owned deity. One row per unique deity per player.*
| Field | Notes |
|---|---|
| `user_deity_id` | PK (SERIAL) — target of user_character.active_deity_id |
| `discord_id` | FK → users (owner) |
| `deity_id` | FK → deity_roster (links to base stats, lore, blessing) |
| `curr_atk` | floor(deity base_atk × deityBoostTable[enhancement]) — uniform +10%/level |
| `curr_hp` | floor(deity base_hp × deityBoostTable[enhancement]) |
| `curr_def` | floor(deity base_def × deityBoostTable[enhancement]) |
| `enhancement` | Stored 1–11, displayed as enhancement-1 (+0 to +10) |
| `obtained_at` | First pull timestamp |
| `last_pull_date` | Most recent pull date for this specific deity |
| UNIQUE | `(discord_id, deity_id)` — one owned row per deity |

> `duplicate_count` is REMOVED. Owning a deity is binary; duplicate pulls convert to tier essence stored in `users_bag`: +1 essence for Epic/Mythic duplicates and +5 essence for Legendary/Supreme duplicates. Enhancement spends essence.

**Deity Enhancement Formula:**
```
curr_atk = floor(base_atk × (1 + (enhancement - 1) × 0.10))   // floor() per §35.2
Enhancement 1  (+0)  = ×1.00 (no boost)
Enhancement 2  (+1)  = ×1.10
Enhancement 6  (+5)  = ×1.50
Enhancement 11 (+10) = ×2.00 (100% boost — all stats doubled)
```

### `weapon_roster` table
*Static weapon reference data. Shared across all players. Insert rows to add new weapons.*
| Field | Notes |
|---|---|
| `weapon_roster_id` | PK — starts from 1 |
| `name` | e.g. "Freyr's Arrow" |
| `type` | Sword/Staff/Gloves/Shield/Bow |
| `tier` | Common/Rare/Mythic/Legendary/Supreme |
| `mythology` | PH/Norse/Greek/Common/etc. |
| `passive_key` | e.g. "freyrs_arrow" — battle engine reference |
| `passive_name` | "Auto-Fire" |
| `passive_description` | Full description shown in weapon info card |
| `lore` | Flavor/educational text (nullable) |
| `image_filename` | "freyrs_arrow.png" (nullable until asset ready) |
| `is_available` | Boolean — retire a weapon = set false (soft-delete; hidden from chest pool, never DELETE owned rows) |

### `deity_roster` table
*Static deity reference data. Shared across all players. Insert rows to add new mythologies.*
| Field | Notes |
|---|---|
| `deity_id` | PK — starts from 1 |
| `name` | e.g. "Bathala" |
| `mythology` | PH/Norse/Greek/etc. |
| `tier` | Epic/Mythic/Legendary/Supreme |
| `base_hp` | Fixed base stat |
| `base_atk` | Fixed base stat |
| `base_def` | Fixed base stat |
| `blessing_key` | e.g. "divine_vessel" — battle engine reference |
| `blessing_name` | "Divine Vessel" |
| `blessing_description` | Full description shown in deity info card |
| `lore` | Educational mythological description (nullable) |
| `image_filename` | "bathala.png" (nullable until asset ready) |
| `is_available` | Boolean — retire a deity = set false (soft-delete; hidden from gacha pool, never DELETE owned rows) |

### `mob_roster` table
*Static mob/elite/boss reference data. Insert rows to add new mythologies.*
| Field | Notes |
|---|---|
| `mob_id` | PK — starts from 1 |
| `name` | e.g. "Manananggal" |
| `mythology` | PH/Norse/Greek/etc. |
| `mob_type` | regular/elite/boss |
| `base_hp` | — |
| `base_atk` | — |
| `base_def` | — |
| `base_crit` | — |
| `hp_per_level` | Scaling per level (0 for non-scaling mobs) |
| `atk_per_level` | — |
| `def_per_level` | — |
| `skill_key` | e.g. "viscera_drain" — battle engine reference |
| `skill_name` | "Viscera Drain" |
| `skill_description` | Full description |
| `immunity_tags` | JSONB — e.g. ["stun","bleed"] for boss immunities |
| `special_flags` | JSONB — boss-only engine mechanics e.g. {"first_strike":true} / {"multi_attack":2,"multi_attack_pct":0.60} (BS-8) |

> Mobs intentionally have **no** `lore` / `image_filename` (grind fodder; battle embeds work without art).

### `pity_counters` table
*Gacha pity tracking. Backend only — never shown to players.*
| Field | Notes |
|---|---|
| `discord_id` | PK + FK → users |
| `pity_count` | Increments per roll, resets to 0 on ANY Legendary or Supreme pull (natural or forced); 500 = forced Legendary |

### `active_battles` table
*Live battle state. Deleted on battle completion.*
| Field | Notes |
|---|---|
| `battle_id` | PK — auto-increment |
| `discord_id` | FK → users — UNIQUE (one active battle per player) |
| `channel_id` | Discord channel |
| `message_id` | Discord message being edited |
| `battle_type` | raid / boss (duel removed — runs in-memory) |
| `mob_id` | FK → mob_roster |
| `enemy_level` | Computed on battle start |
| `player_hp` | Current |
| `player_max_hp` | — |
| `enemy_hp` | Current |
| `enemy_max_hp` | — |
| `current_turn` | ROUND counter — the only periodic clock (no per-attack counters, §35.1) |
| `player_goes_first` | Boolean — result of first attack roll |
| `active_debuffs` | JSONB — [{type, turns_remaining, value}] |
| `battle_log` | JSONB — per-turn log entries |
| `overcharge_pct` | Mage passive state |
| `bleed_stacks` | JSONB — Swordsman DOT state |
| `started_at` | Timestamp |

### `boss_state` table
*One active boss per server at a time.*
| Field | Notes |
|---|---|
| `guild_id` | PK — Discord server ID |
| `spawn_id` | UUID — new per spawn; scopes boss_attack_log (DB-5) |
| `mob_id` | FK → mob_roster |
| `boss_level` | Server avg level + random(1–10) |
| `max_hp` | Computed on spawn |
| `current_hp` | Shared pool — all players chip this |
| `scaled_atk` | Post-scaling snapshot: base + per_level × boss_level (DB-9) |
| `scaled_def` | Post-scaling snapshot (DB-9) |
| `spawn_at` | Timestamp |
| `expires_at` | spawn_at + 1 hour |
| `status` | active / dead / escaped |

NOTE: Boss announcement channel now in `server_config.boss_announcement_channel_id`

### `boss_attack_log` table
*Per-player participation tracking per spawn. Prevents multi-attack; identifies participants for reward payout on kill.*
| Field | Notes |
|---|---|
| `id` | PK |
| `boss_spawn_id` | UUID — scopes a single spawn (= boss_state.spawn_id at attack time) (DB-5) |
| `guild_id` | No FK — history preserved across respawns |
| `discord_id` | FK → users |
| `mob_id` | Boss snapshot |
| `total_damage` | Cumulative this spawn (kept for stats; **no top-damage reward**) |
| `attacked_at` | First attack timestamp |
| `last_daily_reset` | Date — global daily lock reference |
| UNIQUE | `(boss_spawn_id, discord_id)` — one attacker row per spawn |

### `daily_quests` table
*3 active quests per player per day. Reset at midnight PHT.*
| Field | Notes |
|---|---|
| `id` | PK |
| `discord_id` | FK → users |
| `quest_type` | raid_wins / elite_defeats / credux_spent / weapon_enhancements / duel_wins / duel_challenges |
| `target_count` | Randomized within range on rollover |
| `current_count` | Progress |
| `reward_credux` | — |
| `reward_belief_shards` | — |
| `completed` | Boolean |
| `quest_date` | PHT date |
| UNIQUE | `(discord_id, quest_type, quest_date)` — no duplicate types per day |

### `server_config` table
*Per-server admin settings.*
| Field | Notes |
|---|---|
| `guild_id` | PK |
| `prefix` | Default: 'crd' |
| `announcement_channel_id` | General bot automatic announcements |
| `boss_announcement_channel_id` | Boss spawn/death/escape announcements specifically |
| `bot_channel_id` | Restrict commands to this channel (nullable) |
| `configured_at` | Timestamp |

### `user_guild_activity` table (DB-13)
*Per-(user, guild) activity. Powers server-average boss level + admin active-player stats. Upserted by middleware on every command.*
| Field | Notes |
|---|---|
| `discord_id` | FK → users — part of composite PK |
| `guild_id` | Part of composite PK |
| `last_active` | Timestamp of last command in this guild; PK = `(discord_id, guild_id)` |

> Boss level = AVG(`combat_level`) of users active in the guild within 7 days (inner-join `user_character`, so character-less accounts are excluded). If no active players → skip the spawn.

### `raid_logs` table (immutable)
*All PvE battle results.*
| Field | Notes |
|---|---|
| `id` | PK — BIGSERIAL |
| `discord_id` | No FK — preserved if player deleted |
| `battle_type` | raid (more types future) |
| `enemy_name` | — |
| `enemy_tier` | regular / elite / boss |
| `result` | win / loss |
| `exp_earned` | — |
| `updated_exp` | New total combat_exp after battle |
| `belief_shards_dropped` | — |
| `updated_belief_shards` | New total after drop |
| `credux_earned` | — |
| `updated_credux` | New total after earn |
| `chest_dropped` | "Silver Chest" / "Gold Chest" / null |
| `timestamp` | — |

### `pvp_logs` table (immutable)
*All PvP duel results.*
| Field | Notes |
|---|---|
| `id` | PK — BIGSERIAL |
| `challenger_id` | Discord ID |
| `opponent_id` | Discord ID |
| `winner_id` | Discord ID |
| `challenger_damage` | Total dealt |
| `opponent_damage` | Total dealt |
| `timestamp` | — |

### `game_logs` table (immutable)
*Economy audit trail. All non-combat currency movements. Dev/backtracking reference.*
| Field | Notes |
|---|---|
| `id` | PK — BIGSERIAL |
| `discord_id` | No FK — preserved if player deleted |
| `action` | Bestow / Enhance / Daily / Deity Pull / Deity Enhance / Silver Chest / Gold Chest / Boss Treasure Chest / Boss Golden Chest / Supreme Chest / Sacred Relic / Supreme Relic / Sell Weapon |
| `item_type` | nullable — which chest/relic/essence tier (or sold weapon tier) moved; disambiguates Daily (DB-12) |
| `previous_credux` | nullable |
| `updated_credux` | nullable |
| `previous_belief_shards` | nullable |
| `updated_belief_shards` | nullable |
| `previous_chest_count` | nullable — default null |
| `updated_chest_count` | nullable — default null |
| `previous_relic_count` | nullable — default null |
| `updated_relic_count` | nullable — default null |
| `previous_essence_count` | nullable — essence gained (pull) / spent (deity enhance) (GACHA-2) |
| `updated_essence_count` | nullable |
| `timestamp` | — |

**Action → Non-null columns:**
| Action | Credux | Belief Shards | Chest | Relic | Essence |
|---|---|---|---|---|---|
| Bestow | ✅ | null | null | null | null |
| Enhance | ✅ | null | null | null | null |
| Daily | ✅ | ✅ | ✅ (item_type) | null | null |
| Deity Pull | null | ✅ | null | null | ✅ (on dupe) |
| Deity Enhance | null | null | null | null | ✅ |
| [Any] Chest | null | null | ✅ (item_type) | null | null |
| Sacred / Supreme Relic | null | null | null | ✅ (item_type) | null |
| Sell Weapon | ✅ | null | null | null | null (item_type = sold tier or "all") |

### `casino_logs` table (immutable)
*All casino activity.*
| Field | Notes |
|---|---|
| `id` | PK — BIGSERIAL |
| `discord_id` | — |
| `game` | coin_toss / dice_roll / baccarat / blackjack / slot_machine / crash |
| `bet_amount` | Credux wagered |
| `result` | win / loss |
| `payout` | Credux won or lost |
| `balance_before` | Credux before game |
| `balance_after` | Credux after game |
| `metadata` | JSONB — game-specific data (crash multiplier, card hands, etc.) |
| `timestamp` | — |

### `dev_logs` table (immutable)
*All developer actions.*
| Field | Notes |
|---|---|
| `id` | PK — BIGSERIAL |
| `dev_id` | Discord ID |
| `action_type` | give_credux / give_beliefshards / give_chest / give_relic / ban / unban / reset / enhance_weapon / enhance_deity |
| `target_discord_id` | Affected player |
| `amount_or_detail` | Amount, item, or level detail |
| `pre_reset_snapshot` | JSONB full state snapshot (reset action only) |
| `timestamp` | — |

---

## 29. ASSET STORAGE

### Storage Method
- Folder-based on bot server — database stores filename only
- Canvas fetches from folder path at render time

### Folder Structure
```
/assets
  /deities      → bathala.png, odin.png, athena.png, ...   [v4.2: migrated .jpg → .png]
  /weapons      → freyrs_arrow.png, glacial_bow.png, ...
  /items        → bag.png, belief_shards.png, combat_exp.png,
                  general_chest.png, general_essence.png, general_relic.png, ...
  /quest icons  → quest_icon.png, quest_raid.png, quest_spend.png,
                  quest_enhance.png, quest_duel.png, attendance.png
```

### Asset Status
| Asset | Description | Status |
|---|---|---|
| silver_chest.png | Silver chest design | ✅ Ready |
| gold_chest.png | Gold chest with ornate trim | ✅ Ready |
| boss_treasure_chest.png | Dark purple skull chest | ✅ Ready |
| boss_golden_chest.png | Skull with gold crown | ✅ Ready |
| supreme_chest.png | Crystal diamond chest | ✅ Ready |
| sacred_relic.png | Aged ochre ancient tablet | ✅ Ready |
| supreme_relic.png | Fractured divine shard (rainbow) | ✅ Ready |
| credux_coin.png | Gold coin with ornate border/flame | ✅ Ready |
| combat_exp.png | Combat EXP icon (raid + boss reward strips) | ✅ Ready |
| belief_shards.png · bag.png | Bot-unique bag/currency icons | ✅ Ready |
| general_chest/essence/relic.png | Bot-unique generic bag icons | ✅ Ready |
| quest icons (raid/spend/enhance/duel + attendance) | Per-type quest + daily-attendance art | ✅ Ready |
| Deity gacha card flip frames | 4 tier color variants × card states | ✅ Ready |
| Chest opening animation frames | 4 frames × 5 tiers = 20 PNGs | ✅ Ready |
| Relic opening animation frames | Sacred: 3 frames · Supreme: 3 frames | ✅ Ready |
| Class art assets | Character creation thumbnails | ✅ Ready |
| Deity art assets | Deity collection cards | ✅ Ready |

### Animation Method
- All animations: edit-based (message.edit() with setTimeout between frames)
- Pre-made PNG frames swapped per edit — static PNGs only (no CSS/JS)
- Supreme Chest and Supreme Relic: rapid hue-rotated PNG swaps for rainbow shimmer
- Hosting: bot server local folder (start) → Cloudflare R2 (scale)

---

## 30. TECH STACK

| Component | Technology |
|---|---|
| Bot Framework | discord.js (Node.js) |
| Database | PostgreSQL |
| CDN | Discord CDN (start) → Cloudflare R2 (scale) |
| Image Generation | node-canvas (pure Canvas) |
| UUID Generation | Node.js crypto.randomUUID() (weapon IDs) |
| Monetization | Tebex (post-launch) |
| Timezone | PHT (UTC+8) for all daily/quest resets |

---

## 31. SERVER BOSS & WORLD BOSS

### Server Boss
- All participants on defeat: 20,000 EXP + 100,000 Credux + 1 Boss Treasure Chest
- Participation reward: 1,000 Belief Shards (= 10 rolls)
- No top-damage reward — every participant who attacked this spawn gets the same rewards on kill.

### World Boss (Shelved at Launch)
- All participants: 1,000,000 EXP + 1,000,000 Credux
- 1st Place: 15,000,000 Credux + 1 Supreme Chest + 1 Supreme Relic
- 2nd–3rd Place: 10,000,000 Credux + 1 Supreme Chest
- 4th–5th Place: 10,000,000 Credux + 3 Boss Golden Chests + 10 Sacred Relics
- 6th–7th Place: 5,000,000 Credux + 2 Boss Golden Chests + 10 Sacred Relics
- 8th–10th Place: 5,000,000 Credux + 1 Boss Golden Chest + 10 Sacred Relics

---

## 32. FUTURE MYTHOLOGY ROADMAP

| Release | Mythology |
|---|---|
| Release 1 (Initial) | PH Myths, Norse Myths, Greek Myths |
| Release 2 | Egyptian |
| Release 3 | Japanese |
| Release 4 | Hindu |
| Release 5 | Aztec |
| Release 6 | Celtic |

Each new mythology includes: new deity roster (all tiers), new regular and elite mobs, new boss lineup, new legendary weapons.

---

## 33. FUTURE CONTENT (POST-LAUNCH)

- Skill system — upgrades PvP to turn-based with input buttons, 10–15s timer
- MP reintroduction with class skill system
- World Boss (reward structure defined, mechanics pending)
- Element system (removed for launch — planned end-game update)
- Leaderboard system
- Guild/Clan system
- Achievement system
- Patron rewards (Tebex monetization)
- Class art assets
- Deity art assets

---

## 34. PENDING ITEMS

**Resolved in v4 (no longer pending):** Norse Legendary blessings (Freya/Loki/Tyr/Skadi/Surt) — now defined in §10; Greek Mythical deities (Apollo/Artemis/Hephaestus/Aphrodite) — defined in §10; **Hermes — REMOVED from the roster entirely**; Casino specs, weapon enhancement curve, deity enhancement model, essence system, starter weapon, battle turn/crit/drain rules — all defined in §35.

**Still pending (post-launch / later phases — non-blocking):**
- [ ] Class skills and MP reintroduction
- [ ] Boss Phase 2 skills (after initial release data)
- [ ] Element system (end-game update)
- [ ] World Boss full mechanics
- [ ] Egyptian, Japanese, Hindu, Aztec, Celtic mythology rosters

---

## 35. PASSIVE REGISTRY & BACKEND CONSTANTS (v4 — AUTHORITATIVE)

*Where any earlier section conflicts with §35, §35 wins. This section is the implementation contract for the battle engine, the passive registry, and all backend config files.*

### 35.0 v4 Resolution Summary
- Weapon enhancement uses the **boost table** (non-linear, ×2.00 at +10); the linear ×0.05 formula is removed.
- Deity enhancement is **uniform +10%/level**; no dominant/non-dominant stat.
- Duplicates → **tier essence** (+1 Epic/Mythic; +5 Legendary/Supreme); no per-deity duplicate counter.
- Starter weapon = real roster row **Initiate's Blade**; creation grants **1,000 shards + 10 silver chests** (once, at creation).
- Pity resets on **any** Legendary or Supreme pull.
- Duels run **in-memory**; raids/bosses persist in `active_battles`.
- Daily streak = fixed **30-day rolling cycle**.
- Hermes removed; 5 Norse Legendary blessings defined (§10);

### 35.1 Battle Timing — one round-based clock
- **Round (= "turn")** = both combatants have acted once. `active_battles.current_turn` is the ROUND counter and is the **only** periodic clock. There is **no** per-attack counter (the old `player_attack_count` / `enemy_attack_count` columns are removed).
- **All periodic triggers are round-based.** *"every turn" / "every N turns" / "every Nth turn" / "every even turn"* are evaluated on `current_turn` — e.g. "every 3rd turn" = `round % 3 === 0`; "every even turn" = `round % 2 === 0` (rounds 2/4/6…). Any legacy "every Nth attack" wording reads as "every Nth turn."
- **First-action effects** ("first hit / first attack / first N hits taken each battle") use a one-shot flag or a tiny hits-taken tally, **not** a periodic counter. "First hit" = the actor's first action of the battle; "first 2 hits received" = the first two incoming hits regardless of round.
- **Stacking buffs are all per-turn:** "+X% every turn, stacking up to Y%." Legacy "each hit / each consecutive hit" wording means the same thing.
- **Bonus / extra hits** (Labrys 2nd hit, Mjolnir crush, Loki counter, Cerberus double attack, "take another turn") are damage **riders** on the triggering action. They never advance the round counter and never re-fire periodic effects.

**Durations (uniform — keeps the engine simple):**
- **CC + stat debuffs** (`stun`, `paralyze`, `freeze`, `petrify`, `charm`, `confuse`, `miss`, `atk_down`, `def_down`, `crit_down`) last **exactly 1 turn** — they expire after the afflicted actor's next turn. A skip-CC makes the afflicted actor miss its single next action.
- **Skip-CC turn order** ([Jun-2026 §2] — deadlock fix): a procced skip-CC (`stun`/`freeze`/`paralyze`/`petrify`/`charm`/`confuse`) is **directional** (attacker → defender) and only gates the recipient's **NEXT** turn — it can never cancel an action already due this round, and never re-locks the actor itself. The first-attack-roll winner lands the first CC but the loser still takes its own first action (it is not pre-stunned). Two opposing CC passives (e.g. Thor stun vs Skadi freeze) therefore can no longer deadlock a round into "neither can act." Engine: a CC applied during a round is *unarmed*; the round-start arming pass flips CC carried in from a previous round to *armed*, and only an armed CC gates an action.
- **Damage-over-time** (`bleed`, `burn`, HP%-DOTs) ticks for **2 turns** (two ticks); a new application **refreshes** (does not stack) — highest-value source wins per §13.1.
- **Timed self-buff windows** written "for the first N turns" / "for N turns" on a self-buff (Battersea "DEF +25% for first 2 turns", Freya "ATK +15% for 2 turns") apply for those rounds as authored — they are not debuffs and are unaffected by the 1-turn rule.
- **Bathala Divine Vessel** ([Supporter-stage §9]) is a *ramping* self-buff: at the start of each turn (step 1 of the turn sequence, before attacking) it adds +20% **ATK/DEF only**, stacking additively to a +100% cap (5 stacks; reached on turn 5, held thereafter). **No HP component** (removed in the Supporter-stage rework — was +15% ATK/DEF/HP to +105%/7-stack). Not a debuff; never cleansed off Bathala, unaffected by the 1-turn rule. The engine's `bathala_hp_fraction` ramp is left inert (default 0).

### 35.2 Stat Aggregation & CRIT
- **Additive:** Total ATK/HP/DEF = class(level) + equipped weapon `curr` + **active** deity `curr`.
- **CRIT:** total = class crit + weapon crit. Class crit caps at **40%**; total hard ceiling **45%**. Deities grant no crit.
- **Crit multiplier ×2.0** for players and enemies. Enemy authored crit (≤30%) is uncapped.
- **[v4.4] ONE unified damage-% rule** (see `src/config/combat.js`). There is **no separate crit-damage stat** — every damage bonus is a single `damage %` that stacks **additively** and applies to **both** crit and non-crit:
  - `hitMultiplier = (crit ? 2.0 : 1.0) + Σ(damage %)/100`
  - `damage %` sums the weapon's `bonus_dmg_pct` + any procced source (Katana **+30%**; a future deity blessing's damage % applies only while it procs).
  - **Supreme** (50%): ×1.5 normal / **×2.5 crit**. **Legendary** (25%): ×1.25 / ×2.25. Katana (+30%): ×1.3 / ×2.3.
  - **Stacking, only while procced:** Supreme 50% **+ deity 50%** → ×2.0 normal / **×3.0 crit**. When the deity isn't procced it's just Supreme (×1.5 / ×2.5).
  - **Double damage** (Idiyanale) is a **guaranteed crit-level hit** that **takes the damage % rider**: ×(2.0 + damage%/100). Plain → ×2.0; Supreme 50% + double → **×2.5**; Supreme + deity 50% + double → ×3.0.
  - **Overcharge** (Mage, every 3rd round): fixed **×2.5** ([v4.4], was ×3), cannot crit, no rider — its own lane. A mob "X% ATK" nuke is a clean ×(pct) and does not also crit.
  - `bonus_crit_dmg_pct` (DB column) is **deprecated/unused** — left null on new drops; existing rows are ignored by the engine.
- **Rounding:** `floor()` everywhere curr stats are computed.

### 35.3 Battle Termination
- **Death check** runs after each attack's full damage (post-crit) and after each DOT tick; first to 0 ends the battle.
- **Sudden-death drain:** from **round 30**, both combatants lose **10% max HP** at the end of every round.
- **Hard cap round 50:** raid/duel → higher remaining HP% wins (tie → mob/challenged); boss → "timeout, survived" (damage already committed; daily lock still applies).

### 35.4 Effect Tag Vocabulary (immunities)
Canonical tags: `stun`, `paralyze`, `freeze`, `petrify`, `charm`, `confuse`, `miss`, `bleed`, `burn`, `atk_down`, `def_down`, `crit_down`, `armor_pierce`, `hp_pct_dot`. Pseudo-tag `all_debuffs` = every tag above.
- Engine rule: **all bosses are auto-immune to `hp_pct_dot`** (no need to list it).
- Per-boss `immunity_tags`: Berberoka `[def_down]` · Bungisngis `[stun]` · Anggitay `[all_debuffs]` · Dalaketnon `[armor_pierce]` · Jotun `[def_down]` · Fenrir `[bleed,stun]` · Fafnir `[armor_pierce]` · Sleipnir `[stun]` · Cerberus `[stun]` · Hydra `[def_down]` · Medusa `[all_debuffs]`.
- `special_flags` (boss only, engine-handled, not registry): `first_strike` (Sleipnir — first action of the battle only), `multi_attack`/`multi_attack_pct` (Cerberus = 2 × 60% ATK).
- **`def_down` vs `armor_pierce`:** "reduce/lower enemy DEF by X%" = a `def_down` debuff (1-turn, blocked by def_down-immune bosses). "ignore/pierce X% of enemy DEF" = `armor_pierce` (per-hit mitigation skip, blocked by armor_pierce-immune bosses). Full per-effect tag map lives with the seed list.
- **Enemy-HP conditions** ("when enemy HP < X%") read the **live current HP%** of the enemy — for a boss this is the **shared pool** %, so such effects trigger only once the server pool is already low.
- **Player-side immunity / cleanse:** the engine supports a player `status_immune` flag (Alan's Reversed Hands = immune to all debuffs) and player-targeted cleanses (Babaylan every turn, Caduceus every 3rd turn, Baldur once/battle) that clear entries from the player's `active_debuffs`. Enemy `immunity_tags` are unaffected.

### 35.5 Passive Registry — construction rule
The registry is one flat object keyed by `passive_key` / `blessing_key` / `skill_key`. **Every roster row's key must have a function implementing that row's `*_description` column, interpreted per §35.1–35.4.** Rules:
- `"none"` → shared no-op (used by basic weapons and immunity-only bosses).
- Only the **active** deity's blessing fires per turn.
- `immunity_tags` and `special_flags` are checked by the engine, not the registry.
- **Key naming:** lowercase snake_case, globally unique, ≤50 chars. Recommended: weapons `<weapon_slug>`; deity blessings `<deity_slug>_<blessing_slug>`; mob skills `<mob_slug>_<skill_slug>`. (See Roster & Asset Conventions.)

**New / changed effects defined in v4** (must be added to the registry):

| Key | Owner | Behavior (v4-final) |
|---|---|---|
| `none` | shared | No-op |
| `freya_valkyries_embrace` | Freya (Leg) | Once/battle at ≤40% HP: heal +20% max HP, ATK +15% for 2 turns |
| `loki_illusory_double` | Loki (Leg) | 20%/turn: evade an attack and counter for 50% ATK (rider — advances no counter) |
| `tyr_oathkeeper` | Tyr (Leg) | DEF +20% all battle; while HP<50%, reflect 15% of incoming |
| `skadi_winters_hunt` | Skadi (Leg) | Every 3rd turn: +40% ATK and apply `freeze` (1-turn skip) |
| `surt_muspells_flame` | Surt (Leg) | Every attack applies `burn` (25% ATK, 2 ticks); +50% vs already-burning |
| `habagat_monsoon_fury` | Habagat (Epic) | Every turn, 25% chance: storm strike for +50% ATK bonus damage |
| `baldur_invulnerability` | Baldur (Myth) | Once/battle, the first turn Baldur is debuffed or below 50% HP: cleanse all debuffs + heal 10% max HP |
| `hydra_regen` | Hydra (boss) | Every 3rd turn, regen 1% max HP **on the player's local instance only**; only NET damage commits to the shared pool (the shared pool is never healed)  [Jun-2026 §4: was 5%] |
| `stone_stare` | Medusa (boss) | Every 3rd turn: petrify player 1 turn, then reset the counter (no stacking) |

Worked example:
```javascript
"skadi_winters_hunt": (bs) => {
  if (bs.currentTurn % 3 === 0) {                 // round-based, one clock
    bs.bonusDamage += bs.playerATK * 0.40;
    if (!bs.enemyImmune("freeze")) bs.applyDebuff("freeze", 1);  // 1-turn CC
  }
},
"none": () => {}
```

### 35.6 Backend Constants

**Weapon boost table** (`enhancement.js`): 1→×1.00, 2→×1.05, 3→×1.10, 4→×1.15, 5→×1.20, 6→×1.25, 7→×1.32, 8→×1.40, 9→×1.50, 10→×1.70, 11→×2.00. (Weapon Credux cost + success-rate tables unchanged — see §7.)

**Deity boost table** (`deityEnhancement.js`): linear +10%/level, 1→×1.00 … 11→×2.00. **Essence cost per level by tier:** see §9 table (now spent as the deity's own tier essence).

**Reputation** (`believerExpTable.js`): 3,000 EXP flat per believer level; **daily cap 5,000** reputation EXP (tracked in `user_character.reputation_exp_today`, reset midnight PHT). Per-source values per §18.

**Quest reward buckets** (`questPool.js`): Raid wins 3–5→(3k,5)/6–8→(6k,10)/9–10→(10k,15) · Elite defeats 2–3→(5k,8)/4–5→(10k,15) · Credux spent 5k–20k→(4k,5)/21k–50k→(9k,12) · Weapon enhancements 2–3→(4k,5)/4–5→(8k,10) · Duel wins 1→(5k,8)/2–3→(12k,18) · Duel challenges 2–3→(3k,5)/4–5→(6k,10). Rewards auto-credit on completion. Duel quests count **accepted duels vs distinct opponents** only.

**Weapon stat banding** (`dropRates.js`): roll each stat within the tier range, positioned by the type's qualitative profile (§7): Lowest→bottom 20% · Low→bottom 40% · Balanced→middle 40–60% · High→top 40% · Highest→top 20%. CRIT banded the same way (Bows top of 1–5%). Supreme = fixed stats (always +50% damage, CRIT 0). Legendary = 25% chance on drop to roll +25% damage (`bonus_dmg_pct`, fixed); otherwise none. Rare/Mythic = no bonus rider. [v4.4] `bonus_crit_dmg_pct` is deprecated (left null) — the unified §35.2 damage % replaces it.

**Mob scaling** (seed in `mob_roster`): [Jun-2026 rebalance] regular = HP+80 / ATK+65 / DEF+20 per level; elite = HP+90 / ATK+75 / DEF+25; base stats also raised (regular ~2,000–2,230 HP / ~365–382 ATK, elite ~2,550–3,050 HP / ~418–450 ATK). Boss = authored per row (base ~62k–68k HP; per-level HP ~+290–400 / ATK ~+72–82 / DEF ~+25–33). Mob level = player level + random(−2..+15), clamped **[1, 55]**. Stats are read live from `mob_roster` at battle time — no code constants.

**Casino** (`casino.js`): coin toss & dice 1.95× · baccarat player 2× / banker 1.95× (5% commission) · blackjack 6-deck, dealer stands 17, BJ pays 3:2 · slots ~90% RTP · crash ~3% edge. **Min bet 1, max bet 150,000.** Bet > balance → "Insufficient Credux."; bet ≤ 0 → invalid.

**Starter** (`starter.js`): Initiate's Blade (Sword/Common, ATK 15 / HP 30 / DEF 12 / CRIT 1%, passive `none`); creation grant 1,000 Belief Shards + 10 Silver Chests.

### 35.7 Asset Paths (engine path constants)
`/assets/{deities,weapons,classes,essence}/<slug>.png` · `/assets/items/{credux_coin,sacred_relic,supreme_relic}.png` + `/items/chests/<chest>.png` · `/assets/animations/gacha/{card_back,card_flip_a,card_flip_b,card_<tier>}.png` · `/assets/animations/chests/<chest>_<1..4>_<idle|shake|crack|burst>.png` · `/assets/animations/relics/{sacred,supreme}_<1..3>.png`. DB stores filename only for roster art; animation/static names are code constants. (Full tree in Roster & Asset Conventions.)

---

# §40 — Supporter Shop & Skin System (Supporter-stage, first stage)

**Cosmetic-only.** Nothing in this system grants credux, items, EXP, or any combat advantage — skins
swap *rendered art only*; combat always reads the underlying item/stat. Schema is human-applied
(`supporters`, `supporter_token_ledger`, `cosmetic_catalog`, `user_cosmetics`, `equipped_skins`,
`stripe_events`); code reads/writes rows only, never DDL.

### Tiers & tokens (§3)
- Tiers: **Believer**, **Chosen** (subscriptions) and **Eternal** (founder, one-time). Active =
  `supporters.status='active'` and not past `current_period_end`/`chosen_expires_at`.
- Token stipend: Believer **1/mo**, Chosen **3/mo**, Eternal **one-time 18** at purchase (= 6× the
  3-month window). Constants in `src/config/cosmetics.js` (`MONTHLY_TOKENS`, `ETERNAL_ONE_TIME_TOKENS`).
- `grantTokens`/`spendTokens` (`src/engine/supporterTokens.js`) are atomic (ledger row + balance in one
  tx; spend locks the row `FOR UPDATE`, never goes negative). Tokens are **never** written to
  `users_bag`/credux and no function reads both — fully isolated ledgers.
- Stripe `invoice.paid`/founder webhook is the intended grant trigger but **has no host in this bot**
  (no `stripe` dep / HTTP server). The entitlement layer is exposed as callable functions
  (`applySubscribe`, `applyMonthlyTokens`) + idempotency guard (`markStripeEventOnce`); `crd dev sub
  [@user] <tier>` simulates a grant until the webhook is stood up.

### Catalog & seeder (§1/§2)
- `cosmetic_catalog` is populated by `scripts/seedCosmetics.js` (idempotent; deactivates rows whose
  files vanish). It parses real filenames **by position** (first token = tier `b/c/e`; last token =
  `<category-letter><increment>`, `p/b/r/s`; battle_result carries a `victory|defeated` token before
  `r<N>`). `*_filename` columns store paths **relative to `assets/skins/`** (forward-slash).
- Cost by tier: Believer **2**, Chosen **3**, Eternal **4** tokens (`TOKEN_COSTS`). Base set is free
  (`is_base=true`, nominal tier `believer`, always available regardless of tier gate).
- Categories: `profile`, `battle`, `battle_result`, `summon`. As seeded: 23 rows (4 base + 19 store).

### Shop (`crd shop`, §5)
- Active supporters only (others get a "subscribe to unlock" notice). Public, **owner-gated** message
  (bag convention): category dropdown → skin dropdown (preview image + tier + cost + owned/equipped) →
  Buy / Equip buttons. Buy = `spendTokens` + `user_cosmetics` insert (atomic). Equip sets
  `equipped_skins` (clears `override_path`). **Tier gate:** buy/equip your tier and below.

### Render precedence (§6/§7) — `src/engine/skinResolver.js`
`override_path` (dev/tester/custom) → equipped `cosmetic_id` → base (active supporter) → testers/
default set (`BETA_MODE`) → free-player default (renderer's built-in art). Every resolved frame is
normalized to the locked **1536×1024**. Integrated live in **profile** (frame + top-label word) and
**summon** (equipped `.webp` plays as the flip, then the deity reveals). Profile top-label: dev
accounts → `Founder 000`; founders → `Founder NNN`; else the tier name.
**Battle-result** skins (victory/defeated + central reward panel) are seeded and verified by the
preview harness but **not yet wired into the live battle final-frame** — that compositing needs the
per-skin reward-zone tuning the harness drives (the reserved space is the art's central panel, not a
bottom strip). `crd dev use …` (§8) + `scripts/skinPreview.js` (§10, writes `tmp/skin_preview/`) cover
testing; `DEV_ACCOUNT_IDS` defaults to `DEV_IDS`.

### Skin codes, commands & preview (addendum 2 & 3)
- **`skin_code`** (DB column, human-applied; seeder fills it): the trailing filename token —
  `p1`/`b2`/`r3`/`s2`. Globally unique; **category is inferred from the leading letter**, so no
  category arg is ever needed. All skin commands resolve by this code.
- **Emoji map:** `skins.txt` at repo root maps `code=<:emoji:id>` plus `token`/`skins` icons
  (`src/engine/skinEmojis.js`). If the file is absent or a code is missing → neutral per-category
  fallback, logged once.
- **Commands:**
  - `crd shop` — paginated deity-collection-style skin shop (one category per page; ◀ ▶ + Preview),
    supporter-gated. `crd dev supporter shop` = same view, gates bypassed, `DEV MODE` marker.
  - `crd buy <code>` — supporters only; tier gate + token spend + ownership grant (atomic).
    `crd dev buy <code>` — free grant, gates bypassed.
  - `crd use skin <code>` — user-facing equip (category from the leading letter); dev/raw-file
    overrides stay under `crd dev use …`.
  - `crd skin collection` — open to everyone; paginated, 🔒 for unowned, ✅/「Equipped」 per category,
    token balance.
  - `crd dev givetoken @user <amount>` — grant tokens for shop testing.
- **Dev accounts own everything** (`DEV_ACCOUNT_IDS`): the ownership resolver returns owned=true for
  all active catalog skins (no DB rows); dev buys are free.
- **Preview** (addendum 3): a Preview button (reusing the drop-rates `HELP_ICON`) on shop + collection
  opens an image carousel — header = name + `code`, help line (buy/equip), the skin PNG via media
  gallery, ◀ Prev / Next ▶ / ↩ Back; battle_result skins add a Victory⇄Defeated toggle.

### Summon timing (§11)
Flip animation plays **4 seconds** before revealing gacha results.

---

*End of Credd Master Export File v4*
*Companion technical docs: CREDD_Technical_Blueprint_v4 + credd_schema_v4.sql + CREDD_Roster_and_Asset_Conventions*
*This file is the single source of truth — all previous files superseded*
*Upload this file at the start of every new thread to restore full context*
