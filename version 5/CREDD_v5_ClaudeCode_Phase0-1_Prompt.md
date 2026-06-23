# CLAUDE CODE — CREDD v5 KICKOFF PROMPT (Phase 0 + Phase 1)
# Paste the block below into a fresh Claude Code session at the repo root.
# It is written to make Claude Code READ first, PLAN first, and STOP for your review before coding.

--------------------------------------------------------------------------------
You are implementing the CREDD Discord RPG bot's v5 "Gear Overhaul." This is a real, in-testing
codebase — be careful and surgical. DO NOT write or change any code yet. Your first job is to read the
design, inspect the repo, and produce an implementation PLAN that I will review and approve before any
code or migration runs.

## STEP 1 — Read these design files in this exact order, fully, before anything else:
1. CREDD_Master_Export_v4_2.md        — the base game design (v4.2). Authoritative for all core systems.
2. CREDD_Master_Export_v5.md          — the v5 overlay. Where it conflicts with v4.2, v5 WINS (see its §V5-0).
3. CREDD_v5_Architecture_Blueprint.md — the phased build order. We are doing PHASE 0 and PHASE 1 only.
4. CREDD_v5_Naming_Conventions.md     — slugs, keys, ids, JSONB shapes, command names. Follow exactly.
5. CREDD_v5_Gear_Overhaul.md          — weapon post-split roster + full armor roster + stat banding.
6. CREDD_v5_Stat_Assembly.md          — the final-stat computation pipeline (class+weapon+armor+runes+pantheon).
7. credd_v5_new_armor_passives.js     — the 8 new armor passive functions to register.
8. credd_schema_v5_migration.sql      — the Phase 0 DB migration (gear split + armor tables + seed).
9. passive_registry.md / passiveRegistry.js — existing passives + conventions to match.
10. credd_schema_v4.sql               — the current live schema, to diff against.

Also skim the existing command handlers for: weapon bag, weapon info, equip, enhance, lock/sell, chest
open, character creation, and the combat/duel stat assembly — you will be extending these.

## STEP 2 — Reconcile against the real code (this is the critical step):
The design files were written from the v4.2 docs, NOT from your actual source. Before planning, verify:
- The real `passiveRegistry.js` API: actual method names and hook phases (the new-armor-passives file
  uses placeholder names like bs.healSelf / bs.rollEvade / bs.incomingDamage / "incoming" /
  "onDebuffApply" — map these to the REAL helpers/phases, or list what's missing).
- The real stat-assembly code path used by combat, profile, and duels (so armor + the new pipeline
  hook in cleanly, and so removing weapon HP/DEF doesn't break callers).
- The real chest-open / drop-generation code (so the weapon-OR-armor 50/50 gear-class roll inserts
  at the right place).
- The real id generator and whether ids are currently unique within a table only (v5 needs weapon_id
  and armor_id unique across BOTH gear tables).
- The real character-creation grant flow (to add Initiate's Garb alongside Initiate's Blade).
- Confirm `dev_logs.action_type` accepts a new 'reset_weapons' value.

## STEP 3 — Produce a written PLAN (no code yet). The plan must include:
A. A migration plan for Phase 0 (credd_schema_v5_migration.sql): what it changes, the shield→armor
   data step, and how you'll handle existing test data in `user_weapons` (recommend wipe/re-seed since
   we're in testing — confirm with me). Note the irreversible parts.
B. A file-by-file change list for Phase 1, grouped by the Blueprint's 1.1–1.8 sub-steps:
   stat assembly, combined-chest drop gen, armor bag/equip/info(unified)/enhance/lock/sell, the 8
   passives + resolver caps (total evade ≤40%, damage-reduction floor), character-creation starter,
   profile/embeds, and `crd dev resetweapons`.
C. Every place the removal of weapon HP/DEF could break a caller, and how you'll fix each.
D. The exact list of placeholder API names from the passives file that need mapping to real helpers,
   and any engine hooks that DON'T yet exist and must be added.
E. A test checklist matching the Blueprint's "PHASE 1 DONE WHEN" line.
F. Open questions for me (e.g. GEAR_SPLIT ratio = 50/50 ok? wipe vs migrate test data? re-grant
   starter on resetweapons? any of the ⚠ balance items to defer to Phase 6?).

## SCOPE GUARDRAILS:
- PHASE 0 and PHASE 1 ONLY. Do NOT build runes, pantheon, ranked, leaderboards, or seasons yet
  (Phases 2–5) — except creating the empty socket JSONB columns, which Phase 0 already does.
- Treat all balance numbers as final-for-now but flagged; do NOT silently change any design value.
- Do NOT run the migration or modify the DB until I approve the plan.

## OUTPUT:
Post the PLAN (Steps A–F) and STOP. Wait for my review and approval before writing any code or running
any migration. When I approve, implement Phase 0 first, let me verify the DB, then implement Phase 1.
--------------------------------------------------------------------------------
