# Monthsary Update Deployment Handover

## Deploy sequence

- [ ] 1. Run `20260803_02_custom_content_tickets.sql` - token bag columns, ticket/grant tables, constraints, index, and RLS.
- [ ] 2. Run `20260803_02_custom_content_tickets_verify.sql` - read-only verification for step 1.
- [ ] 3. Run `20260803_03_boss_spawn_source_queue.sql` - spawn source and recoverable calamity queue with RLS.
- [ ] 4. Run `20260803_06_boss_level_nullable.sql` - make retained boss-level columns nullable.
- [ ] 5. Run `20260803_07_boss_runtime_state.sql` - durable attack time and passive state.
- [ ] 6. Run `20260803_08_boss_queue_recovery_rls.sql` - idempotent lease-column/RLS repair for databases that already ran 03.
- [ ] 7. Run `20260803_01_user_presets_preflight.sql` - require `stale_echo_rows = 0`.
- [ ] 8. Run `20260803_01_user_presets.sql` - create/backfill two presets and active-slot pointer.
- [ ] 9. Run `20260803_01_user_presets_verify.sql` - require all five results = `0`.
- [ ] 10. Run `20260803_04_character_record_highs.sql` - add/backfill raid and ranked high-watermarks.
- [ ] 11. Deploy the complete code payload: Sections A, B, C, D, E, and F together.
- [ ] 12. Run `npm run preflight:prod`, then complete the checklist below.

Do not run `20260803_05_drop_legacy_loadout.sql` in this deploy.

## Migration dependencies

| Migration | Dependent code |
|---|---|
| `02` | B/D/E: avatar product, bag tokens, redemption, tickets, Eternal/dev grants |
| `03` + `08` | C: calamity queue, lease recovery, cancel, cooldown-safe consumption |
| `06` + `07` | C: fixed boss stats, no boss-level writes/UI, durable Bakunawa state |
| `01` | A: preset accessor, creation, equip/deity/summon/sell/dev/reset paths |
| `04` | F: record panels and transactional raid/ranked high-watermarks |
| `05` | Deferred removal of six legacy loadout columns only |

## Manual assets

- [ ] Verify these `assets/data/game_items.txt` rows:

```text
Custom Avatar | 'custom_avatar' | '1533790198284947467'
Custom Deity | 'custom_deity' | '1533790200382226513'
```

- [ ] Verify the Custom Avatar and Custom Deity Discord icons use those IDs.
- [ ] Verify CDN object `monsters/boss/bakunawa.png`.
- [ ] Upload changed profile/stats layout JSON only if local metadata/coordinates must reach the CDN; runtime reads CDN layouts when `ASSET_BASE_URL` is set.

## Post-deploy verification

- [ ] `npm run preflight:prod`
- [ ] `npm run selftest:full`
- [ ] Re-run `20260803_02_custom_content_tickets_verify.sql`; both tables, both bag columns, constraints, index, and RLS pass.
- [ ] Re-run `20260803_01_user_presets_verify.sql`; all five counts are `0`.
- [ ] Confirm RLS for `user_presets`, `tickets`, `supporter_item_grants`, and `boss_spawn_queue`.
- [ ] Confirm the character-record backfill query returns `violations = 0`.
- [ ] Confirm catalog search of `pg_proc`, `pg_trigger`, `pg_views`, and `pg_matviews` returns no unmanaged legacy-loadout references.
- [ ] `crd avatar shop` - public 10-row list is unchanged; Preview opens privately and wraps Previous/Next.
- [ ] In preview, test owned, affordable, and unaffordable avatar Buy states; buy re-renders as Owned.
- [ ] `crd avatar buy at`; `crd use at`; record the returned avatar ticket ID.
- [ ] `crd use dt`; record the returned deity ticket ID.
- [ ] `crd supporter tickets`; exercise all four categories.
- [ ] `crd update ticket <ticket_id> in_progress`; repeat it; then `crd update ticket <ticket_id> done`; confirm Ongoing/no-op/Done.
- [ ] On a test account, run `crd dev sub <discord_id> eternal` three times; confirm +60 supporter tokens and +1 deity token each run with distinct refs/dev logs.
- [ ] `crd preset`; `crd equip preset 2`; repeat; `crd equip preset 1`; verify empty/already-using/wearing replies.
- [ ] Equip gear/deities on each preset; sell an inactive-preset item; verify the preset/field warning.
- [ ] `crd stats` and `crd profile`; verify active preset text, `Character Records`, six labels, and adaptive values.
- [ ] Complete one raid and one ranked result; verify current/highest streak and win-rate changes.
- [ ] Queue a calamity behind an active boss; verify it waits for the 15-minute cooldown.
- [ ] `crd dev cancelcalamity <queue_id>`; verify pending or expired claims cancel, active claims do not.
- [ ] `crd dev spawnboss calamity Bakunawa confirm:SPAWN_BOSS:<guild_id>`; verify fixed stats, image, thresholds, and Eclipse.

## Preconditions for migration 05

- [ ] A code has run in production without errors.
- [ ] All five production preset verification queries return `0`.
- [ ] Production catalog check for functions, views, materialized views, and triggers returns no rows.
- [ ] `rg` confirms no runtime code reads `active_deity_id`, `active_deity_id_2`, `active_deity_id_3`, `active_echo_deity_id`, `equipped_armor_id`, or `equipped_weapon_id` from `user_character`.
- [ ] Run `20260803_05_drop_legacy_loadout.sql` alone in a later, explicitly approved deploy.

## Post-handover Monthsary event update

### Additional run order

- [ ] Run `20260804_01_monthsary_event.sql` after the Monthsary migrations and before deploying the event code.
- [ ] Run `20260804_01_monthsary_event_verify.sql`; both event tables must pass with RLS enabled and no duplicate claim keys.
- [ ] Deploy commit `8ab64d2`; it contains the event implementation, activation, and the completed Monthsary hotfixes.

### Event window and behavior

- Start: `2026-08-05 00:00 PHT`; end: `2026-08-12 00:00 PHT` (exclusive).
- `EVENT_ENABLED = true`; the schedule is fixed in `src/config/monthsaryEvent.js`.
- `crd daily` grants regular attendance and Monthsary attendance in one transaction.
- Completing all three daily quests grants one Sacred Relic through the event claim guard.
- Attendance rewards are one Sacred Relic plus one Boss Treasure Chest on days 1-6; day 7 also grants one Boss Golden Chest.
- Claim tables are additive and remain after a code rollback.

### Included hotfixes

- Calamity dev bosses use the regular two-attacks-per-user daily cap; ordinary dev bosses remain unlimited.
- Boss lore and passive rendering support Bakunawa's full lore/passive text, including the four-line passive area and deployment refresh.
- All bosses, including legacy roster rows, block target-max-HP percentage damage; Badiang Stalk applies neither Rupture nor Venom to bosses.
- Supporter badges are no longer suppressed when a remote asset `HEAD` probe fails; the renderer attempts the actual image request.

### Branch state for event testing

- `main` → `8ab64d2` (`15ddc06` event merge plus activation commit).
- `event/monthsary-2026-08` → `8ab64d2`.
- `backup/pre-event-monthsary` → `667be3a`.
- `20260803_05_drop_legacy_loadout.sql` remains unrun.
