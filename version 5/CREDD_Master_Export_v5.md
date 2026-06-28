# CREDD — MASTER EXPORT v5 (GEAR · RUNES · PANTHEON · RANKED · SEASONS)
# CONNECTS TO: CREDD_Master_Export_v4_2.md  (v4.2 remains the base; this is an OVERLAY, not a replacement)
# READ ORDER: v4.2 first (core systems), then this v5 overlay (changes + new systems).
# Where v5 conflicts with v4.2, v5 WINS — conflicts are listed explicitly in §V5-0.
# Companion build files: CREDD_v5_Architecture_Blueprint.md (phased), CREDD_v5_Naming_Conventions.md,
#   CREDD_v5_Gear_Overhaul.md, CREDD_v5_Stat_Assembly.md, credd_v5_new_armor_passives.js,
#   credd_schema_v5_migration.sql, credd_schema_v5b_runes_seasons.sql, CREDD_v5_Armor_Art_Prompt.md.

=======================================================================
§V5-0. WHAT v5 CHANGES IN v4.2  (conflict map — v5 overrides these)
=======================================================================
- WEAPONS: lose HP/DEF. Weapons now carry ATK + CRIT only. (Overrides v4.2 §7/§35.6 weapon stats.)
- WEAPON TYPES: Shield removed from weapons → Sword, Staff, Gloves, Bow. (Overrides v4.2 §7/§8.)
- CRIT CEILING: the 40%/45% total CRIT clamp is REMOVED. Class CRIT growth (§11) stacks freely with
  weapon CRIT and Precision runes. (Overrides v4.2 §11/§35.6 crit cap.)
- ARMOR: new second equipment slot (HP/DEF only, no CRIT). Shields migrate here. (New vs v4.2.)
- CHESTS: existing chests now drop weapon OR armor (50/50 gear-class roll). No new chest currency.
  (Extends v4.2 chest behavior; tier odds unchanged.)
- DEITIES: up to 3 equipped (pantheon). (Overrides v4.2 single-deity equip.)
- DUELS: split into casual / wager / ranked. (Extends v4.2 friendly-only duels.)
- Everything else in v4.2 stands unchanged.

=======================================================================
§V5-1. GEAR MODEL  (weapons + armor)
=======================================================================
1.1 The four stats and their sources (full pipeline in CREDD_v5_Stat_Assembly.md):
    HP   = class+level + armor (+Vitality runes)
    ATK  = class+level + weapon (+Sharpness runes, +pantheon)
    DEF  = class+level + armor (+Bulwark runes)
    CRIT = class+level + weapon (+Precision runes)  — UNCAPPED
1.2 WEAPON banding (CREDD_v5_Gear_Overhaul §B.3):
    ATK by tier×type: Staff top20% / Gloves & Bow top40% / Sword mid. Supreme = 800 fixed.
    CRIT by type (uncapped): Bow 8–12% · Sword 5–8% · Gloves 2–4% · Staff 1–2%. Supreme none.
1.3 ARMOR types: Heavy (max DEF) · Medium (balanced) · Light (max HP). No CRIT.
    Bands (Gear Overhaul §C.1): Rare/Mythic/Legendary roll within tier band positioned by type;
    Supreme FIXED by type — Heavy 1000/600 · Medium 1200/500 · Light 1400/400.
1.4 ENHANCEMENT: armor reuses the weapon boost table (×1.00…×2.00) — scales HP/DEF.
1.5 EQUIP: one weapon slot (equipped_weapon_id) + one armor slot (equipped_armor_id).
1.6 STARTER: character creation grants + equips Initiate's Blade (Sword) AND Initiate's Garb (Medium
    armor), so a fresh character is not pure glass.

=======================================================================
§V5-2. ARMOR ROSTER  (24 pieces — full table in CREDD_v5_Gear_Overhaul §C; seed in v5 migration §6)
=======================================================================
14 migrated shields + 10 new pieces, across Common→Supreme, Heavy/Medium/Light. PH: 1→6 pieces.
NEW passives (final values; implemented in credd_v5_new_armor_passives.js):
  - Kalasag (Heavy/Rare/PH): incoming damage −3%.
  - Salakot Ward (Medium/Mythic/PH): 20% chance to negate an incoming debuff.
  - Wolfskin Cloak (Light/Mythic/Norse): regen 10% max HP/turn.
  - Hoplite Panoply (Heavy/Legendary/Greek): incoming damage −15%.
  - Anting-Anting Sash (Light/Legendary/PH): immune to Stun / Petrify / Freeze.
  - Valkyrie's Mantle (Light/Legendary/Norse): 20% chance to evade an attack.
  - Mail of Brokkr (Heavy/Supreme/Norse): incoming damage −30%; reflect 15% of damage taken.
  - Mantle of Bathala (Medium/Supreme/PH): +5% HP & +5% DEF per turn, stacking up to +100% each.
  - Helm of Darkness (Light/Supreme/Greek): 30%/turn to reduce enemy DEF by 50% for 2 turns.
  - Initiate's Garb (Medium/Common): none (starter).
PROMOTED to Supreme: Aegis (proc 20%→50%), Helm of Darkness (reworked to offensive DEF-shred).
⚠ BALANCE WATCH (Phase 6): Mantle of Bathala's unbounded +100%/+100% ramp; Anting-Anting's blanket
  CC-immunity at Legendary; stacked Aegis-rune + flat-DR builds vs the damage-reduction floor.

=======================================================================
§V5-3. RUNE / SOCKET SYSTEM  (new — Blueprint Phase 2; content in v5b SQL §A/§B)
=======================================================================
3.1 Sockets: gear has native + opposite slots (JSONB on user_weapons/user_armors).
    WEAPON: native = offense lane, opposite = defense lane.  ARMOR: native = defense, opposite = offense.
3.2 Native slot counts roll at drop: Rare 1–2 · Mythic 2–3 · Legendary 3–4 · Supreme 4.
    Opposite slots are BOUGHT (essence+Credux), cap: Mythic 1 · Legendary 2 · Supreme 2.
3.3 Rune families (10) × 4 tiers — FINAL values in v5b SQL §A. Offense: Sharpness/Precision/Vampiric/
    Piercing/Venom. Defense: Vitality/Bulwark/Thorns/Warding/Aegis(aegis_rune).
3.4 FAUCET — Essence Bags (drop rates per spec):
    Lesser (eb): 100% Rare rune.
    Greater (geb): 85% Mythic / 15% Legendary.
    Divine (deb): 85% Legendary / 15% Supreme.
3.5 Essence sinks (revives the dupe-essence graveyard): deity enhance (existing) + opposite-slot
    unlock + essence bags + one-way exchange shop (10 Epic→1 Mythic→…→Supreme; never downward).
3.6 Stat-% runes feed the assembly pipeline; effect runes (Vampiric/Piercing/Venom/Thorns/Warding/
    aegis_rune) are combat hooks applied during turns (§35.1 timing).

=======================================================================
§V5-4. PANTHEON  (Blueprint Phase 3)
=======================================================================
3 deity slots: Main 100% stats / 100% blessing · Slot 3 (Believer 10) 50%/50% · Slot 2 (Believer 25)
25%/25%. Binary blessings (blessing_scaling='binary') fire MAIN-SLOT ONLY at full; support slots give
only the stat %. Same-family blessings don't stack (§13.1). Caps: total evade ≤40%; sustain capped.

=======================================================================
§V5-5. RANKED PvP + LEADERBOARDS  (Blueprint Phase 4)
=======================================================================
Duels: casual / wager (Credux, 50k cap, counts vs 1M/day bestow-shared cap) / ranked (rating only).
Elo brackets [IMPLEMENTED — Blueprint Phase 4 cutoffs are authoritative]:
  Mortal 0–999 · Champion 1000–2499 · Demigod 2500–4999 · Ascendant 5000–9999 · Divine 10000+.
Demotion shield at bracket floor (one protected loss; consumed at floor, refreshed on promote).
[PHASE 6] Points are now DYNAMIC (config/ranked.eloDelta) — rank difference is the only factor:
  expected = 1/(1+10^((opp−self)/1000)); won → clamp(round(32·(1−E)), +8, +32); loss → clamp(round(32·(0−E)),
  −32, −8). Beat a stronger foe = more; lose to a weaker one = costs more. (Old fixed +25/−20 table retired;
  pointsFor is a back-compat shim over eloDelta.)
[PHASE 6] Matchmaking avoids an immediate rematch (excludes the most-recent opponent) and WIDENS from ±1
  to ±2 brackets (config/ranked.matchRangeWide) when the ±1 pool is thin, falling back to allow the last
  opponent only if nobody else qualifies.
[PHASE 6] Valor Medals (PvP currency, users_bag.valor_medals) drop on EVERY ranked result — win AND loss —
  scaled by the same expectancy (win 10–25, loss 3–8). The ranked result now renders INSIDE the embed FOOTER
  (battleRender footer param): your Tier #/name + opponent Tier #/name + rating move + Valor earned.
Ranked matchmaking: random eligible real-user SNAPSHOT in the rating window, fought
at TRUE levels/stats/equipment (NO level normalization); ONLY the challenger's pvp_rating moves
(opponent offline-safe).
Leaderboards: ONE command `crd leaderboards` (`crd lb`) — header + two dropdowns (category, scope
server/global), top 15, themed footer quote. Categories: PvP Rating, lifetime_credux_earned
(grind/sell/quest/daily/boss — bestow/wager/casino excluded), Raids Done/Wins, Duel Wins (casual),
Combat/Believer Level, Boss Defeats (participation = boss_kills), Boss Top Hit (highest single-attack
boss damage = boss_top_damage, Phase 5b). DESC indexes per metric (credd_schema_v5_phase4_indexes.sql
+ idx_uc_boss_top_damage) keep each board an index scan.
Weekly reward: `crd ranked claim` — current bracket from ranked_reward table, gated ≥5 ranked games
that PHT week, one claim/week (now also grants ranked_reward.weekly_valor). Season-end (rolloverIfDue)
grants ranked_reward.season_valor by PEAK bracket — the "monthly" rank payout.
[PHASE 6] PvP SHOP — `crd pvp shop` (`crd ps`) + `crd pvp buy <id> [qty]` (src/commands/rpg/pvpShop.js).
  The Valor sink, rendered in the same canvas style as `crd essence shop` (renderBagItemsImage). Items with
  PER-SEASON caps tracked in pvp_shop_purchases (reset each season_id via active season): Sacred Relic 800 Valor
  (cap 10/season), Supreme Chest 6,000 (cap 1), Supreme Relic 9,000 (cap 1). Priced so a Supreme item is ~2–3
  months of steady Valor inflow. Buys are atomic with cap + balance checks.
Schema: credd_schema_v5_phase4.sql (pvp_peak, last_weekly_claim_week, pvp_demotion_shield;
ranked_logs; wager_logs). Ranked rewards seeded in credd_schema_v5b_runes_seasons.sql §E.

=======================================================================
§V5-6. SEASONS · BANNERS · TITLES  (Blueprint Phase 5; v5b SQL §C)
=======================================================================
Season = 2 months [IMPLEMENTED]: seasonEngine.rolloverIfDue (cron daily 00:05 PHT + `crd dev season
start|end|rollover|info`). Rollover = season-end payout by PEAK bracket (ranked_reward.season_end_payload:
credux/chests/relics + season-rank title) → soft ranked reset (rating×0.6, min 1000; peak/shield reset)
→ next season activated.
Titles [IMPLEMENTED]: `crd title` (`crd t`) — category dropdown + 10/page + `equip`/`unequip`; equipped
title shows on `crd profile`. Sources: believer milestones; season rank (Divine = rotating exclusive
seeds; lower = per-season title); boss feats (Godslayer 50 / World-Ender 200 / Deicide 400 /
Ragnarok Bringer 700 / Eternal Vanquisher 1000 kills); collection (Anito Sovereign = all PH, Aesir
Warden = all Norse, Olympian Ascendant = all Greek, Pantheon Keeper = all deities); event
(`crd dev granttitle`). Grant conditions in src/config/titles.js (tunable). title_catalog has how_to +
image_filename (OPTIONAL PNG art — text-only until set). Schema: credd_schema_v5_phase5.sql + _phase5b.sql.
BANNER — DEFERRED (featured weighting + banner pity + limited deities not built).
REWARD TRACK — DEFERRED.

=======================================================================
§V5-7. POWER-BUDGET RETUNE  (LAUNCH GATE — Blueprint Phase 6) [IMPLEMENTED]
=======================================================================
v5 power creep (3-slot pantheon 175% + rune sockets + UNCAPPED crit) raised max-build burst, so endgame
bosses were rescaled (credd_schema_v6_mob_retune.sql, idempotent via special_flags.retune_v6):
  boss base_hp & hp_per_level ×1.6 · base_def & def_per_level ×1.3 · atk_per_level ×1.15.
Greater (×2 HP) / Golden (×3 HP) multipliers (src/config/bosses.js) stack on the new bases unchanged.
Caps VERIFIED present, no regression: total evade ≤40% (battleEngine TOTAL_EVADE_CAP + passiveRegistry
summation); incoming-damage floor 25% post-DEF (battleEngine INCOMING_DR_FLOOR, line ~501); crit UNCAPPED
(no 45% clamp anywhere). Elite/regular (raid) mob tuning DEFERRED to a data-driven pass.
Credux faucets/sinks: the new Valor PvP shop (§V5-5) diverts some PvP grind off Credux; armor sells +
exchange-essence + rune unsocket remain the core sinks.
[BATTLE LOG] Per-turn DISPLAY order resequenced (execution/RNG unchanged): actor-1 attack + weapon procs
→ passive HP/DEF buffs → actor-2 attack + dodge/thorns → end-of-round DOT (battleEngine ~§4 actions).

=======================================================================
§V5-8. NEW COMMANDS  (canonical; see CREDD_v5_Naming_Conventions §7)
=======================================================================
crd bag armors · crd bag runes · crd equipment info [id] (alias eq info; weapon info deprecated) ·
crd socket / unsocket · crd unlock socket · crd open eb/geb/deb · crd deity equip [name][slot] ·
crd ranked · crd duel wager · crd leaderboard [cat] · crd title · crd dev resetweapons [@user].
[PHASE 6] crd exchange <lb|gb|db|1|2|3> [qty] (rune bags, letter ids + quantity, default 1) ·
crd exchange essence (continuous enhance-style tier-up; Mythic/Legendary/Supreme dropdown header) ·
crd pvp shop (`crd ps`) / crd pvp buy <id> [qty] (Valor sink) ·
crd quest [daily|weekly] + Daily/Weekly dropdown header · crd quest claim (weekly grand: 1 Sacred Relic).
crd auto raid (`crd ar`) — free idle/passive raid (see §V5-9).
(crd equip / enhance / lock / sell extend to armor via id-type detection. No crd open ac — combined chest.)

=======================================================================
§V5-9. AUTO RAID  (idle/passive raid) [IMPLEMENTED]
=======================================================================
`crd auto raid` (`crd ar`) — FREE passive raid timer. Window = combat_level × 30 min (L1 = 30 min …
L50 = 25 hr; cap implicit from max combat level 50). Never loses; runs ALONGSIDE manual `crd raid`
(independent of active_battles), so it is a pure bonus faucet.
State (auto_raids table, one row/player, DELETED on claim → instantly re-startable):
  no row → Start card (Start button) · row & NOW()<ends_at → Progress card (no button) ·
  row & NOW()≥ends_at → Claim card (Claim button). Buttons owner-checked (araid:start|claim:<uid>).
Reward = DETERMINISTIC expected value (no RNG), computed at claim from the combat level SNAPSHOTTED at
Start. Cadence = 1 virtual raid / 60 s of window. Per virtual raid uses the AVERAGE of each crd raid
loot range, all wins, 80% regular / 20% elite — all magnitudes DERIVED at runtime from
src/config/raidLoot.js (RAID_LOOT + ELITE_SPAWN_CHANCE), no duplicated constants:
  eliteRaids = round(raids×0.20); regRaids = raids − eliteRaids;
  Per-type idle-drop scales (tunable; manual crd raid stays the fuller path):
  EXP = (regRaids×avg(reg.exp) + eliteRaids×avg(elite.exp)) × EXP_SCALE 0.50            (L50 ≈ 150k)
  Credux = (regRaids×avg(reg.credux) + eliteRaids×avg(elite.credux)) × CREDUX_SCALE 0.50 (L50 ≈ 300k)
  Belief Shards THROTTLED harder: (…shards…) × SHARD_SCALE 0.20  (L50 ≈ 1500).
  NO chests (silver/gold) — auto raid grants currency/EXP only.
Rewards: Combat EXP (via awardCombatExp; cap-50 accumulates within level) + Credux + Belief Shards
ONLY (no chests). Does NOT touch raid_logs / raids_won / streaks / quests (no stat pollution).
Claim txn (src/commands/rpg/autoRaid.js): lock users_bag → bag UPDATE → awardCombatExp (bag→character
lock order) → game_logs rows (action 'AutoRaid', one per credux/shards) → DELETE auto_raids.
Schema: credd_schema_v7_auto_raid.sql.

*End of Master Export v5 overlay. v4.2 remains the authoritative base for all unlisted systems.*
