# Activity Log

## 2026-08-03 - Monthsary update planning

- Read `AGENT.md`, the Monthsary Update brief, and Revision 1 feedback.
- Completed the Phase 1 repository inventory for sections A-F.
- Collected read-only production row counts, high-streak query timings, and Medusa data.
- Revised `docs/08032026_update/implementation-plan.md`; no implementation code or migration files were changed.
- Rendered actual-size and 2x record-box fitting samples under `docs/08032026_update/render-samples/`.
- Regenerated the samples after review with value/rank caps reduced by 3px; label sizes remain unchanged.
- Read Phase 1 Revision 2 review; verified stale Echo rows, result domains, simulated high/current streak consistency, and current boss lifecycle with read-only production checks.
- Added the current-vs-proposed record sizing comparison and documented calamity expiry, Medusa's exact `no_immunities` flag, Bakunawa's fixed-level stat convention, and the one-pending queue index.
- Read Phase 1 Revision 3; changed calamity expiry to idle-based, adopted adaptive uniform F sizing, selected announcement-only escaped calamities, and added a queue cancellation decision.
- Began Phase 2 Section 1: added the E schema foundation migration, updated D supporter values, and implemented the idempotent Eternal Custom Deity Token grant with bag-row upsert. Production migration application is still pending deployment review.
- Added the explicit Section 3 command contract: `crd dev spawnboss calamity <name> confirm:SPAWN_BOSS:<guild_id>`.
- Read the Phase 2 Section 1 review; cleaned stale Revision 2 gate language, removed the duplicate `dev.js` plan bullet, documented manual migration order and confirmation-token rationale, and kept Section 2 paused.
- Attempted the required throwaway concurrent Postgres test. `initdb` succeeded, but the sandbox could not bind the throwaway server to loopback (`Permission denied`); the existing local service requires unavailable authentication. No production database was used, so Section 1 remains unsigned pending a disposable local Postgres connection/runtime.
- Read the Section 1 second-pass review; reran the disposable-cluster start attempt on `0.0.0.0:55432`, which also failed with PostgreSQL `could not bind IPv4 address "0.0.0.0": Permission denied`. Reran the F measurements from the true configured value sizes using DejaVu Sans Bold, 6px inset, and 0.5px steps: fallback 16→12.5px, Greek 17→13px, Founder 15→15px, and widest tester 17→17px for the worst-case row; all-fits rows remain at configured sizes.
- Recorded reviewer-supplied read-only production evidence for `users_bag_pkey`, the foreign key, and 24 rows/24 distinct users. Completed the Eternal transaction-boundary walkthrough: one pool client, one `BEGIN`/`COMMIT`, same client for claim and bag upsert, and same-client rollback on error. Section 1 is signed off for progression; the live concurrency test remains deferred until scratch Postgres is available, with scratch rehearsal flagged before Section A.

## 2026-08-04 - Monthsary update completion and event activation

- Completed Monthsary Sections 1-5: custom content/ticketing, boss queue/runtime state, user presets, character-record highs and adaptive panel text. The deployment handover records the migration order, dependencies, manual assets, verification commands, and the deferred legacy-loadout drop.
- Added the Monthsary event Phase 1 implementation: additive attendance and quest-claim tables with RLS, idempotent daily attendance, three-quest Sacred Relic claims, and the seven-day reward schedule. Added the event migration and read-only verification migration.
- Activated the fixed event window for `Asia/Manila`: August 5, 2026 at 00:00 through August 12, 2026 at 00:00 (exclusive), with `EVENT_ENABLED = true`. `crd daily` and quest completion use the event claim guards so repeated claims do not duplicate rewards.
- Fixed calamity development bosses to use the regular two-attacks-per-user limit; ordinary development bosses remain unlimited. Deployment startup refreshes active boss messages, and the boss render supports Bakunawa lore and four-line passive text.
- Made all bosses immune to target-max-HP percentage damage, including legacy roster rows. Badiang Stalk now applies neither Rupture nor Venom to bosses. The battle self-test completed with `419 passed, 0 failed`.
- Fixed supporter badge rendering so a failed remote `HEAD` probe no longer suppresses the configured badge image request. Profile and stats cache signatures/revisions were updated accordingly.
- The event merge is `15ddc06`; activation and the completed event/hotfix payload are at `8ab64d2`. Current pointers are `main` and `event/monthsary-2026-08` at `8ab64d2`, with `backup/pre-event-monthsary` at `667be3a`.
- `20260803_05_drop_legacy_loadout.sql` remains intentionally unrun and is deferred to its own deploy after the production preset/code/catalog preconditions pass.
