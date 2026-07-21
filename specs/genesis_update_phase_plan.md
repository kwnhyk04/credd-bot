# Genesis Update: Consolidated Implementation Phase Plan

This plan consolidates three sources:

1. **Spec Document 1** (Sections 1 to 13): Level rewards, compensation, CRD Shop, CRD Bag, crd use, Genesis avatar assets, database migrations, performance, testing, deliverables
2. **Spec Document 2** (Sections 14 to 16): Character Class Change embed and flow, Celestial PvP rank, manual-SQL-only policy
3. **genesis_tier_weapons.md**: Genesis tier weapon definitions (Kiri, Moira, Sophia, Atlas, Titan), weapon_roster SQL inserts, items.txt emoji entries

Global rules that apply to every phase:

- Inspect the existing codebase, schema, and patterns before writing anything new
- Reuse existing patterns (quest reward crediting, PvP Shop embeds, Create Character embed, asset resolver, caching strategy)
- All SQL is provided as manual scripts, never executed automatically, never applied via startup code
- Every data change is transactional, idempotent, and safe against retries, concurrency, restarts, and reruns
- No unbounded in-memory caches, no loading all users into memory, no changes to unrelated behavior

---

## Phase 0: Discovery and Inspection (no code changes)

Goal: understand the real system before touching it.

- Map the codebase: command architecture, reward system, inventory system, PvP Shop implementation, CRD Bag implementation, class system, avatar renderer, asset loader, transaction patterns
- Dump and document the actual database schema: table names, columns, types, constraints, indexes, existing reward rows
- Identify the existing quest-reward crediting pattern (this becomes the template for all new reward crediting)
- Identify the existing timezone/reset convention (if none exists, standardize on UTC and document it)
- Identify existing IDs: Sacred Relic, Supreme Relic, Genesis Chest, Diamond Chest (if any)
- Record all findings and assumptions in a discovery notes file

Exit criteria: written inventory of every system that later phases will touch, with real table and file names.

## Phase 1: Database Migrations and Manual SQL Scripts

Goal: all schema and data scripts exist, reviewed, and runnable by hand. Nothing executed automatically.

Scripts (follow project convention if one exists, otherwise):

- `001_level_reward_tracking.sql`: Combat Level and Believer Level reward tracking tables. Unique constraints: (user/character ID + combat level), (user ID + believer level)
- `002_crd_shop_tracking.sql`: daily/weekly/monthly purchase tracking (user, product, reset period, aggregated quantity)
- `003_crd_inventory_updates.sql`: Character Class Change item (`cc`), Diamond Chest inventory support
- `004_crd_bag_category_updates.sql`: move Sacred Relic and Supreme Relic to CRD Bag Items, preserve IDs and quantities, no duplicate rows
- `005_pvp_celestial_rank.sql`: Celestial rank support (only if ranks are stored in DB)
- `006_pvp_celestial_rewards.sql`: Celestial seasonal reward-table entry
- `007_required_indexes.sql`: indexes for reward and purchase-limit lookups
- `008_genesis_weapons.sql`: the five Genesis weapon inserts from genesis_tier_weapons.md (Kiri, Moira, Sophia, Atlas, Titan), adjusted to the real schema found in Phase 0 (IDs, type values, stat columns)
- `009_rollback.sql`: rollback section for each script above

Every script includes: purpose comment, affected tables, transaction block, duplicate-insertion guards (IF NOT EXISTS / ON CONFLICT or equivalent), preview query before data changes, validation query after, rerun-safety note. No destructive SQL.

Also in this phase: append the five Genesis weapon emoji entries to `items.txt` (kiri, moira, sophia, atlas, titan) with their uploaded Discord emoji IDs.

Exit criteria: full SQL pack delivered for manual review. Owner runs scripts by hand.

## Phase 2: Reward Engine (Combat and Believer Level Rewards)

Goal: automatic, exactly-once rewards for every individual level gained.

- Build reusable reward-calculation functions for both reward tables (no duplicated bracket logic across commands)
  - Combat: L1-10 (100k + 1 Gold Chest), L11-20 (250k + 1 Boss Treasure Chest), L21-30 (500k + 2 BTC), L31-40 (1M + 3 BTC), L41-50 (5M + 1 Boss Golden Treasure Chest), per level
  - Believer: L1-10 (250k + 5 Gold Chests), L11-20 (500k + 5 BTC), L21-30 (1M + 10 BTC), L31-50 (1M + 5 BGTC), per level
- Grant per individual level reached, supporting multi-level jumps and bracket crossings (19 to 22 grants 20, 21, 22 individually)
- Credit via the same reliable pattern as quest rewards, inside a transaction with row locking; reward-tracking record is written only after Credux and inventory both succeed; full rollback on any failure
- Duplicate protection against repeated events, retries, concurrency, restarts, reconnects, and script reruns (backed by the unique constraints from Phase 1)
- Level-up response shows: previous level, new level, total Credux, chests grouped by type

Exit criteria: reward engine passes single-level, multi-level, bracket-crossing, duplicate, concurrency, and rollback tests.

## Phase 3: Retroactive Compensation

Goal: every existing user receives all missing level rewards, safely.

- Production-safe script with a required dry-run mode (dry run changes nothing)
- Per user: read Combat Level and Believer Level, check existing reward records, compute missing rewards from Level 1 upward, credit only what is missing, write reward records
- Batched processing with pagination or cursors, transactions per user or safe batch, one user's failure never corrupts another
- Idempotent and rerunnable; logs success, skipped, and failed users
- Final report: users checked, compensated, skipped, failed; total Credux, Gold Chests, Boss Treasure Chests, Boss Golden Treasure Chests distributed
- Deliver: script, dry-run command, production command, rollback/recovery instructions

Exit criteria: dry run on production data reviewed and approved before the real run.

## Phase 4: CRD Shop

Goal: CRD Shop live, cloned from the PvP Shop's design and interaction patterns.

- Products with numeric sequential IDs (shop IDs are NOT bag item IDs):
  1. Character Class Change, 5,000,000 Credux, grants inventory item `cc`
  2. Lesser Bag, 500,000, max 10 per calendar month
  3. Greater Bag, 2,000,000, max 5 per month
  4. Divine Bag, 4,000,000, max 3 per month
  5. Silver Chest, 5,000, max 10 per calendar day
  6. Gold Chest, 20,000, max 5 per day
  7. Diamond Chest, 5,000,000, max 1 per calendar week
- Quantity purchasing with strict validation (reject zero, negative, decimal, non-numeric); limits count total quantity, not command count
- Atomic purchase: check allowance, deduct Credux, grant item in one transaction; no deduction if grant fails; concurrency-safe via database-backed tracking (no in-memory-only cooldowns)
- Show remaining allowance and reset time using the project timezone convention (or documented UTC)
- Confirmation shows: product, quantity, price each, total spent, remaining balance, remaining allowance
- Shop embed shows: ID, name, price, limit, user's remaining allowance, reset period
- No duplicate Class Change entry

Exit criteria: shop passes purchase, limit, concurrency, and rollback tests.

## Phase 5: CRD Bag Categories and crd use Command

Goal: correct bag categories and a safe item-usage command.

Bag changes:

- CRD Bag Items: Character Class Change (`cc`), Sacred Relic (ID unchanged), Supreme Relic (ID unchanged)
- CRD Bag Chests: Diamond Chest, Genesis Chest (existing ID and behavior reused); Sacred and Supreme Relic removed from Chests
- Quantities preserved, no duplicate records, all display names, mappings, autocomplete, validation, and lookups updated
- Genesis Chest gets no shop price unless it already has one elsewhere

`crd use <id>` command:

- Resolves IDs against the CRD Bag Items registry only (IDs unique within category, not globally; same ID elsewhere is not a conflict)
- Accepts: `cc`, Sacred Relic ID, Supreme Relic ID, future CRD Bag Items
- Rejects: shop numeric IDs, chest IDs, bag IDs, currency IDs, other-category IDs, unknown IDs
- Ownership check, usability check, effect applied first, item consumed only after effect succeeds, never consumed on cancel/failure, concurrency-safe with row locking
- Success shows: item used, effect, quantity consumed, remaining quantity
- Help command and docs updated

Exit criteria: category tests and all crd use acceptance/rejection tests pass.

## Phase 6: Character Class Change Flow (crd use cc)

Goal: full class-change experience using a copied, independent embed configuration.

- Copy the Create Character embed configuration into a separate Change Character configuration (independent; editing one never affects the other; shared helpers/constants allowed)
- Header reads "Change Character"; instructions adapted for changing class; no creation logic runs
- Flow: verify `cc` ownership, open embed, present classes in the Create Character style, user selects, confirmation step showing current class + new class + warning + Confirm/Cancel, apply only after explicit confirmation, consume one `cc` only after the database update succeeds
- Item is never consumed on: cancel, close, timeout, selecting current class, invalid class, DB failure, dependent-update failure, incomplete confirmation
- Preserves: level, Combat EXP, Believer Level/EXP, Credux, items, chests, gender, skin tier; equipment follows existing validation rules (never deleted)
- Recalculates class-based avatar path; if Genesis skin selected, resolves `/skins/avatars/genesis/{gender}/genesis_{new_class}_{gender}.png`
- Invalidates only affected caches, never the global cache
- Atomic class update + item consumption with locking; safe against concurrent interactions and button retries

Exit criteria: all Section 14 tests pass, including config independence and consumption-safety cases.

## Phase 7: Genesis Avatar Assets

Goal: Genesis avatars render correctly for every class and gender.

- Path format: `/skins/avatars/genesis/{gender}/genesis_{class}_{gender}.png`, all lowercase
- Genders: female, male. Classes: archer, fighter, knight, mage, swordsman
- Register in the existing avatar/skin registry; selected by current class + gender, used only when Genesis skin is equipped; other tiers untouched; nothing hardcoded per class/gender
- Normalize to lowercase, validate class and gender against supported lists, prevent path traversal
- Use the existing storage base URL / CDN / R2 resolver; keep relative path separate from base URL; no hostname duplication
- Missing asset: fall back to the existing default avatar, log a concise warning with the missing relative path, never substitute a different class or gender, never expose storage errors
- Respect existing cache strategy: no stale-cache blocking of new uploads, no repeated downloads, no unbounded image cache, preserve TTLs and limits
- After class change: recalculate path with new class, preserve gender and skin selection, invalidate only the affected render

Exit criteria: path resolution, validation, fallback, and class-change integration tests pass.

## Phase 8: Celestial PvP Rank

Goal: new highest PvP rank at 20,000+ points.

- Central rank configuration update only (no scattered hardcoded checks)
- Boundaries: 19,999 = previous highest rank; 20,000 and above = Celestial; previous highest rank's range capped at 19,999; no gaps, no overlaps; lower thresholds preserved
- Integrated everywhere ranks appear: profile, leaderboard, matchmaking info, match-result embeds, rank-up/down notifications, icons/emojis, statistics, shop restrictions, seasonal rewards, reward previews, admin commands, help, autocomplete, logs, role/badge assignment
- If rank enums/indexes exist: append Celestial after current highest, preserve ordering, do not renumber stored IDs
- Missing Celestial visual asset: use the existing safe fallback, report it in the final summary

Exit criteria: all boundary tests pass (19,999 / 20,000 / 20,001 / very high value / no double-match / no gap).

## Phase 9: Full Test Pass

Run and pass every test group from Section 12 plus Section 14 and 15 test lists:

- Combat Level rewards, Believer Level rewards (single, multi, brackets, L50, duplicates, concurrency, rollback)
- Compensation (all user shapes, partial, full, dry run, rerun, isolated failures, bracket totals)
- CRD Shop (valid, quantity, invalid ID/quantity, insufficient funds, daily/weekly/monthly limits, allowance and reset math, concurrency, rollback)
- CRD Bag categories and quantity preservation
- crd use (all accept/reject cases, cancel, failure, duplicates, cross-category same-ID)
- Class change (config independence, consumption safety, preservation, concurrency)
- Genesis avatars (paths per class/gender, normalization, invalid rejection, fallback, class-change update, no global cache flush)
- Celestial boundaries

## Phase 10: Final Deliverables and Rollout

Deliver everything from Section 13:

1. Modified-files summary
2. Implementation-approach summary
3. All migrations and manual SQL scripts (separated: schema vs data)
4. Compensation script + dry-run command + production command
5. Rollback and recovery instructions
6. CRD Shop reset periods and timezone behavior
7. Final CRD Shop product registry
8. Final CRD Bag Items registry and IDs
9. Final CRD Bag Chests registry and IDs
10. Genesis avatar path resolver implementation
11. List of Genesis avatar files detected/registered
12. Test results
13. Assumptions made where existing behavior was unclear
14. Confirmation that unrelated commands, quest rewards, balances, inventories, progression, and other skin tiers were untouched

Rollout order (recommended):

1. Owner manually runs schema migrations (001, 002, 003, 007)
2. Deploy code (reward engine, shop, bag, crd use, class change, avatars, Celestial)
3. Owner manually runs data scripts (004 category migration, 005/006 Celestial, 008 Genesis weapons)
4. Upload Genesis avatar and weapon images to storage; add emoji IDs to items.txt
5. Compensation dry run, review report, then production compensation run
6. Verify with the validation queries from each SQL script

---

# Claude Code Prompt

Copy everything between the lines below into Claude Code. Attach or place these three files in the repository root or a `/specs` folder first: `spec_document_1.txt` (Sections 1-13), `spec_document_2.txt` (Sections 14-16), and `genesis_tier_weapons.md`.

---

You are implementing a major update to my Discord RPG bot. The full requirements are in three spec files in this repository: `specs/spec_document_1.txt` (Sections 1-13: level rewards, compensation, CRD Shop, CRD Bag, crd use command, Genesis avatar assets, database, performance, testing, deliverables), `specs/spec_document_2.txt` (Sections 14-16: Character Class Change embed and flow, Celestial PvP rank, manual-SQL-only policy), and `specs/genesis_tier_weapons.md` (the five Genesis tier weapons with their passives, lore, and weapon_roster insert scripts). Read all three files completely before writing any code. They are the source of truth; if this prompt and the specs ever conflict, follow the specs.

Work in this phase order, and pause at the end of each phase to show me a summary of what you found or changed before continuing:

Phase 0, Discovery: Inspect the entire codebase and database schema before changing anything. Map the command architecture, reward system, inventory system, PvP Shop implementation, CRD Bag implementation, character class system, avatar renderer, asset-loading logic, caching strategy, and transaction patterns. Identify the existing quest-reward crediting pattern, the existing timezone or reset convention, and the current IDs for Sacred Relic, Supreme Relic, Genesis Chest, and Diamond Chest if it exists. Write your findings to `docs/discovery_notes.md` and list every assumption. Do not invent table or column names; use only what you find.

Phase 1, SQL scripts: Produce all database changes as manual SQL script files that I will review and run myself. Never execute SQL against my database, never apply data changes through application startup code, and never add automatic compensation on startup. Separate schema migrations from data updates. Follow the file organization and per-script requirements in Section 16 (purpose comments, transaction blocks, duplicate guards, preview queries, validation queries, rollback sections, rerun-safety notes). Include a script for the five Genesis weapons from genesis_tier_weapons.md, adapted to the real weapon_roster schema you discovered, and note that items.txt must receive the five weapon emoji entries.

Phase 2, Reward engine: Implement automatic Combat Level and Believer Level rewards exactly per Sections 1-3, using reusable reward-calculation functions and the same crediting pattern as quest rewards, with per-level granting, bracket-crossing support, transactional exactly-once semantics, and the level-up summaries described in the specs.

Phase 3, Compensation: Build the retroactive compensation script per Section 4 with dry-run mode, batching, per-user transactions, idempotency, and the full result report. Provide the dry-run command, production command, and recovery instructions.

Phase 4, CRD Shop: Implement the CRD Shop per Section 5, cloning the existing PvP Shop's embed design, pagination, buttons, and interaction behavior, with the seven products, numeric sequential shop IDs, database-backed purchase limits, atomic purchases, and allowance displays.

Phase 5, CRD Bag and crd use: Apply the category changes from Sections 6-7 and implement `crd use <id>` per Section 8, resolving IDs against the CRD Bag Items registry only, with all the acceptance, rejection, ownership, effect-before-consume, and concurrency rules.

Phase 6, Class change: Implement the `crd use cc` flow per Section 14. Copy the Create Character embed configuration into a fully independent Change Character configuration, keep the same visual style with the header changed to "Change Character", implement the select-confirm-apply-consume flow, never consume the item on cancel, timeout, current-class selection, invalid selection, or any failure, preserve all progression and inventory, and update the Genesis avatar path after a successful change.

Phase 7, Genesis avatars: Implement the Genesis avatar asset integration per Section 9 using the exact path format `/skins/avatars/genesis/{gender}/genesis_{class}_{gender}.png` with lowercase normalization, validation against the supported class and gender lists, path-traversal prevention, the existing asset resolver and caching strategy, the default-avatar fallback with a concise warning log for missing assets, and class-change integration.

Phase 8, Celestial rank: Add the Celestial PvP rank per Section 15 in the central rank configuration, with 20,000 points or higher qualifying, the previous highest rank capped at 19,999, no gaps or overlaps, integration into every listed PvP surface, and safe enum or index handling.

Phase 9, Tests: Add or update every test listed in Sections 12, 14, and 15, and run the full test suite. Fix failures before proceeding.

Phase 10, Deliverables: Produce everything listed in Section 13, including the modified-files summary, all SQL scripts, the compensation commands, rollback instructions, the final registries, the avatar resolver, test results, assumptions, and confirmation that unrelated behavior was not changed.

Hard rules for the entire task: reuse existing patterns instead of inventing new ones; do not change unrelated behavior, progression logic, balances, inventories, or other skin tiers; avoid unbounded in-memory structures and do not load all users into memory; keep everything concurrency-safe and idempotent; and do not only produce a plan, actually implement the changes.

---
