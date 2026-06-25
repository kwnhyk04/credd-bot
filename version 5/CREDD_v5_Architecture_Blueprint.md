# CREDD v5 — MASTER ARCHITECTURE BLUEPRINT (phased implementation)

# Drop this in the project folder for Claude Code. Implement TOP-TO-BOTTOM, phase by phase.

# Each phase is self-contained: ship + test before starting the next.

# Companion files:

# - credd_schema_v5_migration.sql (Phase 0 — already written; gear split + scaffolding)

# - credd_schema_v5b_runes_seasons.sql (Phase 2+ — runes values, rune shop, season/title tables)

# - CREDD_v5_Gear_Overhaul.md (armor/weapon rosters + stat banding)

# - CREDD_v5_Stat_Assembly.md (final-stat pipeline)

# - credd_v5_new_armor_passives.js (8 new armor passive functions)

# - CREDD_v5_Naming_Conventions.md (slugs/keys/paths/JSONB shapes — READ FIRST)

#

# GLOBAL RULE: nothing here changes §35.1 timing (one round clock). All "every Nth turn" = bs.turn % N.

# GLOBAL GATE: the POWER-BUDGET RETUNE (Phase 6) must precede public launch of Phases 1–4.

=======================================================================
PHASE 0 — SCHEMA MIGRATION (prerequisite, already authored)
=======================================================================
Run credd_schema_v5_migration.sql. It:

- drops weapon HP/DEF, tightens weapon type CHECK to (Sword,Staff,Gloves,Bow), adds weapon sockets
- creates armor_roster + user_armors + user_character.equipped_armor_id
- scaffolds rune_roster + user_runes
- (optional §4) pantheon slots, pvp_rating, boss_kills, lifetime_credux_earned, blessing_scaling
- migrates/retires shields, seeds the 24-row armor_roster
  Verify: armor_roster has 24 rows; user_weapons has no HP/DEF; weapon type CHECK rejects 'Shield'.

=======================================================================
PHASE 1 — ARMOR SYSTEM (PRIORITY — build first)
=======================================================================
Goal: armor is a real, equippable, droppable, enhanceable second gear slot.

1.1 Stat assembly

- Implement the pipeline in CREDD_v5_Stat_Assembly.md exactly: class+level → weapon(ATK/CRIT)
  → armor(HP/DEF) → runes (skip until Phase 2; treat sockets as empty) → combine → pantheon (skip
  until Phase 3). NULL slots = zero contribution, never an error.
- Replace every "class+level+weapon" stat call in combat, profile, and duel with the new pipeline.

  1.2 Drop generation (COMBINED CHEST — weapon OR armor from the SAME existing chests)

- NO separate armor chest. Existing chests (Silver/Gold/Boss Treasure/Boss Golden/Supreme) now drop
  weapon OR armor. Drop flow:
  1. roll TIER from the chest's existing tier odds (UNCHANGED).
  2. roll GEAR CLASS: weapon vs armor = 50/50 (single config constant GEAR_SPLIT, tune later).
  3. if WEAPON → pick weapon_roster row of that tier → roll ATK/CRIT (Gear Overhaul §B.3).
     if ARMOR → roll TYPE type-weighted (1/3 Heavy, 1/3 Medium, 1/3 Light) → pick armor_roster
     row of that tier+type (is_available=TRUE) → roll HP/DEF band §C.1 (Supreme fixed).
  4. roll native socket count (Phase 2 counts) — store empty slot placeholders now, activate Phase 2.
  5. insert user_weapons OR user_armors row (8-char id, unique across BOTH tables; enhancement=1).
- Supreme Chest now yields a Supreme weapon OR Supreme armor (Aegis/Mail of Brokkr/etc.).
- NOTE: weapon drop frequency effectively halves (~50% of drops are now armor). Re-check the
  weapon enhance/sell economy flow in Phase 6 tuning.

  1.3 (removed — no dedicated armor chest; armor flows from the existing chests in 1.2)

  1.4 Commands

- `crd bag armors` — paginated, identical layout to `crd bag weapons` (no ATK line; show HP/DEF,
  type Heavy/Medium/Light, enhancement, 🔒, sockets summary).
- `crd equip [id]` — ONE command; lookup id in user_weapons then user_armors; write
  equipped_weapon_id or equipped_armor_id accordingly.
- `crd equipment info [id]` (alias `crd eq info`; keep `crd weapon info` as a deprecated alias) —
  UNIFIED Canvas card for BOTH weapon and armor. Lookup id in user_weapons
  then user_armors; render the matching card. Shared layout (tier color,
  type icon, enhancement, passive, lore, sockets, art); the ONLY branch is
  the stat line: weapon → ATK · CRIT, armor → HP · DEF. Miss in both tables
  → "You don't own equipment with that ID."
- `crd enhance [id]` — reuse the forge; id-detect weapon vs armor; weapon scales ATK, armor
  scales HP/DEF, both via weaponBoostTable. (Unchanged verb, two id types.)
- `crd lock/unlock [id]` — extend to user_armors (id-detect).
- `crd sell [id|tier]` — extend sell logic to armor; same locked/equipped exclusions; armor sell
  prices mirror weapon (Common100/Rare1k/Mythic5k/Leg100k/Sup1M).

  1.4a Dev cleanup command

- `crd dev resetweapons [@user]` — zeroes the target's GEAR ONLY: null equipped_weapon_id +
  equipped_armor_id, then DELETE all user_weapons AND user_armors rows for that user. Leaves deities,
  essence, currency, chests, level, quests, runes UNTOUCHED. Defaults to self; DEV_IDS-gated; logged
  to dev_logs with a pre-wipe snapshot (counts removed). DEFAULT: bare zero, NO starter re-grant
  (intended as a post-Phase-1 cleanup of pre-v5 / shield / test gear). Variant available: auto
  re-grant Initiate's Blade + Garb if you'd rather accounts bounce back playable.
  PHASE-2 EXTENSION (note for later): when runes exist, also set user_runes.socketed_into = NULL for
  any rune socketed into the deleted gear (return runes to the bag, don't orphan/delete them).

  1.5 New armor passives

- Register the 8 functions from credd_v5_new_armor_passives.js. Reset per-battle flags on init
  (antingUsed, bathalaHits). Wire the two resolver caps (total evade <=40%; damage-reduction floor).

  1.6 Character creation

- Grant + equip starter armor "Initiate's Garb" alongside Initiate's Blade. No armor-chest grant
  (armor now flows from the existing Silver Chests already granted at creation).

  1.7 Profile/embeds

- Profile + raid + duel embeds show an equipped-armor line (name, tier color, HP/DEF) next to weapon.

  1.8 Schema housekeeping (tiny)

- dev*logs.action_type is VARCHAR(30) with no CHECK, so 'reset_weapons' just works — but add it to
  the documented action_type list (alongside reset/give*\*/ban) for consistency.
- GEAR_SPLIT (weapon vs armor = 50/50) lives as a config constant, not in the DB.

PHASE 1 DONE WHEN: a new character spawns with Blade + Garb equipped; the existing chests drop weapon
OR armor (~50/50); armor equips/enhances/sells and its HP/DEF flow into battle via the pipeline; all 8
new passives fire; `crd equipment info [id]` renders both gear kinds from one command; embeds show both
slots; `crd dev resetweapons` cleanly zeroes a tester's weapons+armors and nothing else.

=======================================================================
PHASE 2 — RUNE / SOCKET SYSTEM (new whole system — build second)
=======================================================================
Goal: gear has sockets; runes drop, socket in, and modify stats/combat.

2.1 Rune content (SQL: credd_schema_v5b_runes_seasons.sql §A)

- 10 families × tiers. Lanes: offense (Sharpness,Precision,Vampiric,Piercing,Venom),
  defense (Vitality,Bulwark,Thorns,Warding,Aegis). `rune_roster.value` is the legacy/default
  reference value; each owned rune rolls its actual percentage once into `user_runes.rolled_value`
  from code-side config ranges.

  2.2 Socket counts (rolled at gear drop — retro-applies to Phase 1 drops via the placeholders)
  Native slots by tier (native lane = weapon:offense / armor:defense):
  | Tier | Native slots | Roll weights |
  | Common | 0 | — |
  | Rare | 1–2 | 1:70% · 2:30% |
  | Mythic | 2–3 | 2:60% · 3:40% |
  | Legendary | 3–4 | 3:65% · 4:35% |
  | Supreme | 4 | guaranteed |
  Opposite slots (opposite lane): NOT rolled — BOUGHT (§2.5). Max opposite: Mythic 1, Legendary 2,
  Supreme 2. Common/Rare cannot buy opposite slots.

  Current implementation override: native sockets are capped at 2 for now
  (Rare 1-2, Mythic 1-2, Legendary 2, Supreme 2), and opposite socket
  unlock/socketing is disabled until a future update restores opposite runes
  and 4-slot caps.

  2.3 Rune drop/craft faucet

- Essence Bag (primary faucet): essence + Credux → bag → open → random rune (tiered).
  Lesser (Epic/Mythic essence) → Common–Rare runes;
  Greater (Legendary) → Mythic–Legendary;
  Divine (Supreme) → Legendary–Supreme. (SQL seeds bag definitions; tune costs.)
- `crd open lb/gb/db [amount]` style open commands Maximum 10 only.
- Opening Style same as chest opening, duplicate chest opening for rune opening. You create an opening message myth style
  Use lesser_bag.gif for Lesser bag opening
  Use greater_bag.gif for Greater bag opening
  Use divine_bag.gif for Divine bag opening
- Result display same as Weapons display embed after chest opening
- Images for runes are in assets\items\runes folder

  Drop rates:
  Lesser: 100% Random Rare
  Greater: 85% Mythic Random Runes, 15% Legendary Random Runes
  Divine: 85% Legendary Random RUnes, 15% Supreme Random Runes

  2.4 Socketing

- `crd socket [gear_id] [rune_uid] [slot#]` — slot a rune into a native/opposite slot. Lane must
  match the slot's lane (offense rune → offense slot). Writes the gear's native_sockets/opposite_sockets
  JSONB (shape in naming conv) and sets user_runes.socketed_into.
- `crd unsocket [gear_id] [slot#]` — remove; costs Credux OR destroys the rune (pick one; recommend
  Credux cost to keep runes scarce-but-recoverable). Clears socketed_into.
- Stat-% runes feed the assembly pipeline (Step 4/5). Effect runes register as combat hooks
  (lifesteal/Vampiric, DEF-ignore/Piercing, DOT/Venom, reflect/Thorns, DOT-cut/Warding,
  dmg-reduction/Aegis) consumed during turns — same hook style as passives.

  2.5 Opposite-slot unlock (Credux + same-tier essence sink)

- `crd unlock socket [gear_id]` — buy the next opposite slot up to the tier cap. Cost table in SQL.
- Honors caps: Mythic 1, Legendary 2, Supreme 2; Common/Rare blocked.

  2.6 Rune bag / inventory views

- `crd rune bag` - list all 3 bags and count 0 default if user doesn't have. crd bag chests style embed
- `crd runes` — list owned runes (family, tier, value, socketed-into/free, 🔒).
- Extend lock/sell convention to runes if desired.
- Same design as crd bag weapons, rune icons emoji uploaded to Bot emoji. Read game_items.txt for rune icons.

  2.7 Exchange shop (essence tier-up — one-way)

- `crd essence shop` - Same design embed as crd supporter shop (Header with essence icon)
- ID's to buy are just increment from 1.
  1 = Lesser Rune Bag: Cost 10 Mythic essence + 50,000 credux
  2 = Greater Rune Bag: Cost 10 Legend Essence + 125,000 credux
  3 = Divine Rune Bag: Cost 10 Supreme Essence + 250,000 credux
  4 = Mythic Essence: Cost 10 Epic Essence + 50,000 credux
  5 = Legendary Essence: Cost 10 Mythic Essence + 125,000 credux
  6 = Supreme Essence: Cost 10 Legendary Essence + 250,000 credux
- `crd exchange [id]` — NEVER downward.
- Emoji Icons are uploaded in Discord bot for rune bags

PHASE 2 DONE WHEN: gear shows real sockets, essence bags yield runes, runes socket and change battle
stats/effects through the pipeline + hooks, opposite slots are buyable, exchange shop works.

=======================================================================
PHASE 3 — PANTHEON (3 deity slots)
=======================================================================
Goal: collection matters — equip a main + 2 support deities; reputation level gates slots.

3.1 Slots (schema already in Phase 0 §4): active_deity_id (main, 100%/100%),
active_deity_id_3 (25% stats), active_deity_id_2 (25% stats). Unlocking 3rd slot (active_deity_id_3) will unlock slot for 2nd deity passive at 50% effectivity
3.2 Believer-level gates: slot 3 unlock at Believer 10, slot 2 at Believer 25 (or your final numbers recommend which is better based on the experience required to level up and the length to reach it).
3.3 blessing_scaling tag: 'scalable' → multiply blessing magnitude by slot % (100/50/25);
'binary' → fires at FULL but MAIN SLOT ONLY (support slots give only the stat %). Populate the tag.
3.4 Stat contribution: flat-add per Stat Assembly Step 6 (deities not scaled by runes).
3.5 Same-family blessing no-stack: reuse §13.1 conflict resolution (strongest of a family fires).
3.6 Caps: total evade <=40% (shared with armor); cap combined sustain (heal+heal+lifesteal).
3.7 Commands: `crd deity equip [name] [slot]` (slot 1/2/3); profile shows all 3 + which blessings active.

=======================================================================
PHASE 4 — RANKED PvP + LEADERBOARDS
=======================================================================
4.1 Three duel modes (clean walls):
`crd duel` (casual, no stakes) · `crd duel wager @user [amt]` (Credux, NO rating; cap 50k/duel;
winnings count vs the 1M/day bestow-shared cap; log all) · `crd ranked` (rating, NO Credux).
4.2 Elo: pvp_rating default 1000.
Brackets Mortal(0–999)/
Champion(1000–2499)/
Demigod(2500–4999)/
Ascendant(5000–9999)/
Divine(10000+). Match only previous/current/next bracket.
Points: same +25/−20 · below +12/−35 · above +40/−10. Demotion shield at bracket floor.
4.3 Ranked runs on level-normalized duels (reuse `crd duel [level N]` normalize) so build decides.
For crd ranked
4.3 A: it will automatically generate enemy for him to avoid abuse. For example A demigod rank will be only matched with users with champon, demigod, ascendant pvp rating only. Randomized via userlist
with the same rule Points: same +25/−20 · below +12/−35 · above +40/−10. Demotion shield at bracket floor.
4.4 Leaderboards: serverwise + global toggle. Categories: lifetime_credux_earned (NOT bestow/wager/
casino), Raids Done, Raid Wins, Duel Wins (casual), PvP Rating, Combat Level, Believer Level,
Boss Kills (participation: boss died + you attacked). `crd leaderboard [category]`.
4.5 Ranked rewards (weekly by current bracket + season-end by peak bracket). Values:
| Bracket | Weekly chest | Season-end payout |
| Mortal | 5k credux + 1 Silver Chest | — |
| Champion | 15k credux + 1 Gold Chest | small season title |
| Demigod | 30k credux + 1 Boss Treasure | season title + credux |
| Ascendant | 60k credux + 1 Boss Golden | season title + 1 Sacred Relic |
| Divine | 100k credux + 1 Boss Golden | exclusive seasonal title + 1 Supreme Relic + 1 Supreme chest | - Weekly: paid on the weekly PHT reset to each player's CURRENT bracket; one claim per week; auto credit to bags

(`crd ranked claim` or auto-grant). Season-end: paid on season rollover by PEAK bracket reached. - Anti-abuse: weekly reward requires a minimum games-played threshold that week (e.g. >=5 ranked
games) so an idle Champion can't farm weekly chests without laddering. Tune the threshold. - Reward amounts live in the ranked_reward config table (credd_schema_v5b_runes_seasons.sql §E).

=======================================================================
PHASE 5 — SEASONS, BANNERS & TITLES
=======================================================================
5.1 Season = 2 months (6/year). One clock drives: ranked reset (soft, rating×0.6 min 1000), banner,
event modifier, reward track. Tables in credd_schema_v5b_runes_seasons.sql §C.
5.2 Banner: weight Step-2 of the existing two-step gacha toward the featured deity (~50%). Separate
banner pity: a non-featured Legendary flags next-Legendary-guaranteed-featured. Limited deities =
banner-only. Backend-only, like existing pity.
5.3 Titles: `crd title` to browse/equip. Sources: Believer levels (existing), season-end rank titles
(e.g. "Divine — Embercrowned", never repeats), boss feats ("Godslayer"/"World-Ender"),
collection ("Pantheon Keeper"), event titles. 12-month plan in Seasons SQL/notes.
5.4 Optional reward track (free now; premium later as monetization lever).

=======================================================================
PHASE 6 — POWER-BUDGET RETUNE (LAUNCH GATE — do before Phases 1–4 go public)
=======================================================================

- Model a MAX build through the Stat Assembly pipeline: pantheon 175% + up to 6 weapon runes +
  up to 6 armor runes + uncapped crit + best gear. Set the ceiling (target ~2.3× current single build).
- Re-tune boss HP/ATK/DEF (mob_roster) to that ceiling. Re-check Greater Boss 2× HP.
- Enforce: total evade <=40%; combined damage-reduction floor (incoming never < 25% post-DEF);
  sustain cap. Confirm no downstream re-imposes the old 45% crit clamp.
- Re-check casino/economy sinks vs the new Credux faucets (armor sells, rune unsocket, exchange).

=======================================================================
DEPENDENCY ORDER (hard): 0 → 1 → 2 → {3,4 parallel} → 5 ; 6 gates the public release of 1–4.
Phases 1 and 2 are shippable to testers without 3–5. Phase 6 is mandatory before any of it is public.
=======================================================================
