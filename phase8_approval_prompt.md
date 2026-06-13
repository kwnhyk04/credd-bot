# PHASE 8 — PLAN APPROVED (full response: approval + flag resolutions + mob reconciliation)

Your Phase 8 plan is approved. Build now with the resolutions, confirmations, and the mob-stats reconciliation below. Everything not contradicted here stands exactly as you planned it.

---

## 1. MOB STATS RECONCILIATION — do this FIRST, before pinning fixtures

The live DB is the source of truth and supersedes BOTH your seed-file figures (your Duwende 1,860 / Manananggal 2,700 were stale) and the Master §15 HP column (my interim +500 values). This is the authoritative live export of mob_roster:

```csv
mob_id,name,mythology,mob_type,base_hp,base_atk,base_def,base_crit,hp_per_level,atk_per_level,def_per_level,skill_key
26,Cyclops,Greek,elite,2550,172,155,10.0,75,30,16,cyclops_boulder_throw
10,Kapre,PH,elite,2550,170,138,10.0,75,30,16,kapre_smoke_cloud
12,Batibat,PH,elite,2530,174,136,10.0,75,30,16,batibat_sleep_paralysis
7,Manananggal,PH,elite,2450,172,140,10.0,75,30,16,manananggal_viscera_drain
18,Fossegrim,Norse,elite,2250,178,144,10.0,75,30,16,fossegrim_enchanting_melody
27,Chimera,Greek,elite,2210,192,142,10.0,75,30,16,chimera_tri_form_assault
20,Valkyrie,Norse,elite,2210,198,148,10.0,75,30,16,valkyrie_battle_judgment
19,Nokken,Norse,elite,2150,192,138,10.0,75,30,16,nokken_luring_form
8,Aswang,PH,elite,2150,195,135,10.0,75,30,16,aswang_shape_shift
25,Minotaur,Greek,elite,2150,198,138,10.0,75,30,16,minotaur_labyrinth_charge
9,Tikbalang,PH,elite,2090,188,142,10.0,75,30,16,tikbalang_disorientation
17,Ratatoskr,Norse,elite,2050,200,130,10.0,75,30,16,ratatoskr_slander
11,Sigbin,PH,elite,2050,168,158,10.0,75,30,16,sigbin_shadow_step
13,Troll,Norse,regular,1730,116,74,5.0,40,15,10,troll_regeneration
3,Amalanhig,PH,regular,1730,112,68,5.0,40,15,10,amalanhig_infectious_bite
14,Dwarf,Norse,regular,1630,115,85,5.0,40,15,10,dwarves_stone_skin
23,Skeleton Warrior,Greek,regular,1610,118,85,5.0,40,15,10,skeleton_warrior_undying_resolve
1,Black Duwende,PH,regular,1610,118,78,5.0,40,15,10,dwende_black_hex
16,Light Elf,Norse,regular,1610,118,77,5.0,40,15,10,light_elves_radiant_strike
4,Amomongo,PH,regular,1590,130,65,5.0,40,15,10,amomongo_rend
2,White Duwende,PH,regular,1570,125,72,5.0,40,15,10,dwende_white_daze
15,Dark Elf,Norse,regular,1570,130,65,5.0,40,15,10,dark_elves_curse_of_decay
6,Santelmo,PH,regular,1560,116,74,5.0,40,15,10,santelmo_will_o_wisp
5,Bal-Bal,PH,regular,1550,118,78,5.0,40,15,10,bal_bal_carrion_sense
21,Satyr,Greek,regular,1540,122,78,5.0,40,15,10,satyr_wild_revelry
24,Lamia,Greek,regular,1500,128,72,5.0,40,15,10,lamia_serpent_bite
22,Harpy,Greek,regular,1470,132,66,5.0,40,15,10,harpy_swooping_talons
```

Actions:
- a) Update CREDD_Master_Export_v4.md §15: replace the HP column of every regular/elite row with these values; ATK/DEF/CRIT/skill text should already match — VERIFY rather than assume, and report any cell that disagrees. Names as given (Black/White Duwende, Dwarf, Dark Elf, Light Elf). Bosses untouched.
- b) Update the in-repo mob seed file to match this export exactly (it is currently stale).
- c) Pin the selftest 1e fixtures to these values (Black Duwende Lv1 = 1,650/133/88; Manananggal Lv1 = 2,525/202/156) and recompute every expected number that depended on mob HP.
- d) skill_key values are UNCHANGED — do not touch passiveRegistry.js or passive_registry_keys.md. The renames are display-name only.
- e) Confirm nothing in the codebase matches mobs by display-name string (lookups must be mob_id / skill_key based).

## 2. FLAGS — all six approved as you proposed

- Overcharge scope: the MAIN hit only (the hit carrying the +200% rider, crit fully suppressed on it — pre-rolled latch voided, nextAttackAutoCrit ignored). Separate rider hits in the same action (Labrys 2nd hit, Glacial Bow extra attack) keep fresh crit rolls and get NO +200%.
- §12 stale Overcharge line: correct catch — already patched on my side to the v4.2 wording; make your §15 edit (item 1a above) against that updated doc and verify the §12 line reads every-3-rounds.
- duel_challenges: every accepted-and-fought duel counts, repeats included. Declined/expired challenges never count.
- Midnight roll population: all user_character holders, per-user short transactions, lazy roll as the universal backstop.
- game_logs action label: 'Quest' — approved.
- Completion-notice mechanism: message content line on the final battle frame; `-#` line appended to the forge result container — approved. No DMs.

## 3. CONFIRMED DETAILS — keep exactly as planned

- Crit pre-roll draw still consumed on overcharge rounds (RNG stream stability), with the latch forced false — and the contract header documents both this and the skipped order-draw in boss mode.
- Boss actor order: first_strike checked BEFORE the mode branch (Sleipnir first in boss mode); raid/duel keep the 50/50 roll and existing draws.
- Snapshot cadence: duel every round / raid odd rounds + final / boss every 3rd (unchanged). Your worst-case timings (raid ≈ 47s, duel ≈ 92s) are accepted.
- Class base HP 500 via the single BASE_STATS.hp constant feeding both battle and profile paths.
- Bestow: in-transaction re-validation under sorted users_bag locks then users FOR UPDATE; no partial fills (reject states remaining headroom); 60s sender-only collector; re-stamped Sealed time on confirm; two game_logs rows action 'Bestow'.
- Quests: advisory xact-lock + UNIQUE/ON CONFLICT around the shared roll path; progressQuests inside the caller's open transaction holding the bag lock (bag → character → quests order); credux_spent target a multiple of 1,000; elite win progresses BOTH raid_wins and elite_defeats; auto-grant exactly once via the completed-flag UPDATE guard.
- overcharge_pct written as 0, column unused (schema frozen).

## 4. BUILD & STOP

Build everything now. Static validation before stopping: updated selftest fully green (including the new overcharge 3/6/9 + crit-suppression assertions, boss-order scripted-stream proofs, snapshot-cadence counts, class-HP checks, and the re-pinned 1e fixtures), node --check on every touched file, every SQL statement verified against the frozen schema's exact column names.

Then STOP and report: files changed, selftest summary, the §15 verification result from item 1a (any mismatched cells), and any deviation from this message with the reason.

I will then live-test: bestow (cap enforcement, confirm/cancel/expiry, RMT embed, double-click race), quests (midnight + lazy roll, raid/duel/enhance progress, elite double-progress, auto-grant + notice lines, canvas embed render), a Mage raid (overcharge fires rounds 3/6/9, never crits on them, lost when stunned on round 3), a boss attack (player first; Sleipnir still first), and the new duel/raid edit cadences.
