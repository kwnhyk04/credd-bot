# Monthsary Update - Implementation Plan

Status: Sections A-F are code-complete locally; production deployment and the separately gated `20260803_05_drop_legacy_loadout.sql` remain outstanding.

This plan covers only the permanent A-F update in `monthsary-update.md`. It does not cover `monthsary-event.md`.

## Revision 1 decisions and live evidence

The following decisions are approved and no longer open:

- Use the six labels and left-to-right mapping `BEST RAID STK`, `RAID STREAK`, `RANK`, `RANK #`, `BEST RANK STK`, `WIN RATE` across every profile/stats panel.
- Calculate a whole-percent win rate from `ranked_logs` and render `-` for zero ranked duels.
- Reconstruct historical streak highs from `raid_logs` and `ranked_logs` and update high-watermarks inside the existing result transactions.
- Rename all four hardcoded panel headings to `Character Records`.
- Allow switching to an empty preset and warn: `Preset 2 is empty. You now have nothing equipped.`
- Natural and dev calamity spawns have identical fixed stats. Only their chest payout differs.
- Eternal Custom Deity Token grants require a database-enforced idempotency key.

Read-only production evidence collected on 2026-08-03:

- `raid_logs`: 30,381 rows, 9,920 kB total relation size.
- `ranked_logs`: 16 rows, 56 kB total relation size.
- `user_character`: 24 rows.
- On PostgreSQL 17.6, `EXPLAIN ANALYZE` of the exact historical-high query completed in 147.602 ms for raids and 0.176 ms for ranked, returned 17/1 user rows, and used no temporary blocks.
- Live Medusa is `mob_roster.mob_id=38`, `mob_type='boss'`, `skill_key='stone_stare'`, `immunity_tags=['all_debuffs']`, and `special_flags={'retune_v6':true}`.

The backfill does not need batching at the current live size. Run it off-peak in one transaction with a short `lock_timeout` and bounded `statement_timeout`; it will briefly row-lock at most the character rows receiving highs. Re-run the counts and read-only timing immediately before production in case traffic has changed materially.

Rendered F samples are stored beside this plan:

- `render-samples/character-record-box-samples-fitted-actual.png` - actual configured pixels.
- `render-samples/character-record-box-samples-fitted-2x.png` - 2x nearest-neighbor inspection copy.

## Revision 2 review evidence and decisions

Read-only production checks run on 2026-08-03:

- The pre-migration stale-Echo query returned `stale_echo_rows = 0`.
- `raid_logs.result` contains `loss = 277` and `win = 30,104`; `ranked_logs.result` contains only `win = 16`.
- The read-only post-backfill simulation compared reconstructed highs with the exact current-streak definition used by `profile.js`/`stats.js`: `violations = 0`, `max_current_minus_highest = 0`, across 48 user/record comparisons.
- `boss_state` returned no rows at check time, so no active production boss was present. Repository lifecycle inspection found `ACTIVE_BOSS_EXPIRES_AT_SQL = NOW() + INTERVAL '100 years'`, active bosses remain until defeated, and `expireBoss` is a no-op. Without a timeout, an unkillable calamity would block that guild's spawn cycle.

The Phase 2 decisions retained from Revision 2 are:

- Keep the preflight stale-Echo query outside the A migration transaction. The current zero result is safe; the migration must fail/stop if a future preflight finds stale rows. The backfill also defensively writes `NULL` for an Echo pointer not matching slot 2/3.
- Use adaptive uniform record-value sizing: measure all six values, use the smallest fitted size for every value in that row, preserve the configured size when all values fit, and enforce the 12px floor. The global three-pixel and independent per-box policies are rejected.
- Use idle-based calamity expiry: two hours since the last recorded attack, with attack-time refresh inside the transaction and an atomic expiry-sweep claim. On expiry, mark the boss `escaped`, set the terminal timestamp, and allow the existing 15-minute cooldown to resume the guild cycle. The current 100-year active lifetime is not acceptable for a 5% calamity rate.
- Use the exact Medusa flag `no_immunities`: manual JSON is `{"retune_v6": true, "no_immunities": true}`. The planned battle-engine check reads `specialFlags.no_immunities === true` to bypass generic boss, HP-DOT, and status immunity handling.
- Bakunawa uses fixed authored base values. Set all per-level fields to zero; no boss level is supplied or displayed.
- Add the one-pending-calamity partial unique index and a clear already-queued response.

## Revision 3 approvals and Phase 2 authorization

Revision 3 approves the stale-Echo, Medusa, Bakunawa, high-watermark, result-domain, queue-index, and calamity terminal-state decisions above. Phase 2 is authorized in this order, one reviewable section at a time:

1. E schema foundation plus D supporter values/grants
2. B plus remaining E avatar shop and ticket behavior
3. C boss tiers and queue behavior
4. A character presets as a two-migration cutover
5. F records and renderers

Do not run `20260803_05_drop_legacy_loadout.sql` until the A code sweep is deployed, all verification queries return zero, and live `pg_proc`, `pg_trigger`, `pg_views`, and `pg_matviews` checks are clean.

Migration application is manual. Repository review found no runner that sweeps and sorts this Monthsary migration set, so numeric suffixes identify the owning section rather than execution order. The exact deployment order, including verification scripts and the `06`-`08` compatibility migrations, is maintained in `docs/08032026 update/deployment-handover.md`. Keep `20260803_05_drop_legacy_loadout.sql` as the separately gated cleanup migration described above.

### Phase 2 Section 1 implementation record: E schema foundation plus D

Implemented in the workspace:

- Added `scripts/migrations/20260803_02_custom_content_tickets.sql` with `custom_avatar_token`, `custom_deity_token`, `tickets`, and the database-unique `supporter_item_grants` claim table. The migration has not been applied to production.
- Changed supporter values to Believer 10/month, Chosen 20/month, and Eternal 60 one-time.
- Added transaction-safe bag-row upsert helpers. Eternal's Custom Deity Token claim is inserted with `ON CONFLICT DO NOTHING`; only the returned claim increments the bag.
- Updated the supporter documentation.

Section 1 verification passed `node --check` for changed JavaScript and a mock transaction test proving first-grant claim/upsert plus replay no-op. Reviewer-supplied read-only production evidence also confirmed `users_bag_pkey | p | PRIMARY KEY (discord_id)`, `users_bag_discord_id_fkey | f | FOREIGN KEY (discord_id) REFERENCES users(discord_id)`, and `total_rows = 24` with `distinct_users = 24`. Therefore `ON CONFLICT (discord_id)` is valid and the one-row-per-user invariant holds for the existing rows.

### Section 1 transaction-boundary walkthrough

The Eternal grant path uses one pool client and one transaction throughout:

1. `applySubscribe` acquires `const client = await pool.connect()` and begins the transaction with `await client.query('BEGIN')` at `src/engine/supporterEntitlements.js:430-432`. Its entitlement materialization also calls the transaction-taking `syncSubscriptionEntitlementsTx(client, ...)` at lines 487-489, not the public pool-owning wrapper.
2. The Eternal branch calls `grantBagItemOnceTx(client, ...)` at `src/engine/supporterEntitlements.js:503-510`; it passes the same transaction client, not the pool.
3. `grantBagItemOnceTx` inserts the idempotency claim using `client.query` at `src/engine/supporterEntitlements.js:130-151`. Only when `claim.rowCount !== 0` does it call `upsertBagItemTx(client, ...)` at line 151. The upsert uses that same client at `src/engine/supporterEntitlements.js:113-127`.
4. There is no intermediate `COMMIT`, separate pool acquisition, or helper that changes clients between the claim and bag statements. The awaits are `client.query` awaits inside the open transaction; the helper returns before `applySubscribe` reaches its commit.
5. `applySubscribe` commits with `client.query('COMMIT')` at `src/engine/supporterEntitlements.js:520`. Any error enters the catch at lines 522-524, which issues `client.query('ROLLBACK')`; the finally block releases that same client at lines 525-526. A rollback therefore discards both the claim and bag upsert together.

The Section 2 implementation record below contains the completed Avatar Token purchase and ticket-redemption transaction walkthroughs.

The approved confirmation token is `crd dev spawnboss calamity <name> confirm:SPAWN_BOSS:<guild_id>`; it makes the high-impact spawn explicit and prevents accidental repeated invocations.

## Repository corrections and assumptions

The brief uses a few names that do not exist in this repository:

- The live table is `user_character`, not `user_characters`.
- `user_character.discord_id` is `varchar(20)`, the primary key, and a foreign key to `users(discord_id)`. The current model permits one character per Discord user.
- The current weapon column is `equipped_weapon_id`. There are no runtime or schema references to a bare `equipped_weapon` column.
- The current user-owned equipment tables are `user_weapons(weapon_id)` and `user_armors(armor_id)`. Active deity pointers target `user_deities(user_deity_id)`.
- The bot uses the `pg` client directly against Postgres hosted by Supabase. There are no committed generated Supabase TypeScript database types.
- The canonical schema snapshots are `scripts/schema.sql` and `scripts/production-consolidated-schema.sql`; incremental changes belong under `scripts/migrations/`.
- Existing pre-implementation working-tree changes were preserved: `src/casino/payoutTables.js` is modified and `CLAUDE.md` is untracked.

The proposed Phase 2 order is dependency-aware:

1. E database foundation plus D - add the bag/grant tables first, then change supporter values and the Eternal item grant
2. B + remaining E - avatar shop, custom-token redemption, and ticket queue UI
3. C - boss tier and queue reorganization
4. A - character presets, deployed in a two-migration cutover
5. F - shared character-record data and rendering changes

No phase should drop the legacy loadout columns until the A4 code sweep has been deployed and verified in production.

## A. Character presets

### Findings and complete loadout scope

`user_character` has one row per user. The current loadout columns are:

| Current column | Current meaning | Target |
|---|---|---|
| `active_deity_id` | deity slot 1 | `user_presets.equipped_deity_1_id` |
| `active_deity_id_2` | deity slot 2 | `user_presets.equipped_deity_2_id` |
| `active_deity_id_3` | deity slot 3 | `user_presets.equipped_deity_3_id` |
| `active_echo_deity_id` | selected Echo Blessing source from slot 2/3 | `user_presets.equipped_echo_deity_id` |
| `equipped_armor_id` | equipped armor | `user_presets.equipped_armor_id` |
| `equipped_weapon_id` | equipped weapon | `user_presets.equipped_weapon_id` |

Recommendation: move `active_echo_deity_id` into `user_presets` as `equipped_echo_deity_id`. Echo is not account-global state: `crd deity echo` only accepts a deity currently occupying slot 2 or 3, combat reads it as the secondary blessing source, and deity equip/unequip clears it when its source leaves those slots. Leaving it on `user_character` would either attach a stale Echo blessing after a switch or force the switch command to clear it, losing the former preset's selection when the user switches back. Preset-local storage preserves the complete combat loadout and restores the correct Echo choice in both directions.

All runtime references found:

- Core/stat reads: `src/engine/statAssembly.js:242-280` (`buildPlayerFighter`); `src/commands/rpg/profile.js:55-92`; `src/commands/rpg/stats.js:55-98,210-214`.
- Deity-slot reads: `src/commands/rpg/deity.js:907,952-963,975-980,1004-1010,1027-1039,1104-1121,1278-1281`; `src/engine/summonEngine.js:102-110,181`.
- Equipment reads: `src/commands/rpg/bag.js:130-142,258-270`; `src/commands/rpg/sell.js:74-79,156-172`.
- Echo-specific reads/writes: `src/commands/rpg/deity.js:975-981,1004-1014,1027-1066,1104-1121,1278-1284`; `src/commands/rpg/stats.js:58,94-95,210-233`; `src/engine/statAssembly.js:263-264,277-278,318-328`; `src/commands/rpg/dev.js:500-501,538`.
- Weapon/armor/deity writes: `src/commands/rpg/create.js:260-271`; `src/commands/rpg/equip.js:81-103`; `src/commands/rpg/deity.js:985-987,1014,1064-1066`; `src/engine/summonEngine.js:237-243`; `src/commands/rpg/dev.js:498-507,533-538`.
- Operational/test writes: `scripts/v5_wipe_test_gear.js:17-22` and `scripts/patch3-deity-backup-wipe.sql:24-32`.
- Schema/preflight references: `scripts/schema.sql:1124-1153,2641-2701`; `scripts/production-consolidated-schema.sql:442-467`; `scripts/credd_schema_v4.sql:166-204`; `scripts/production-preflight.js:80-98`.

There are no repository-defined PL/pgSQL functions, triggers, views, materialized views, or RLS policies referencing these columns. Before the drop migration, run a live Supabase catalog check for `pg_proc`, `pg_trigger`, `pg_views`, and `pg_matviews`, because unmanaged production objects are not represented by the repository snapshots.

`combat_level` remains on `user_character`. `src/engine/statAssembly.js:115-169` applies class base-plus-per-level scaling, and `buildPlayerFighter` currently loads combat level plus all equipment/deities in one joined query. The join itself is not an N+1 query. `accumulateRuneStats` is a separate socketed-rune query and is unrelated to the preset join.

### Recommended accessor boundary

Add `src/engine/loadout.js` with:

- `getActiveLoadout(db, discordId)`: one query joining `user_character` to `user_presets` on `(discord_id, active_preset_slot)` and joining the selected weapon, armor, three deity pointers, and preset-local Echo source.
- `updateActiveLoadout(dbOrClient, discordId, changes)`: whitelist the six writable fields, update only the selected `user_presets` row, set `updated_at`, and return the updated loadout.
- `setActivePresetSlot(dbOrClient, discordId, slot)`: the pointer update is the one intentional write to `user_character`; it must validate that the target preset exists before changing the pointer.

All command and engine reads/writes must use these functions. No command should interpolate a preset column or query `user_presets` directly. `updateActiveLoadout` must be used by equip, deity, summon auto-selection, and dev reset paths. A read after a successful write is required for user-visible confirmation and for stat assembly that immediately follows an equip.

### Exact schema and migration SQL

Run `scripts/migrations/20260803_01_user_presets_preflight.sql` first, then apply `scripts/migrations/20260803_01_user_presets.sql`. Verify with `scripts/migrations/20260803_01_user_presets_verify.sql` before the runtime cutover and before any legacy column is dropped.

```sql
-- Manual deployment position 4 of Monthsary Phase 2: A character presets.
BEGIN;

CREATE TABLE IF NOT EXISTS public.user_presets (
    id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    discord_id varchar(20) NOT NULL
        REFERENCES public.users(discord_id) ON DELETE CASCADE,
    slot smallint NOT NULL,
    name varchar(32),
    equipped_deity_1_id integer
        REFERENCES public.user_deities(user_deity_id) ON DELETE SET NULL,
    equipped_deity_2_id integer
        REFERENCES public.user_deities(user_deity_id) ON DELETE SET NULL,
    equipped_deity_3_id integer
        REFERENCES public.user_deities(user_deity_id) ON DELETE SET NULL,
    equipped_echo_deity_id integer
        REFERENCES public.user_deities(user_deity_id) ON DELETE SET NULL,
    equipped_armor_id varchar(8)
        REFERENCES public.user_armors(armor_id) ON DELETE SET NULL,
    equipped_weapon_id varchar(8)
        REFERENCES public.user_weapons(weapon_id) ON DELETE SET NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT user_presets_slot_check CHECK (slot IN (1, 2)),
    CONSTRAINT user_presets_echo_source_check CHECK (
      equipped_echo_deity_id IS NULL
      OR equipped_echo_deity_id IS NOT DISTINCT FROM equipped_deity_2_id
      OR equipped_echo_deity_id IS NOT DISTINCT FROM equipped_deity_3_id
    ),
    CONSTRAINT user_presets_discord_slot_key UNIQUE (discord_id, slot)
);

CREATE INDEX IF NOT EXISTS idx_user_presets_discord_id
    ON public.user_presets(discord_id);

ALTER TABLE public.user_presets ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.user_character
    ADD COLUMN IF NOT EXISTS active_preset_slot smallint NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_character_active_preset_slot_check'
  ) THEN
    ALTER TABLE public.user_character
      ADD CONSTRAINT user_character_active_preset_slot_check
      CHECK (active_preset_slot IN (1, 2));
  END IF;
END $$;

INSERT INTO public.user_presets
  (discord_id, slot, name,
   equipped_deity_1_id, equipped_deity_2_id, equipped_deity_3_id,
   equipped_echo_deity_id, equipped_armor_id, equipped_weapon_id)
SELECT discord_id, 1, 'Main',
       active_deity_id, active_deity_id_2, active_deity_id_3,
       CASE
         WHEN active_echo_deity_id IS NOT NULL
          AND (active_echo_deity_id IS NOT DISTINCT FROM active_deity_id_2
            OR active_echo_deity_id IS NOT DISTINCT FROM active_deity_id_3)
         THEN active_echo_deity_id
         ELSE NULL
       END,
       equipped_armor_id, equipped_weapon_id
  FROM public.user_character
ON CONFLICT (discord_id, slot) DO NOTHING;

INSERT INTO public.user_presets (discord_id, slot, name)
SELECT discord_id, 2, 'Preset 2'
  FROM public.user_character
ON CONFLICT (discord_id, slot) DO NOTHING;

COMMIT;
```

The migration intentionally backfills every `user_character` row, not every `users` row. Accounts without a character do not yet have a loadout and are handled by character creation. `src/commands/rpg/create.js` must create both preset rows in the same character-creation transaction for new characters.

Run this preflight before `BEGIN` and before applying the migration. It must return zero; if it does not, stop and either clean the stale rows first or explicitly accept nulling those Echo pointers during backfill. The current production result is zero.

```sql
SELECT count(*) AS stale_echo_rows
  FROM public.user_character
 WHERE active_echo_deity_id IS NOT NULL
   AND active_echo_deity_id IS DISTINCT FROM active_deity_id_2
   AND active_echo_deity_id IS DISTINCT FROM active_deity_id_3;
```

The backfill should still use a defensive `CASE`: copy `active_echo_deity_id` only when it matches slot 2 or 3, otherwise write `NULL`. That protects the transaction from a stale row introduced between the preflight and migration without weakening the database constraint.

Verification must run before any legacy column is dropped:

```sql
-- Both slots must exist for every character.
SELECT count(*) AS missing_preset_rows
  FROM public.user_character c
 WHERE NOT EXISTS (
         SELECT 1 FROM public.user_presets p
          WHERE p.discord_id = c.discord_id AND p.slot = 1
       )
    OR NOT EXISTS (
         SELECT 1 FROM public.user_presets p
          WHERE p.discord_id = c.discord_id AND p.slot = 2
       );

-- Slot 1 must exactly match the legacy loadout.
SELECT count(*) AS slot1_mismatches
  FROM public.user_character c
  JOIN public.user_presets p
    ON p.discord_id = c.discord_id AND p.slot = 1
 WHERE p.equipped_deity_1_id IS DISTINCT FROM c.active_deity_id
    OR p.equipped_deity_2_id IS DISTINCT FROM c.active_deity_id_2
    OR p.equipped_deity_3_id IS DISTINCT FROM c.active_deity_id_3
    OR p.equipped_echo_deity_id IS DISTINCT FROM c.active_echo_deity_id
    OR p.equipped_armor_id   IS DISTINCT FROM c.equipped_armor_id
    OR p.equipped_weapon_id  IS DISTINCT FROM c.equipped_weapon_id;

-- The active pointer must resolve.
SELECT count(*) AS broken_active_pointers
  FROM public.user_character c
 WHERE NOT EXISTS (
         SELECT 1 FROM public.user_presets p
          WHERE p.discord_id = c.discord_id
            AND p.slot = c.active_preset_slot
       );

-- Echo may only point to deity slot 2 or 3 of the same preset.
SELECT count(*) AS invalid_echo_sources
  FROM public.user_presets
 WHERE equipped_echo_deity_id IS NOT NULL
   AND equipped_echo_deity_id IS DISTINCT FROM equipped_deity_2_id
   AND equipped_echo_deity_id IS DISTINCT FROM equipped_deity_3_id;

-- Existing foreign keys do not enforce same-owner gear/deity references.
-- This must return zero before cutover.
SELECT count(*) AS cross_owner_references
  FROM public.user_presets p
  LEFT JOIN public.user_weapons uw ON uw.weapon_id = p.equipped_weapon_id
  LEFT JOIN public.user_armors ua ON ua.armor_id = p.equipped_armor_id
  LEFT JOIN public.user_deities d1 ON d1.user_deity_id = p.equipped_deity_1_id
  LEFT JOIN public.user_deities d2 ON d2.user_deity_id = p.equipped_deity_2_id
  LEFT JOIN public.user_deities d3 ON d3.user_deity_id = p.equipped_deity_3_id
  LEFT JOIN public.user_deities de ON de.user_deity_id = p.equipped_echo_deity_id
 WHERE (uw.weapon_id IS NOT NULL AND uw.discord_id <> p.discord_id)
    OR (ua.armor_id IS NOT NULL AND ua.discord_id <> p.discord_id)
    OR (d1.user_deity_id IS NOT NULL AND d1.discord_id <> p.discord_id)
    OR (d2.user_deity_id IS NOT NULL AND d2.discord_id <> p.discord_id)
    OR (d3.user_deity_id IS NOT NULL AND d3.discord_id <> p.discord_id)
    OR (de.user_deity_id IS NOT NULL AND de.discord_id <> p.discord_id);
```

The later, separate drop migration is `scripts/migrations/20260803_05_drop_legacy_loadout.sql`, and must be run only after the A4 deployment has been stable and the old-column read sweep is clean:

```sql
-- Deferred cleanup migration; run only after the A cutover verification gates above pass.
BEGIN;
ALTER TABLE public.user_character
  DROP COLUMN active_deity_id,
  DROP COLUMN active_deity_id_2,
  DROP COLUMN active_deity_id_3,
  DROP COLUMN active_echo_deity_id,
  DROP COLUMN equipped_armor_id,
  DROP COLUMN equipped_weapon_id;
COMMIT;
```

Do not combine this migration with table creation, backfill, or the first code deployment.

### A4 file-by-file implementation plan

- `src/engine/loadout.js`: add the only runtime loadout read/write boundary.
- `src/engine/statAssembly.js`: replace the direct `user_character` equipment/deity joins in `buildPlayerFighter` with the active-preset join/accessor while retaining `combat_level` on `user_character`.
- `src/commands/rpg/profile.js` and `src/commands/rpg/stats.js`: consume the active-loadout result; show active preset slot/name in stats and preserve the existing combat stat assembly path.
- `src/commands/rpg/equip.js`: route weapon/armor changes to `updateActiveLoadout`; add the confirmed `crd equip preset <1|2>` path and pointer validation.
- `src/commands/rpg/deity.js`: route slot 1/2/3 equip, unequip, and Echo selection to the active-preset updater. A preset switch restores that preset's Echo source without clearing either preset.
- `src/engine/summonEngine.js`: route automatic slot-1 selection to the active preset and ensure the auto-selection transaction re-reads the selected loadout.
- `src/commands/rpg/create.js`: insert slot 1 and empty slot 2 for new characters in the existing creation transaction.
- `src/commands/rpg/bag.js`: mark gear as equipped from the active loadout, not legacy columns.
- `src/commands/rpg/sell.js`: protect the active loadout before selling; decide explicitly whether deleting equipment referenced by the inactive preset is allowed to self-heal through `ON DELETE SET NULL`.
- `src/commands/rpg/dev.js`: move reset writes to the accessor and add any preset/status display needed by the dev flow.
- `src/handlers/commandHandler.js` and the command registry/definitions: route `crd preset` and the `crd equip preset` subcommand in the existing command style.
- `scripts/v5_wipe_test_gear.js` and `scripts/patch3-deity-backup-wipe.sql`: update operational SQL/scripts to target `user_presets` through the approved maintenance path.
- `scripts/production-preflight.js` and `src/db/schemaGuard.js`: require `user_presets`, both slot rows, `active_preset_slot`, and the new accessor-era schema; stop requiring dropped columns only after the drop migration.
- `scripts/schema.sql` and `scripts/production-consolidated-schema.sql`: refresh snapshots after the live migration is applied.

### A6 behavior decisions

- Keep the proposed pointer name `active_preset_slot`; it reflects the stored value and avoids confusing it with the internal `id`.
- Keep exactly two rows for now, but have `crd preset` count rows from the database.
- Approved empty-slot behavior: allow the switch, render `None` for gear/deities, and reply `Preset 2 is empty. You now have nothing equipped.` Do not block or switch silently.
- Recommended `crd preset` scope for the first implementation: confirmed `crd preset` status and `crd equip preset <1|2>` switch. Defer proposed list/name/clear commands unless separately approved.

## B. Card avatar shop

### Findings

- The command is `crd avatar shop` in `src/commands/rpg/avatar.js`; it is separate from `crd shop supporter` and the CRD shop.
- Avatar catalog data is in Postgres `avatar_catalog`, not a config-only list. `src/engine/avatarSystem.js` seeds/queries the five classes, two genders, and Cyber/Anime/Webtoon/Genesis styles. `user_avatars` owns purchased avatars and already has `UNIQUE(discord_id, avatar_id)`.
- Current `buildAvatarPage` shows ten rows per page, not one large preview. It has owner-gated stateless buttons, but no Buy button in the page and no collector timeout.
- The supporter preview is in `src/engine/skinShopViews.js`: Components V2 container, large media preview, owner-gated custom IDs, circular prev/next navigation, back button, and optional victory toggle. It does not currently use a collector or timeout; the current supporter shop buttons remain enabled indefinitely.
- `src/handlers/interactionHandler.js` is the central custom-ID router. Existing owner guards should be reused/extracted rather than adding a second guard convention.
- `spendTokensTx` in `src/engine/supporterTokens.js:72-95` locks `supporters` with `FOR UPDATE`, checks affordability, inserts the negative ledger entry, and decrements the balance. It is the correct currency helper.

### Planned implementation

- Refactor the supporter preview builder into a shared preview primitive or reuse its exported builder without changing its visual style. Add an avatar-preview mode that displays one avatar image, name, price, owned state, and `Page i/n`.
- Add custom IDs containing `shop:av:<action>:<invokerId>:<page>` (or the existing namespace format after inspection) and use the existing owner-gate behavior. An interaction from another user must be rejected ephemerally.
- Prev/next wrap with `(page + 1) % total` and `(page - 1 + total) % total`; disable both whenever `total <= 1`; render no buttons for an empty catalog.
- Preview must be ephemeral. The Buy action must re-render the same page after success so its state changes to `Owned` immediately.
- Add the Custom Avatar Token as an explicit non-avatar shop product priced at 30 supporter tokens and describe it as a consumable ticket item. It must grant `users_bag.custom_avatar_token`, not an avatar ownership row.
- The existing avatar query's ordering must be made deterministic with an explicit style order, gender order, display name, avatar key, and final `avatar_id` tie-breaker. The existing class filter must remain.
- Move ownership lookup inside the Buy transaction. Lock the supporter row through `spendTokensTx`, re-read ownership inside the same transaction, insert into `user_avatars`, and use the existing unique constraint plus `RETURNING`/conflict handling. If ownership is found after the lock, roll the transaction back and return an already-owned response. Never trust the prior button state.
- Add a 150-second collector for the avatar preview interaction. On collector end, edit the message to disable every button. This is a new timeout for the avatar preview; the existing supporter shop has no current timeout to mirror, so the exact timeout is an implementation addition, not an existing value.

Files: `src/commands/rpg/avatar.js`, `src/engine/avatarSystem.js`, `src/engine/skinShopViews.js`, `src/handlers/interactionHandler.js`, `src/config/` for the shared custom-token product definition, `src/engine/supporterTokens.js` only if a small transaction helper is required, and `docs/shop-system.md`/`docs/cosmetic-system.md` for corrected shop documentation.

## C. Boss reorganization

### Findings and conflicts

- `mob_roster` has stats, `mob_type`, `immunity_tags`, and `special_flags`, but no tier column. Tier membership remains hardcoded by exact name in `src/config/bosses.js`.
- `boss_state` has one row per guild, a `spawn_id`, scaled stats, and status. It has no `spawn_source`; the dev-origin set is an in-memory `Set`, so it is lost on restart.
- There is no spawn queue. `spawnBoss` refuses to replace an active boss, and `dev spawnboss` currently errors if a boss is active.
- Bosses use fixed roster stats. The legacy per-level columns remain in the schema, are zeroed in the manually maintained roster, and are no longer read for boss stats or UI.
- Current normal rewards are 100,000 Credux/20,000 EXP/1,000 shards. Greater Twin is 150,000/30,000/1,500 and Golden is 200,000/40,000/2,000. Therefore the calamity reward is 400,000 Credux/80,000 EXP/4,000 shards. This must be derived from the existing greater-golden config, not copied as a second independent literal.
- Historical `boss_attack_log` rows store `spawn_id` and `mob_id`, but do not snapshot boss name or tier. A live join to `mob_roster` would reflect future Fenrir/Hydra classification. There is no current boss kill-history view that snapshots tier.
- The live Medusa row was checked on 2026-08-03: `mob_id=38`, Greek boss, `skill_key='stone_stare'`, `immunity_tags=['all_debuffs']`, and `special_flags={'retune_v6':true}`. Generic immunity handling also includes code-level `boss_immune`/HP-DOT protections, so clearing the row JSON alone would not satisfy “every damage type/status effect.”
- Proposed natural probabilities are 70% normal, 25% Greater, and 5% calamity. This takes five percentage points from the current 30% Greater roll, preserving the aggregate 30% special-boss frequency and existing encounter cadence/economy while making calamity one-sixth of special spawns. Use named configuration values `CALAMITY_SPAWN_CHANCE = 0.05` and `GREATER_SPAWN_CHANCE = 0.25`; validate that the three tier probabilities total 1.
- Natural and dev calamities use the same fixed stats. There is no dev-only HP/stat multiplier. `spawn_source` affects only chest selection: a natural calamity drops 3x Boss Golden Chest and a dev calamity drops Supreme Chest.
- The current lifecycle does not expire active bosses: `ACTIVE_BOSS_EXPIRES_AT_SQL` is `NOW() + INTERVAL '100 years'`, the scheduler documents that active bosses remain until defeated, and `expireBoss` returns without changing state. Calamity expiry is approved as two hours since the last recorded attack, not two hours since spawn. Every active-calamity attack refreshes `expires_at` inside the existing attack transaction; the expiry sweep atomically claims an expired row before marking it `escaped`, so an active fight is never cut off. The existing 15-minute cooldown resumes the cycle. Do not enable the 5% natural calamity rate without this idle-based despawn rule.

Escaped calamity reward policy remains an explicit product gate: propose announcement only, with no reward and no partial-reward calculation. This preserves the current no-reward behavior, avoids paying for incomplete damage without an approved contribution formula, and still tells the guild why the boss disappeared. Do not build consolation rewards without approval.

Medusa's exact manual row edit is:

```sql
UPDATE public.mob_roster
   SET immunity_tags = '[]'::jsonb,
       special_flags = '{"retune_v6": true, "no_immunities": true}'::jsonb
 WHERE mob_id = 38 AND name = 'Medusa';
```

The planned `battleEngine.js` change reads `side.specialFlags.no_immunities === true` before the generic boss `boss_immune`/`hp_pct_dot` guard and before row `immunityTags`; the flag therefore bypasses generic boss, HP-DOT, and status immunity handling for Medusa. The exact JSON key is `no_immunities`, not an unspecified future flag.

Bakunawa's stat-entry convention is fixed authored values: set `hp_per_level = 0`, `atk_per_level = 0`, and `def_per_level = 0`, and enter the complete values in `base_hp`, `base_atk`, and `base_def`. `base_crit` is the effective crit percentage; tier membership is not stored in `mob_roster`.

Exhaustive current Greater-specific and tier-sensitive references found by repository search:

- `src/config/bosses.js`: hardcoded Greater/Calamity names, 5%/25% tier rolls, chest/reward constants, HP multipliers, weighted selection, and exports.
- `src/engine/bossSystem.js:75-79,112,127,290,319-337,759-773,1303-1305,1316-1323,1369,1440,1547-1548,1571,1865`: imports, flavor text, chest state/resolution, announcement/reward text, spawn selection/stats/cache, defeat rewards/banner, and memory stats.
- `src/commands/rpg/dev.js:930-976`: force-spawn validation and behavior; it currently accepts any boss and has no tier-aware helper.
- `scripts/battle-selftest.js:53-56,2571-2601`: Greater fixtures and regression expectations.
- `scripts/tag_greater_bosses_v4_4.sql:2-30`: optional `special_flags.greater` tagging. Runtime does not currently read that flag.

No additional Greater-specific branch was found in boss-info, cooldown, or leaderboard code. Repeat this `rg` sweep immediately before implementation so line movement or new references cannot escape the conversion.

### Exact schema migration

Migration: `scripts/migrations/20260803_03_boss_spawn_source_queue.sql`, plus `20260803_07_boss_runtime_state.sql`.

```sql
-- Manual deployment position 3 of Monthsary Phase 2: boss source and calamity queue.
BEGIN;
ALTER TABLE public.boss_state
  ADD COLUMN IF NOT EXISTS spawn_source varchar(10) NOT NULL DEFAULT 'natural';
CREATE TABLE IF NOT EXISTS public.boss_spawn_queue (
  queue_id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  guild_id varchar(20) NOT NULL,
  boss_name text NOT NULL,
  requested_by varchar(20) NOT NULL,
  status varchar(10) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'spawning', 'spawned', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  spawned_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by varchar(20),
  spawn_id uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS boss_spawn_queue_one_live_per_guild
  ON public.boss_spawn_queue (guild_id)
  WHERE status IN ('pending', 'spawning');
COMMIT;
```

No mob_roster INSERT or UPDATE statements belong in these migrations. The manually maintained roster already contains the authored fixed stats. Before deployment, verify Medusa and both calamities carry `immunity_tags = '[]'::jsonb` and `special_flags.no_immunities = true`.

### Planned code changes

- `src/config/bosses.js`: keep exact-name hardcoded sets, derive calamity rewards from `GREATER_GOLDEN_REWARD`, use 70%/25%/5% probabilities, and resolve natural/dev chests without a source-based HP/stat multiplier.
- `src/engine/bossSystem.js`: persist `spawn_source`, use fixed stats with no boss level UI or writes, refresh calamity idle state inside the attack transaction, atomically expire idle calamities, and consume the oldest queued calamity after the cooldown.
- `src/commands/rpg/dev.js`: support `crd dev spawnboss calamity <name> confirm:SPAWN_BOSS:<guild_id>`, queue active-boss requests, spawn immediately when clear, and add `crd dev cancelcalamity <queue_id>` under the existing `DEV_IDS` gate. Log both paths with `logDev`.
- `src/engine/battleEngine.js`: read `specialFlags.no_immunities === true` so generic `boss_immune`, HP-DOT, and status immunity behavior is bypassed for Medusa. The production row has been confirmed; the manual row edit must clear `immunity_tags` and set the exact `no_immunities` flag.
- Boss-info and announcement code uses the hardcoded tier sets plus persisted spawn source; no leaderboard schema change is needed.
- `scripts/battle-selftest.js`: regression coverage asserts fixed boss stats, tier probabilities, no-immunity bypass, Bakunawa threshold persistence, natural/dev chest branches, and transaction ordering. It does not seed production boss rows.

Historical risk: future `boss_attack_log` rows may need a boss-name snapshot if history UI needs immutable presentation. Add it only if that requirement is approved; the current code has no such immutable snapshot.

### Phase 2 Section 3 implementation record

Implemented locally in the workspace:

- `src/config/bosses.js` now defines Greater as Jotun/Fafnir/Cerberus and Calamity as Fenrir/Bakunawa, with 70%/25%/5% normal/Greater/Calamity selection, reduced Greater HP multipliers, and calamity rewards derived from Greater Golden rewards.
- Bosses use fixed roster base stats. The legacy `boss_level` and boss writes to `active_battles.enemy_level` were removed from the boss path; the columns remain nullable for compatibility. Boss UI no longer displays a level.
- `boss_state.spawn_source`, durable `last_attack_at`, durable Bakunawa threshold state, and the race-safe calamity queue are persisted. Idle calamities escape after two hours since the last recorded attack, with announcement-only expiry.
- `crd dev spawnboss calamity <name> confirm:SPAWN_BOSS:<guild_id>` queues behind an active boss or spawns immediately when clear. `crd dev cancelcalamity <queue_id>` cancels pending rows and stale or legacy `spawning` claims, while preserving active leases. Both use the existing dev gate and `logDev`.
- Bakunawa's six thresholds are durable and additive through +60% ATK; Eclipse applies the one-turn `darkened` effect. `no_immunities` bypasses generic boss, HP-DOT, and status immunity handling.
- Added `scripts/migrations/20260803_03_boss_spawn_source_queue.sql`, `20260803_06_boss_level_nullable.sql`, and `20260803_07_boss_runtime_state.sql`. Production snapshots and preflight now include the new nullable/runtime schema.
- `npm.cmd run selftest` passes with 414 checks, including the Bakunawa Eclipse regression.

## D. Supporter token amounts

### Findings

The existing grant configuration is in `src/config/cosmetics.js:60-63`:

```js
const MONTHLY_TOKENS = { believer: 2, chosen: 4 };
const ETERNAL_ONE_TIME_TOKENS = 20;
```

The actual code tier identifiers are `believer`, `chosen`, and `eternal`; storage also accepts legacy aliases `chosen_believer` and `eternal_believer` through normalization. Skin purchase costs are a different map (`TOKEN_COSTS = { believer: 2, chosen: 3, eternal: 4 }`) and must not be changed by this update.

The old stipend values are duplicated in `docs/cosmetic-system.md:14-24`. `docs/shop-system.md` mentions the stipend but does not duplicate the numeric table. `supporterEntitlements.js` is the grant flow: `applySubscribe` grants monthly Believer/Chosen tokens or the Eternal one-time grant, and `src/commands/rpg/dev.js:1183-1240` exposes `crd dev sub ...`; there is no literal `dev grant-eternal-believer` command.

The existing `supporter_grants` table is an audit log without a uniqueness guarantee. It cannot safely enforce one Eternal item grant under retries or concurrent requests, so the new item claim needs its own database unique key.

### Planned change and conflict

Edit the existing constants in place to:

```js
const MONTHLY_TOKENS = { believer: 10, chosen: 20 };
const ETERNAL_ONE_TIME_TOKENS = 60;
```

Update `docs/cosmetic-system.md` to match. Do not add a second grant config or a top-up/backfill migration.

The brief's “entire change is three numbers” conflicts with the requirement that Eternal also grants one `custom_deity_token` atomically. Extend the existing `applySubscribe` transaction with a `supporter_item_grants` claim insert. Its database unique constraint, not a read-before-write code check, is the idempotency guarantee.

For Eternal, insert `(discord_id, 'custom_deity_token', 'eternal_subscription', stable_ref)` with `ON CONFLICT DO NOTHING RETURNING grant_id`. Only a returned claim may increment `users_bag.custom_deity_token`; both statements remain in the same transaction, so either both commit or both roll back. Use the same stable reference as the existing Eternal token grant, including the established founder fallback `eternal-founder:${userId}`. Replaying that reference returns no claim and grants no second item, including concurrent replay. A manual/dev grant must supply and persist its own stable reference; do not silently make this item repeatable.

Both Eternal grants and the Custom Avatar Token shop grant must upsert the bag row; neither path may assume `users_bag` already exists. Use the same transaction-safe pattern for each column:

```sql
INSERT INTO public.users_bag AS bag (discord_id, custom_deity_token)
VALUES ($1, $2)
ON CONFLICT (discord_id) DO UPDATE
   SET custom_deity_token = bag.custom_deity_token + EXCLUDED.custom_deity_token;
```

The avatar path substitutes `custom_avatar_token` for `custom_deity_token` and remains in the locked supporter-spend transaction. The Eternal path executes this only after its idempotency claim returns a row.

Files: `src/config/cosmetics.js`, `src/engine/supporterEntitlements.js`, `src/engine/supporterTokens.js` only if the bag grant helper is colocated there, `src/commands/rpg/dev.js` only for the stable-reference/audit wiring if needed, and `docs/cosmetic-system.md`.

## E. Custom content tokens and ticket queue

### Findings and decisions

- `users_bag` is one row per user with integer stack columns. The existing renderer in `src/engine/bagViews.js` uses a fixed list and currently renders zero-count items, so zero suppression is required.
- Existing short ids are `cc`, `sr`, and `supr` in `src/config/crdBagItems.js`; `at` is consistent with the existing convention. Recommend `dt` for Custom Deity Token.
- `src/utils/emojis.js` parses `assets/data/game_items.txt` entries in the exact format:

  `Display Name | 'emoji_name' | 'emoji_id'`

  Example shape: `Silver Chest | 'silver_chest' | '1514006354027741184'`. The user must append the two new rows and upload the icons; this plan does not edit `game_items.txt`.
  The rows are now present in `assets/data/game_items.txt` and resolve to the following exact entries:

  `Custom Avatar | 'custom_avatar' | '1533790198284947467'`

  `Custom Deity | 'custom_deity' | '1533790200382226513'`
- `src/utils/weaponId.js` generates an eight-character lowercase id from `0-9a-z` using `crypto.randomBytes(8)`, then checks both `user_weapons.weapon_id` and `user_armors.armor_id`, retrying ten times. Database uniqueness is separate per gear table, so it is not currently globally unique against a tickets table. Extend the collision query to include `tickets.ticket_id`, and retain a final unique-violation retry around the insert.
- There is no ticket table or ticket-specific command. Existing `DEV_IDS` is the shared gate; `DEV_ACCOUNT_IDS` is a separate cosmetics allowlist and must not be used for ticket review.
- Multiple open tickets are not currently constrained. Recommendation: allow multiple open tickets per user/type because each redeemed stack item represents one fulfillment; do not add a one-open-ticket cap unless the product decision changes.

### Exact migration SQL

Migration: `scripts/migrations/20260803_02_custom_content_tickets.sql`.

```sql
-- Manual deployment position 1 of Monthsary Phase 2: E schema foundation plus D supporter changes.
BEGIN;

ALTER TABLE public.users_bag
  ADD COLUMN IF NOT EXISTS custom_avatar_token integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS custom_deity_token integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_bag_custom_avatar_token_check'
  ) THEN
    ALTER TABLE public.users_bag
      ADD CONSTRAINT users_bag_custom_avatar_token_check
      CHECK (custom_avatar_token >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_bag_custom_deity_token_check'
  ) THEN
    ALTER TABLE public.users_bag
      ADD CONSTRAINT users_bag_custom_deity_token_check
      CHECK (custom_deity_token >= 0);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.tickets (
    ticket_id text PRIMARY KEY,
    type text NOT NULL CHECK (type IN ('avatar', 'deity')),
    user_id varchar(20) NOT NULL
      REFERENCES public.users(discord_id) ON DELETE CASCADE,
    status text NOT NULL DEFAULT 'queued'
      CHECK (status IN ('queued', 'in_progress', 'done')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    completed_by varchar(20),
    notes text
);

CREATE TABLE IF NOT EXISTS public.supporter_item_grants (
    grant_id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    discord_id varchar(20) NOT NULL
      REFERENCES public.users(discord_id) ON DELETE CASCADE,
    item_key varchar(32) NOT NULL
      CHECK (item_key IN ('custom_deity_token')),
    quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
    grant_reason varchar(32) NOT NULL,
    grant_ref varchar(100) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT supporter_item_grants_idempotency_key
      UNIQUE (discord_id, item_key, grant_reason, grant_ref)
);

CREATE INDEX IF NOT EXISTS idx_tickets_status_type_created
  ON public.tickets(status, type, created_at);

ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supporter_item_grants ENABLE ROW LEVEL SECURITY;

COMMIT;
```

The redemption transaction should use a conditional decrement and `RETURNING`, followed by the ticket insert on the same client. The conceptual SQL for the avatar path is:

```sql
WITH consumed AS (
  UPDATE public.users_bag
     SET custom_avatar_token = custom_avatar_token - 1
   WHERE discord_id = $1 AND custom_avatar_token >= 1
   RETURNING discord_id
)
INSERT INTO public.tickets(ticket_id, type, user_id)
SELECT $2, 'avatar', discord_id FROM consumed
RETURNING ticket_id;
```

If the insert returns no row, roll back and report that no token was available. If ticket-id insertion collides, generate a new id and retry within the same transaction. Never commit the decrement without a returned ticket row.

The Eternal item claim is separate from ticket redemption. Its transaction shape is:

```sql
INSERT INTO public.supporter_item_grants
  (discord_id, item_key, quantity, grant_reason, grant_ref)
VALUES ($1, 'custom_deity_token', 1, 'eternal_subscription', $2)
ON CONFLICT (discord_id, item_key, grant_reason, grant_ref) DO NOTHING
RETURNING grant_id;
```

If and only if this returns a row, upsert/increment `users_bag.custom_deity_token` on the same database client before commit. An empty result is a successful replay/no-op, not an error. The unique constraint makes two concurrent requests produce at most one claim.

### Planned code changes

- `src/config/crdBagItems.js`: add `at` and `dt` with explicit column/type mappings. Keep bag item ids separate from shop product ids.
- `src/engine/bagViews.js` and `src/commands/rpg/bag.js`: include the two items in the registry/query and filter all item rows to `quantity > 0` before rendering. Preserve the existing bag layout.
- `src/commands/rpg/use.js`: add redemption dispatch for `at` and `dt`; do not call these “equip” operations in user-facing text. Reply with the generated ticket id.
- `src/utils/weaponId.js`: add ticket-table collision checking and a retry-safe ticket id helper.
- `src/commands/rpg/avatar.js`/`src/engine/avatarSystem.js`: connect the Custom Avatar Token shop product to the same bag-grant helper and 30-token supporter spend transaction.
- `src/engine/supporterEntitlements.js`: grant one Custom Deity Token inside the Eternal grant transaction as described in D.
- `src/handlers/commandHandler.js` and command modules: add dev-only `crd supporter tickets` and `crd update ticket <ticket_id> <in_progress|done>`. The brief's command shape is not currently present; reuse the existing command router and `DEV_IDS` guard. If the existing supporter namespace is not dev-gated, add the explicit guard at the command entry rather than changing all supporter commands.
- New module recommended: `src/commands/rpg/tickets.js` for query/filter/render/update logic, with custom-ID pagination routed through `interactionHandler.js`.

Ticket review filters:

| View | Query | Sort |
|---|---|---|
| Avatar | `type='avatar' AND status IN ('queued','in_progress')` | `created_at ASC` |
| Custom Deity | `type='deity' AND status IN ('queued','in_progress')` | `created_at ASC` |
| Completed Avatar | `type='avatar' AND status='done'` | `completed_at DESC` |
| Completed Custom Deity | `type='deity' AND status='done'` | `completed_at DESC` |

Render DB `in_progress` as `Ongoing`; do not store `ongoing`. The update command accepts only `in_progress` and `done`, has an already-at-status no-op response, sets `updated_at`, and on `done` sets `completed_at` and `completed_by`. There is no cancel or refund path.

### Phase 2 Section 2 implementation record

Implemented locally in the workspace:

- `src/engine/avatarSystem.js` now uses deterministic style/gender/name/key/id ordering, renders one large-image shop avatar per page, shows price and owned state, wraps pages, and contains the locked avatar and Custom Avatar Token purchase transactions.
- `src/commands/rpg/avatar.js` and `src/handlers/interactionHandler.js` add owner-gated shop/preview controls, a 150-second timeout that disables all buttons, same-page post-purchase rerendering, and the `at` product purchase action.
- `src/config/crdBagItems.js`, `src/engine/bagViews.js`, and `src/commands/rpg/use.js` add explicit `at`/`dt` mappings, suppress zero-count rows, and redeem tokens into tickets without using “equip” wording.
- `src/engine/customContentTickets.js` performs the conditional decrement and ticket insert on one transaction client, retries ticket-id unique violations inside savepoints, and rolls back if no ticket row is returned.
- `src/commands/rpg/tickets.js`, `src/handlers/commandHandler.js`, and `src/handlers/interactionHandler.js` add the DEV_IDS-gated four-view queue and the `crd update ticket` status workflow. Open queues sort oldest-first; completed queues sort newest-first; `in_progress` renders as `Ongoing`.
- No boss or preset code was changed, no one-open-ticket cap was added, and no cancel/refund path was added. `assets/data/game_items.txt` now contains the exact `custom_avatar` and `custom_deity` entries shown above.

#### Custom Avatar Token purchase transaction walkthrough

1. `purchaseCustomAvatarToken` acquires one pool client and begins with `client.query('BEGIN')` at `src/engine/avatarSystem.js:649-652`.
2. It calls `spendTokensTx(client, ...)` at `src/engine/avatarSystem.js:653-655`; that helper locks the supporter row and performs the debit on the same client.
3. Only after a successful debit does it call `upsertBagItemTx(client, ...)` at `src/engine/avatarSystem.js:660`; the helper writes `users_bag.custom_avatar_token` through that same client.
4. There is no intermediate commit or pool acquisition. The only awaits between debit and grant are same-client transaction queries; `COMMIT` occurs at line 661 after both succeed.
5. Errors enter the catch at lines 663-665, which rolls back that same client, so the debit and bag grant are discarded together. The client is released at lines 666-668.

#### Token redemption transaction walkthrough

1. `redeemToken` acquires one pool client and begins at `src/engine/customContentTickets.js:62-66`, then calls `redeemTokenTx(client, ...)`.
2. `redeemTokenTx` uses that same client for the conditional `users_bag` decrement with `RETURNING discord_id` and the `tickets` insert with `RETURNING ticket_id` in the single statement at `src/engine/customContentTickets.js:27-43`.
3. A returned ticket id is required before the savepoint is released and the wrapper commits at lines 71-72. An empty consumed result rolls back and returns `insufficient`; a ticket-id unique violation rolls back to the savepoint and retries without consuming the token.
4. There is no separate pool acquisition or intermediate commit. Errors roll back the outer transaction at lines 73-75, and the client is released at lines 76-78. Therefore a decrement cannot commit without its ticket row.

## F. Profile and stats panel revamp

### Panel inventory and renderer findings

The profile/stats panel is rendered with `@napi-rs/canvas`, not HTML. Canvas provides `ctx.measureText`, and the layout renderers already use measured width for some text. The record boxes themselves currently use fixed label/value font sizes and `fillText` without fitting. The default fallback renderers also use fixed values (`label=7px`, `value=16px`) and six dynamically sized cells.

The panel dimensions are fixed at 1536x1024 for layout skins. Record box dimensions vary. The default fallback renderer has the narrowest computed cells at approximately 87.67x58; among JSON layout skins, Greek is narrowest at 90x56. Founder is shortest at 103x50. The widest tested skin (`732560805006016523`) is 129x56. The record `y`, box width/height, gap, radius, colors, and six x-coordinates must not change.

Every profile/stats panel pair in the repository is listed below. No JSON geometry changes are planned:

- `assets/skins/supporters/base/profile.layout.json` and `profile.stats.layout.json`.
- `assets/skins/founder/founder_profile.layout.json` and `founder_profile.stats.layout.json`.
- `assets/skins/testers/profile.layout.json` and `profile.stats.layout.json`.
- `assets/skins/testers/1444953283306328075/profile.layout.json` and `profile.stats.layout.json`.
- `assets/skins/testers/732560805006016523/profile.layout.json` and `profile.stats.layout.json`.
- `assets/skins/testers/743405383380500531/profile.layout.json` and `profile.stats.layout.json`.
- `assets/skins/testers/757267693136117820/profile.layout.json` and `profile.stats.layout.json`.
- `assets/skins/testers/770584603852275712/profile.layout.json` and `profile.stats.layout.json`.
- `assets/skins/testers/tester_profile2.layout.json`; its stats rendering uses `assets/skins/testers/1444953283306328075/profile.stats.layout.json` with the overrides in `src/config/cosmetics.js:141-151`.
- `assets/skins/supporters/supporter_store/profile/c_divine_radiance_p1.layout.json` and `.stats.layout.json`.
- `assets/skins/supporters/supporter_store/profile/c_laurel_runes_blue_p2.layout.json` and `.stats.layout.json`.
- `assets/skins/supporters/supporter_store/profile/e_aurora_constellation_p3.layout.json` and `.stats.layout.json`.
- `assets/skins/supporters/supporter_store/profile/e_eternal_flame_p4.layout.json` and `.stats.layout.json`.
- `assets/skins/supporters/supporter_store/profile/greek_profile.layout.json` and `.stats.layout.json`.
- `assets/skins/supporters/supporter_store/profile/norse_profile.layout.json` and `.stats.layout.json`.
- `assets/skins/supporters/supporter_store/profile/ph_profile.layout.json` and `.stats.layout.json`.

The catalog also contains battle, battle-result, summon, founder, tester, and synthetic class-battle cosmetics. Those do not render the `crd profile`/`crd stats` six-box panel and are not F panel files. The local catalog audit found 57 seed rows; four summon GIFs are not included because `scripts/seedCosmetics.js:193-204` scans only `.webp`. That is a separate cosmetic-seeding issue and should not be changed as part of F.

`src/engine/profileLayoutRenderer.js` and `src/engine/statsLayoutRenderer.js` share the six-box layout structure but each has its own `buildView` and record drawer. `src/engine/profileLayoutRenderer.js:302-343` and `src/engine/statsLayoutRenderer.js:318-360` currently provide the shared-looking record data and relabel rank columns. The headings are hardcoded in those shared renderer view builders (`RANK COMBAT RECORD` and `COMBAT STATS`) and separately in `renderProfile.js:314-345` and `renderStats.js:421-452`.

### Data plan and decisions

Current raid/rank records are derived from `raid_logs` and `ranked_logs`, not from a shared high-watermark table. Current `pvp_rating` is on `user_character`; `bracketOf` in `src/config/ranked.js` derives the rank word. The full rank list is Mortal, Champion, Demigod, Ascendant, Divine, Celestial. Ascendant and Celestial are both nine characters; in the actual DejaVu Sans Bold fallback, Ascendant is wider. Fitting must use measured pixel width, not character count.

Win rate is not currently rendered. Use the approved `ranked_logs` source used for total ranked duels and wins, calculate `round(100 * wins / duels)` as a whole percentage, and render `-` for zero duels. This avoids disagreement with the existing ranked record and avoids presenting a misleading 0% for a player with no games.

Approved left-to-right mapping and labels:

| Box | Value | Label |
|---:|---|---|
| 1 | highest raid streak | `BEST RAID STK` |
| 2 | current raid streak | `RAID STREAK` |
| 3 | current rank word | `RANK` |
| 4 | current `pvp_rating` number | `RANK #` |
| 5 | highest rank streak | `BEST RANK STK` |
| 6 | ranked win rate | `WIN RATE` |

This preserves the brief's listed order while fitting the available record cells.

Rendered-sample measurements use DejaVu Sans Bold, a 6px horizontal inset (`inner width = cell width - 12px`), and a 0.5px step-down from each layout's true configured value size. The worst-case row is `99999`, `99999`, `Ascendant`, `99999`, `99999`, `87%`; the all-fits row is `123`, `123`, `Mortal`, `1234`, `123`, `87%`. The settled size is the smallest step that fits all six values, with a 12px floor. These values are measured from the configured size, not from the rejected global `-3px` baseline:

| Renderer/skin | Cell size | Label/value config | Worst-case settled size | All-fits settled size |
|---|---:|---:|---:|---:|
| Default fallback | ~87.67x58 | 7px / 16px | 12.5px (`Ascendant` limits) | 16px |
| Greek | 90x56 | 8px / 17px | 13px (`Ascendant` limits) | 17px |
| Founder | 103x50 | 7px / 15px | 15px (`Ascendant` fits) | 15px |
| Widest tester `732560805006016523` | 129x56 | 8px / 17px | 17px (`Ascendant` fits) | 17px |

The requested comparison is stored at `render-samples/character-record-box-current-vs-proposed.png`. It uses the default fallback geometry with `12,480`, `Ascendant`, and `87%` so the visual difference is judged against realistic values rather than the small placeholders in the geometry-fit sheet.

At 7px, the widest approved label (`BEST RANK STK`) measures about 62.14px versus 75.67px of fallback inner width and 91px for Founder. At 8px it measures about 71.02px versus 78px of Greek inner width. No approved label needs shrinking below a layout's existing configured size. If a future font/layout fails, use an explicit shorter fallback (`BEST RAID` or `BEST RANK`) instead of reducing the static label below its current size.

Use approved adaptive uniform sizing. For each panel render, start all six values at the layout's configured value size, measure every value against its own box inner width, and compute the smallest fitted size any one value requires. Draw all six values at that one size. A panel whose values all fit remains at its current configured size; a panel containing `Ascendant`, `Celestial`, or a large figure shrinks the entire row uniformly. Floor at 12px. If any value cannot fit at 12px, stop and report the skin and value rather than changing geometry or abbreviating silently. Labels remain unchanged at their configured sizes.

The fresh sample sheet is `render-samples/character-record-box-adaptive-uniform.png`. It shows a full-size panel and an `Ascendant`/five-digit panel at both the narrowest fallback geometry and Founder. The global `-3px` and independent per-box policies are rejected; adaptive uniform sizing is the renderer policy for F.

### Exact schema migration

Migration: `scripts/migrations/20260803_04_character_record_highs.sql`.

```sql
-- Manual deployment position 5 of Monthsary Phase 2: F character-record highs.
BEGIN;

ALTER TABLE public.user_character
  ADD COLUMN IF NOT EXISTS highest_raid_streak integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS highest_rank_streak integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_character_highest_raid_streak_check'
  ) THEN
    ALTER TABLE public.user_character
      ADD CONSTRAINT user_character_highest_raid_streak_check
      CHECK (highest_raid_streak >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_character_highest_rank_streak_check'
  ) THEN
    ALTER TABLE public.user_character
      ADD CONSTRAINT user_character_highest_rank_streak_check
      CHECK (highest_rank_streak >= 0);
  END IF;
END $$;

WITH ordered AS (
  SELECT discord_id, result,
         row_number() OVER (PARTITION BY discord_id ORDER BY timestamp, id) AS rn,
         row_number() OVER (PARTITION BY discord_id, result ORDER BY timestamp, id) AS rn_result
    FROM public.raid_logs
   WHERE battle_type = 'raid'
), runs AS (
  SELECT discord_id, result, rn - rn_result AS run_id
    FROM ordered
), highs AS (
  SELECT discord_id, max(run_length)::int AS high
    FROM (
      SELECT discord_id, run_id, count(*) AS run_length
        FROM runs
       WHERE result = 'win'
       GROUP BY discord_id, run_id
    ) s
   GROUP BY discord_id
)
UPDATE public.user_character c
   SET highest_raid_streak = COALESCE(h.high, 0)
  FROM highs h
 WHERE h.discord_id = c.discord_id;

WITH ordered AS (
  SELECT player_id AS discord_id, result,
         row_number() OVER (PARTITION BY player_id ORDER BY timestamp, id) AS rn,
         row_number() OVER (PARTITION BY player_id, result ORDER BY timestamp, id) AS rn_result
    FROM public.ranked_logs
), runs AS (
  SELECT discord_id, result, rn - rn_result AS run_id
    FROM ordered
), highs AS (
  SELECT discord_id, max(run_length)::int AS high
    FROM (
      SELECT discord_id, run_id, count(*) AS run_length
        FROM runs
       WHERE result = 'win'
       GROUP BY discord_id, run_id
    ) s
   GROUP BY discord_id
)
UPDATE public.user_character c
   SET highest_rank_streak = COALESCE(h.high, 0)
  FROM highs h
 WHERE h.discord_id = c.discord_id;

COMMIT;
```

The backfill computes the historical maximum from the immutable logs when available; users with no wins remain at zero. This is better than defaulting to only the current streak. Historical data is still limited to what the logs retain.

Production sizing does not justify batching: 30,381 raid rows (9,920 kB), 16 ranked rows (56 kB), and 24 character rows were present on 2026-08-03. The exact high-streak reads executed in 147.602 ms and 0.176 ms with no temporary I/O. Run the migration off-peak in one transaction with a short `lock_timeout` and bounded `statement_timeout`, and rerun counts plus `EXPLAIN (ANALYZE, BUFFERS)` immediately before production. If those results have grown materially or spill to temporary blocks, pause and reassess batching before applying it.

The result domains were also checked: `raid_logs.result` is only `win`/`loss` and `ranked_logs.result` is only `win`. Both current-streak queries in `profile.js` and `stats.js` stop at the first non-`win`, so the backfill's streak definition is aligned with the panel source.

Run this post-backfill verification query on the migration copy/staging database; it must return zero. The same read-only CTE simulation against current production data returned `violations = 0`, `max_current_minus_highest = 0`, and `rows_checked = 48`.

```sql
WITH raid_history_ordered AS (
  SELECT discord_id, result,
         row_number() OVER (PARTITION BY discord_id ORDER BY timestamp, id) AS rn,
         row_number() OVER (PARTITION BY discord_id, result ORDER BY timestamp, id) AS rn_result
    FROM public.raid_logs
   WHERE battle_type = 'raid'
), raid_highs AS (
  SELECT discord_id, max(run_length)::int AS highest
    FROM (
      SELECT discord_id, rn - rn_result AS run_id, count(*) AS run_length
        FROM raid_history_ordered
       WHERE result = 'win'
       GROUP BY discord_id, rn - rn_result
    ) s
   GROUP BY discord_id
), raid_recent_numbered AS (
  SELECT discord_id, result,
         row_number() OVER (PARTITION BY discord_id ORDER BY timestamp DESC, id DESC) AS rn
    FROM public.raid_logs
   WHERE battle_type = 'raid'
), raid_current AS (
  SELECT discord_id,
         count(*) FILTER (WHERE result = 'win' AND rn < COALESCE(first_break, 2147483647))::int AS current
    FROM (
      SELECT discord_id, result, rn,
             min(rn) FILTER (WHERE result <> 'win') OVER (PARTITION BY discord_id) AS first_break
        FROM raid_recent_numbered
    ) q
   GROUP BY discord_id
), ranked_history_ordered AS (
  SELECT player_id AS discord_id, result,
         row_number() OVER (PARTITION BY player_id ORDER BY timestamp, id) AS rn,
         row_number() OVER (PARTITION BY player_id, result ORDER BY timestamp, id) AS rn_result
    FROM public.ranked_logs
), ranked_highs AS (
  SELECT discord_id, max(run_length)::int AS highest
    FROM (
      SELECT discord_id, rn - rn_result AS run_id, count(*) AS run_length
        FROM ranked_history_ordered
       WHERE result = 'win'
       GROUP BY discord_id, rn - rn_result
    ) s
   GROUP BY discord_id
), ranked_recent_numbered AS (
  SELECT player_id AS discord_id, result,
         row_number() OVER (PARTITION BY player_id ORDER BY timestamp DESC, id DESC) AS rn
    FROM public.ranked_logs
), ranked_current AS (
  SELECT discord_id,
         count(*) FILTER (WHERE result = 'win' AND rn < COALESCE(first_break, 2147483647))::int AS current
    FROM (
      SELECT discord_id, result, rn,
             min(rn) FILTER (WHERE result <> 'win') OVER (PARTITION BY discord_id) AS first_break
        FROM ranked_recent_numbered
    ) q
   GROUP BY discord_id
), comparisons AS (
  SELECT 'raid' AS record_type, c.discord_id,
         COALESCE(h.highest, 0)::int AS highest,
         COALESCE(s.current, 0)::int AS current
    FROM public.user_character c
    LEFT JOIN raid_highs h USING (discord_id)
    LEFT JOIN raid_current s USING (discord_id)
  UNION ALL
  SELECT 'ranked', c.discord_id,
         COALESCE(h.highest, 0)::int,
         COALESCE(s.current, 0)::int
    FROM public.user_character c
    LEFT JOIN ranked_highs h USING (discord_id)
    LEFT JOIN ranked_current s USING (discord_id)
)
SELECT count(*) FILTER (WHERE current > highest)::int AS violations,
       COALESCE(max(current - highest), 0)::int AS max_current_minus_highest,
       count(*)::int AS rows_checked
  FROM comparisons;
```

### F implementation files

- `src/commands/rpg/profile.js` and `src/commands/rpg/stats.js`: select `pvp_rating`, `highest_raid_streak`, and `highest_rank_streak`; retain the existing parallel current-streak queries; pass one normalized records object to both renderers.
- Add a shared data helper, preferably `src/engine/characterRecords.js`, that receives the character row plus the existing raid/ranked query results and produces the six values. It must calculate rank word via `bracketOf`, rank number from `pvp_rating`, whole-percent win rate, and zero-duel `-` display. This prevents profile/stats drift without adding a third read query.
- `src/commands/rpg/raid.js`: after inserting a raid log in the existing transaction, compute/update the current raid streak high in the same transaction. Do not add a separate post-commit write.
- `src/commands/rpg/ranked.js`: after inserting the ranked log, update `highest_rank_streak` in the same transaction.
- Add the same high-watermark updates to any other future raid/ranked result writers discovered by the final `rg` sweep; current writers are `raid.js:196-206` and `ranked.js:202-205`.
- `src/engine/recordText.js` (new): shared Canvas helper that measures all six values with `ctx.measureText`, finds the smallest fitted size required by any box, applies that one uniform value size to the row, centers both axes, respects per-layout font/family/weight/color, keeps label sizes unchanged, and enforces a 12px dynamic-value floor.
- `src/engine/profileLayoutRenderer.js` and `src/engine/statsLayoutRenderer.js`: route record labels and values through the shared helper; preserve each layout's `y`, `box_w`, `box_h`, `gap`, `radius`, colors, and x positions exactly; change only heading text and box contents.
- `src/engine/renderProfile.js` and `src/engine/renderStats.js`: use the same records helper and text-fitting helper for the default fallback six boxes; preserve the current canvas/layout geometry and frame.
- `src/config/cosmetics.js`/`profileLayoutAliases.js`: no layout coordinate changes. Keep the existing tester2 source/override behavior.
- `scripts/schema.sql` and `scripts/production-consolidated-schema.sql`: refresh snapshots after the migration.

Acceptance tests must render every panel pair listed above, assert six boxes remain in the same coordinates and sizes, test all six rank names and large streak values, verify static labels remain at the configured size, and verify dynamic values never drop below 12px. If any skin fails, stop and report it rather than modifying its JSON.

## Risks and verification gates

1. A preset drop can destroy rollback safety. Require migration verification queries and an old-column `rg`/live catalog sweep before `20260803_05_drop_legacy_loadout.sql`.
2. Existing foreign keys do not enforce same-owner gear/deity references. Verify current data and keep ownership checks in the accessor/command layer.
3. Echo is loadout-coupled state. The decision is approved; run the stale-pointer preflight before A and retain the defensive NULL-on-invalid backfill plus the preset constraint.
4. The current avatar purchase path checks ownership before its transaction and can charge a duplicate under a race. Move the ownership read inside the locked transaction before shipping B.
5. The existing avatar/supporter shop has no collector timeout. The required timeout is a new interaction lifecycle, not a reused existing setting.
6. The current dev boss source is in memory. Persist `spawn_source` and queue state before offering Supreme Chest rewards.
7. Medusa's live row is absent from checked-in SQL but was confirmed in production. The manual data edit and code-level `no_immunities` flag must ship together; clearing only `immunity_tags` is insufficient.
8. The approved natural mix is 70% normal, 25% Greater, and 5% calamity, but the 5% rate is gated on the approved idle-based two-hour expiry (two hours since the last recorded attack). Keep all values named and assert that the total is 1. Natural/dev source must never alter stats.
9. Eternal item granting expands the stated D “three numbers only” scope. Keep it in the existing subscription transaction and enforce replay safety with the database unique claim key.
10. Layout-driven record boxes vary down to ~87.67px wide in the fallback and 50px high in Founder, and requested fonts are not all bundled. Test real installed-font fallback, keep static labels at configured size, enforce the 12px dynamic-value floor, and never resize or reposition a skin.
11. F uses approved adaptive uniform sizing: measure all six values, use the smallest required size uniformly, preserve the configured size when all values fit, and enforce a 12px floor. Do not apply a global reduction or independent per-box sizing.
12. The partial unique queue index permits one pending calamity per guild. Keep the duplicate response explicit and test the unique-violation race path.

Current status is maintained in the header above.
