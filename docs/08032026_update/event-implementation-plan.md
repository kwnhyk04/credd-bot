# Monthsary Event - Phase 1 implementation plan

Status: planning only, revised after owner review. No event implementation has been written.

The prerequisite Monthsary Update is deployed and reported healthy in production. Event implementation was cut from verified `main`/`origin/main` at `98f33ec`.

## 1. Repository findings

### Sacred Relic

Yes. Sacred Relic is the existing CRD Bag item `sr`.

- Registry: `src/config/crdBagItems.js`
- Display name: `Sacred Relic`
- Inventory column: `users_bag.sacred_relics`
- Emoji key: `sacred_relic`
- Use path: `crd use sr` delegates to the same atomic flow as `crd open sr` in `src/commands/rpg/open.js`.
- Sink: one Sacred Relic is consumed for 30 deity rolls through `runSummon`; pity applies. Consumption and the summon results are committed in one transaction, so a failed summon does not consume the relic.
- Other existing acquisition/sink context: the PvP shop sells Sacred Relics, and the weekly quest grand reward grants one.

Therefore no new item, icon, inventory column, or sink is needed. Fourteen event relics are usable: they represent 140 deity rolls. The event is not anticlimactic on this point.

The 14-relic ceiling counts event sources only. The existing `weekly_grand` Sacred Relic continues normally during the window, so the expected all-content total can be 15. That unrelated permanent reward is correct and is not an event double-count.

### Boss chests

Both rewards already exist as grantable and openable inventory items.

| Reward | Player-facing ID | Inventory column | Open path |
|---|---|---|---|
| Boss Treasure Chest | `btc` | `users_bag.boss_treasure_chest` | `crd open btc` |
| Boss Golden Chest | `bgtc` | `users_bag.boss_golden_chest` | `crd open bgtc` |

The definitions are in `src/config/dropRates.js` and the bag display aliases are in `src/engine/bagViews.js`. Existing grant examples are:

- `src/engine/bossSystem.js`: adds the whitelisted boss chest column to every eligible attacker inside the boss reward transaction.
- `src/utils/grantLevelRewards.js`: adds boss chest quantities as part of idempotent level rewards.

The event should use the same inventory columns and game-log fields. It must not edit chest drop rates, boss rewards, level reward tables, or chest-opening code.

Day 7 is confirmed as `1 Sacred Relic + 1 Boss Treasure Chest + 1 Boss Golden Chest`; the golden chest is additional, not a replacement. `Boss Golden Chest` is the existing player-facing display name in `bagViews.js` and must be used in the reply even where the brief calls it a Boss Golden Treasure Chest.

### Existing quest capabilities

The quest system is centralized in `src/utils/questProgress.js`.

Daily behavior:

- Each player receives three distinct randomized quests per PHT calendar day.
- The rows are stored in `daily_quests`, keyed uniquely by `(discord_id, quest_type, quest_date)`.
- Progress and completion are stored per quest row through `current_count`, `target_count`, and `completed`.
- Completion auto-grants the base Credux and Belief Shard reward exactly once by changing `completed` from false to true inside the caller's transaction.
- Players have two daily rerolls. A reroll replaces one row and resets its progress; the current code does not prohibit rerolling a completed row.
- Old daily rows are deleted after midnight PHT. The table is current-state tracking, not permanent daily completion history.

Supported daily objective types and sources:

| Objective type | Supported range | Progress source |
|---|---:|---|
| `raid_wins` | 3-10 | A won `crd raid` |
| `elite_defeats` | 2-5 | A won raid against an elite mob |
| `credux_spent` | 5,000-50,000, stored in units of 1,000 | Gear enhancement cost |
| `weapon_enhancements` | 2-5 | Each gear enhancement attempt, despite the historical name |
| `duel_wins` | 1-3 | Settled duel winner |
| `duel_challenges` | 2-5 | Settled duel challenger |

Weekly behavior:

- Five fixed objective types are tracked per PHT ISO week: all daily types except `duel_challenges`.
- Weekly targets are larger and each line grants Credux plus Valor.
- `weekly_grand` permanently records the once-per-week grand claim and grants one Sacred Relic plus bonuses when all five weekly rows are complete.

Unsupported behavior:

- There is no quest-chain or prerequisite model.
- There are no date-authored global quest lineups; daily quests are randomized per player.
- There are no generic objectives for boss attacks/kills, chest opening, summoning, attendance, item use, or currency earned.
- Adding a new objective type requires a definition plus progress calls in every gameplay path that produces it, and possibly a renderer icon mapping.

Daily completion is partly tracked already: the three current `daily_quests.completed` flags are enough to determine whether today's board is complete. It is not enough to make the event relic idempotent or auditable because yesterday's rows are deleted. A new event claim table is required.

Owner decision: leave both daily rerolls exactly as they are. The event adds no reroll restriction and changes no reroll code. A potentially easier event relic is accepted as less risky than modifying shared quest behavior for temporary code.

### Daily reset and event timezone

`crd daily` uses a fixed calendar boundary, not a rolling 24-hour timer:

```sql
(NOW() AT TIME ZONE 'Asia/Manila')::date
```

The reset scheduler also runs at `00:00 Asia/Manila`, which is `16:00 UTC` on the preceding UTC date. PHT is UTC+8 with no daylight-saving change.

Day 1 must therefore be defined by `Asia/Manila`, not UTC. The configured start must be midnight PHT with an explicit `+08:00` offset, and the end must be the exclusive midnight boundary exactly seven PHT calendar days later. Taipei currently shares UTC+8, but the code should keep `Asia/Manila` as the canonical name because that is the game's existing boundary.

Event day is:

```text
PHT calendar date(now) - PHT calendar date(start) + 1
```

It is valid only while `start <= now < end` and the result is 1 through 7. Missing a date does not alter this calculation or create catch-up eligibility.

### Event or feature-flag system

There is no general event registry or database-backed feature-flag system. The repository does have a lightweight environment-flag convention through `envBool`, used for flags such as `CASINO_ENABLED` and rendering controls.

Reuse that convention. Add a self-contained event config module with:

- `MONTHSARY_EVENT_ENABLED`, default false, as the manual kill switch.
- `MONTHSARY_EVENT_START_AT`, an ISO-8601 timestamp at midnight `+08:00`.
- A derived, not separately configured, exclusive end exactly seven PHT midnights after the start.
- `eventKey: 'monthsary_2026_08'`.
- Attendance and quest bonus bundles in this module, so reward increases are read as an additive event layer at grant time.

When enabled, a missing, invalid, or non-midnight start must fail closed. The module must derive the end from the start, then assert that it is also midnight PHT and exactly seven PHT calendar days later. There is no independently configurable end value that can drift from the start. Changing the kill switch requires updating the production environment and restarting the service, but not a git rollback. The derived scheduled end remains effective even if the rollback deploy is late.

Do not build a persistent generic event framework for a seven-day removable change.

### First-ever daily claim during the event

Registration creates `users` and `users_bag` together in one transaction. A registered player's first `crd daily` locks the bag and user rows, initializes both regular streaks to day 1, inserts event day attendance, and increments the existing bag columns. Both grants can therefore initialize cleanly in the same transaction. An unregistered player receives the existing registration message and gets neither grant.

### User deletion and retained foreign keys

The repository does have a user-deletion path. `src/commands/rpg/dev.js` implements non-production `crd dev resetplayer`; its whitelisted dynamic `DELETE_ORDER` ends with `users`, after deleting known child rows. Production blocks this destructive command, but it is a real supported development/reset path.

The retained event tables must therefore use `ON DELETE CASCADE`. Claim guards are not the audit record and have no meaning after their user is removed. Cascading them also lets `resetplayer` continue to delete the parent row without teaching temporary event table names to its permanent delete list. Permanent economy evidence remains in `game_logs`, which deliberately has no user foreign key and is preserved by `resetplayer`.

### Permanent `game_logs` action compatibility

Every repository reference to `game_logs` was checked. Runtime code only inserts rows. There is no application `SELECT` from `game_logs`, history command, profile/admin renderer, action-to-label map, icon lookup, switch, or handler for `game_logs.action`. The only non-insert references are schema/index definitions and comments in an old rollback migration.

`game_logs.action` is an unconstrained `varchar(30)`, so `MonthsaryAttendance` and `MonthsaryQuest` are accepted without schema changes. After the event revert, the rows remain inert, queryable audit data; no repository path attempts to render, skip, or dispatch on either string, so unknown actions cannot throw or produce broken output. Keep the descriptive event action strings rather than reusing `Daily` or `Quest`, because distinct values make permanent event grants auditable.

## 2. Approved event decisions

### Start and end

Day 1 is operationally selected after the reviewed build is merged, deployed, and verified. Do not choose a calendar date during implementation and never configure a past start.

Activation sequence:

1. Deploy the event code with no start configured, so it fails closed.
2. Set `MONTHSARY_EVENT_ENABLED=true`, restart, and confirm the new branch is live without granting anything. A controlled real `crd daily` invocation must retain normal behavior while logs confirm the inactive event path was evaluated.
3. Only after that verification, set `MONTHSARY_EVENT_START_AT` to the next midnight PHT boundary, expressed with `+08:00`, and restart.
4. Code derives the exclusive end from that start plus seven PHT calendar days.

Deploying and starting on the same PHT calendar day is forbidden. This prevents a partial day 1 and avoids excluding players who claimed regular daily before the event branch was live.

### Quest scope

Approved: "all of today's quests" means the player's existing three randomized daily quests. The event adds only the once-per-event-day Sacred Relic layer. There is no bespoke seven-day lineup, no new objective type, and no event branch in daily quest rolling.

### Rerolls

Approved: preserve the existing two rerolls per PHT day without restriction. The event never changes `refreshQuestLine()` or any reroll counter/state.

## 3. Database migration

Add `scripts/migrations/20260804_01_monthsary_event.sql` with exactly this additive migration:

The `20260804` prefix records the planning/creation date, not the future production application date. Migrations are applied manually and filename ordering has no runtime semantics. If the event branch is cut on a later date, renaming both migration and verification files to that actual creation date is acceptable; do not present the filename as the event start or deployment date.

```sql
-- Monthsary event claim guards. Event tables intentionally remain after code rollback.
BEGIN;

CREATE TABLE IF NOT EXISTS public.event_attendance (
  event_key  text NOT NULL,
  user_id    varchar(20) NOT NULL
    REFERENCES public.users(discord_id) ON DELETE CASCADE,
  event_day  smallint NOT NULL CHECK (event_day BETWEEN 1 AND 7),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_key, user_id, event_day)
);

CREATE TABLE IF NOT EXISTS public.event_quest_claims (
  event_key  text NOT NULL,
  user_id    varchar(20) NOT NULL
    REFERENCES public.users(discord_id) ON DELETE CASCADE,
  event_day  smallint NOT NULL CHECK (event_day BETWEEN 1 AND 7),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_key, user_id, event_day)
);

ALTER TABLE public.event_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_quest_claims ENABLE ROW LEVEL SECURITY;

COMMIT;
```

No RLS policies are added; the bot's privileged database role is the only runtime writer. Do not add a teardown migration. Do not alter `users`, `users_bag`, `daily_quests`, or any other existing table.

Add `scripts/migrations/20260804_01_monthsary_event_verify.sql` as a read-only check for:

- both tables and all four columns,
- `varchar(20)` user IDs,
- composite primary keys in the declared order,
- both day-range checks,
- both foreign keys with `ON DELETE CASCADE`,
- RLS enabled,
- zero duplicate `(event_key, user_id, event_day)` groups.

Do not add the temporary tables to `scripts/production-consolidated-schema.sql` or `src/db/schemaGuard.js`. The event migration and verification script are the deployment gate; changing permanent schema baselines would enlarge the revert and incorrectly make orphaned event tables a permanent boot requirement.

## 4. Runtime design

### New event config

Add `src/config/monthsaryEvent.js`.

- Export the event key, canonical timezone, parsed start/end instants, enabled state, and immutable reward bundles.
- Days 1-6: `{ sacredRelics: 1, bossTreasureChests: 1, bossGoldenChests: 0 }`.
- Day 7: `{ sacredRelics: 1, bossTreasureChests: 1, bossGoldenChests: 1 }`.
- Daily quest completion: `{ sacredRelics: 1 }`.
- Export a pure event-state helper for boundary testing.
- Parse only `MONTHSARY_EVENT_START_AT`; derive the exclusive end exactly seven PHT calendar days later.
- Fail closed and log a concise configuration error once when enabled config is missing or invalid.

This new layer must not import or modify `dailyReward`, `QUEST_DEFS`, boss rewards, level rewards, drop rates, summon rates, or cosmetic systems.

### New event grant module

Add `src/engine/monthsaryEvent.js` with transaction-bound functions; it must never open, commit, roll back, or release its own database connection.

`claimEventAttendance(client, userId, now?)`:

1. Resolve the active state and event day from config. Return `inactive` without a query when killed or outside `[start, end)`.
2. Insert `(event_key, user_id, event_day)` with `ON CONFLICT DO NOTHING RETURNING`. A conflict returns `already` and grants nothing.
3. Increment `users_bag.sacred_relics`, `boss_treasure_chest`, and, on day 7, `boss_golden_chest` using values from event config.
4. Require the bag update to affect exactly one row; throw otherwise so the caller rolls back the guard insert too.
5. Insert `game_logs` audit rows with action `MonthsaryAttendance`, using relic fields for Sacred Relics and chest fields for each chest type.
6. Return a structured result for the daily reply.

`claimEventQuestDay(client, userId, now?)`:

1. Resolve the active event day. Inactive or invalid configuration returns without opening a savepoint.
2. Issue `SAVEPOINT monthsary_quest_claim` inside this event module, before the first event claim statement.
3. Query today's PHT `daily_quests` and require exactly three rows with all three complete.
4. Insert the new `event_quest_claims` guard with `ON CONFLICT DO NOTHING RETURNING`.
5. On a new guard only, increment `users_bag.sacred_relics` by one and add a `MonthsaryQuest` relic audit row.
6. On success or a normal incomplete/already result, `RELEASE SAVEPOINT` and return the tagged result/notice.
7. On any event-claim error, `ROLLBACK TO SAVEPOINT monthsary_quest_claim`, then `RELEASE SAVEPOINT`, log the failure with user ID and resolved event day (or `unknown`), and return `error` with no notice. If savepoint recovery itself fails because the connection/transaction is no longer usable, rethrow because the caller transaction cannot be salvaged.

The savepoint belongs inside `src/engine/monthsaryEvent.js`, not `questProgress.js`. This keeps the temporary failure policy and savepoint name in the file deleted by the event revert. A quest-layer defect therefore forfeits only the optional event relic; it cannot roll back raid loot, a settled duel, gear enhancement, or the existing base quest reward.

This failure policy intentionally differs from attendance. `crd daily` remains all-or-nothing with no savepoint around its event grant: an event failure rolls back regular and event attendance so the player can retry the command.

The `users_bag` lock claim is verified, not assumed:

| Path | Lock acquired before event hook |
|---|---|
| `crd daily` | `claimDaily()` selects that user's `users_bag` row `FOR UPDATE`, then locks `users` |
| Raid quest completion | `raid.js` selects that user's `users_bag` row `FOR UPDATE` before character rewards and `progressQuests()` |
| Duel quest completion | `duel.js` locks both users' `users_bag` rows in sorted ID order, then both character rows, before `progressQuests()` |
| Enhance quest completion | `enhance.js` selects that user's `users_bag` row `FOR UPDATE` before gear mutation and `progressQuests()` |

All current callers therefore enter event logic with the bag row locked. A same-user daily claim and quest completion serialize on that row before either inserts an event guard; neither path first holds an event-table lock while waiting for the bag. The composite claim-table primary keys remain the structural final defense against duplicate grants, and `sacred_relics = sacred_relics + 1` remains an atomic increment.

This is a push grant, not a lazy pull. The exact call site is inside `progressQuests()` immediately after a successful `UPDATE daily_quests SET completed = TRUE ... RETURNING` has caused the existing base reward and logs to be written and `completionNotice(...)` to be appended (currently the completion branch at lines 163-195). Call `claimEventQuestDay()` there, before the loop continues, before weekly progress, and before the caller commits. Its aggregate sees three completed rows only when the third completion has just been persisted in that same transaction. If one action completes multiple objectives, earlier calls return incomplete and the call following the third flip grants once.

The event claim insert and `users_bag.sacred_relics` increment share that caller transaction. The primary key on `(event_key, user_id, event_day)` makes a second grant structurally impossible.

If the third quest is completed one second before the start boundary, the event is inactive and grants no relic. PostgreSQL `NOW()` is fixed at the transaction start, matching the existing daily queries, so a pre-boundary transaction does not become eligible merely because it commits after midnight. Those quests belong to the preceding PHT date; day 1 begins with the new post-midnight board and there is no retroactive claim.

### `crd daily` hook

Modify `src/commands/economy/daily.js` only at the transaction orchestration and reply composition points.

- Keep `dailyReward()` byte-for-byte unchanged.
- Keep `claimDaily()` responsible only for regular attendance.
- In `execute()`, after a successful `claimDaily()` result and before `COMMIT`, call `claimEventAttendance()` with the same client.
- If any regular or event query throws, roll back the whole transaction and keep the existing "nothing was changed" failure reply.
- Pass the event result into `buildDailyPayload()` and add a visually distinct `Monthsary Event - Day N` section after the regular attendance rewards.
- Show Sacred Relic and Boss Treasure Chest every active day; show Boss Golden Chest only on day 7.
- Preserve the existing missing/already behavior. The event should be enabled before day-1 midnight PHT so nobody has a same-day regular claim predating event activation.

This gives one command, one reply, and one database transaction for both grants.

### Quest hook

Modify `src/utils/questProgress.js` at one central point only.

- Do not modify `QUEST_DEFS`, rewards, target rolls, refresh rules, or any of the raid/duel/enhance call sites.
- In the newly-completed quest branch, immediately after that quest's base reward/logging, call `claimEventQuestDay()` in the same caller transaction.
- Append its notice to the existing return array when it grants the relic.
- Preserve the weekly progress call and weekly rewards unchanged.

Because `raid.js`, `duel.js`, and `enhance.js` already route all supported objective progress through `progressQuests()`, they need no event edits.

### Deployment configuration

Document the two temporary environment variables in the new `src/config/monthsaryEvent.js` header and in this plan. Do not touch `.env.example`; these variables disappear with temporary code and do not belong in the permanent environment template.

No command registration, slash definition, scheduler, renderer, chest, summon, bag, cosmetic, supporter, boss, or base reward file changes are needed.

## 5. Existing-file touch points and estimated diff

| Existing file | Planned change | Estimate |
|---|---|---:|
| `src/commands/economy/daily.js` | import, same-transaction event call, optional event reply section | 20-35 lines |
| `src/utils/questProgress.js` | import and one immediate hook in the successful quest-completion branch | 5-10 lines |

All other implementation is in new files. Exactly two existing files are touched, and the expected runtime modification is under 50 lines. Base quest rolling, rerolls, objective producers, and reward constants are unchanged.

New-file scope:

| New file | Responsibility | Estimate |
|---|---|---:|
| `src/config/monthsaryEvent.js` | fail-closed flag/window parsing, derived end, reward bundles, pure day calculation | 50-80 lines |
| `src/engine/monthsaryEvent.js` | transaction-bound attendance and third-quest-completion claim/grant functions | 120-170 lines |
| `scripts/migrations/20260804_01_monthsary_event.sql` | two additive claim tables and RLS | 30-40 lines |
| `scripts/migrations/20260804_01_monthsary_event_verify.sql` | read-only structure, constraint, RLS, and duplicate checks | 50-80 lines |
| `scripts/monthsary-event-selftest.js` | boundary, transaction, concurrency, payout, and rollback tests | 250-400 lines |
| `scripts/monthsary-event-db-selftest.js` | loopback-only disposable-Postgres migration and transaction integration tests | 250-400 lines |

The production runtime portion is roughly 200-300 new lines plus under 50 modified lines. The larger remaining estimate is isolated test and SQL code that is removed automatically with the event merge revert.

## 6. Attendance rollback-safety confirmation

The event attendance branch will never write to regular attendance state:

- no write to `users.last_daily_claim_date`,
- no write to `users.monthly_streak`,
- no write to `users.overall_streak`,
- no insert/update/delete against `daily_quests` for attendance,
- no reuse of a regular daily claim field as an event guard.

Its attendance claim state is written only to the new `event_attendance` table. Its quest claim state is written only to the new `event_quest_claims` table.

The event must also increment existing `users_bag` columns to deliver permanent rewards and write existing `game_logs` rows for audit. Those are inventory/audit writes, not attendance tracking, and they are intentionally permanent after rollback. This distinction is essential: "only new event tables" applies to event claim state, while earned items necessarily live in the existing bag.

**Direct confirmation:** the event branch in `crd daily` writes event claim state only to the new `event_attendance` table and writes rewards only to existing `users_bag` item columns; it touches no existing daily-attendance or streak table.

After the event code is reverted, `crd daily` has no reference to either event table and returns exactly to its baseline behavior.

## 7. Test and deployment plan

Add event-only `scripts/monthsary-event-selftest.js` for fast behavior checks and `scripts/monthsary-event-db-selftest.js` for the disposable-Postgres contract. The database script must refuse non-loopback hosts, a database whose name does not contain `monthsary_event_test`, and the exact configured `DATABASE_URL`.

Required cases:

1. Kill switch off, before start, exactly at end, and after end grant nothing.
2. Exactly at start is day 1; the final instant before end is day 7.
3. PHT midnight advances the event day at the same instant regular daily resets.
4. A third quest completed one second before start grants no event relic and is not caught up after midnight.
5. A day-1 claim, skipped day 2, and day-3 claim grants the day-3 bundle with no day-2 row.
6. Days 1-6 grant one relic plus one `btc`; day 7 also grants one `bgtc`.
7. Repeated and concurrent attendance attempts produce one event row and one reward bundle.
8. A registered user's first-ever daily initializes regular and event attendance together.
9. An injected event failure rolls back the regular claim, event guard, bag increments, and log rows.
10. Inject a failure inside `claimEventQuestDay()` after its savepoint. Assert the gameplay transaction still commits, the raid/duel/enhancement result and base quest reward remain, and no event guard or event relic exists.
11. Fewer than three daily quests or any incomplete row does not grant the quest relic.
12. The transaction that flips the third completion also inserts the event guard and grants exactly one relic; retries and rerolls cannot grant a second.
13. Across all seven event days, event-origin Sacred Relics cannot exceed 14: seven attendance plus seven quest claims.
14. Fire a `crd daily` claim and the same user's third-quest completion simultaneously. Set a bounded statement/test timeout; assert both transactions commit without deadlock, exactly one attendance row and one quest-claim row exist, and exactly two Sacred Relics land.
15. Insert both claim rows for a disposable user, delete the parent `users` row through the test's FK-safe cleanup, and assert both guards cascade while the deliberately unlinked `game_logs` audit rows remain.
16. No cosmetic or supporter-token column is referenced.

Pre-deployment sequence:

1. Confirm `main` is still the healthy baseline and working tree is clean.
2. Create and push the immutable baseline tag before event code is written:

   ```bash
   git tag -a v-pre-monthsary-event main -m "Baseline before monthsary event"
   git push origin v-pre-monthsary-event
   ```

   Record the commit resolved by the tag. For this implementation, `v-pre-monthsary-event` resolves to `98f33ec`. The existing `backup/pre-event-monthsary` branch is not a substitute: its tree predates the deployment workflow and README deployment changes now present on `main`.
3. Create the event branch and keep all event implementation in it.
4. Apply the additive migration to a disposable database twice; run the verify SQL and both event selftests.
5. Apply the migration to production, run the verification SQL, and confirm the two tables are empty.
6. Leave the start unset and keep the code fail-closed while deploying.
7. Merge through one explicit `--no-ff` merge commit and deploy `main`.
8. Run existing regression tests plus the event selftest.
9. Set the kill switch true, restart, and use a controlled real `crd daily` invocation plus logs to verify the inactive branch in production.
10. Set start to the next midnight PHT boundary, restart, and verify the derived end is exactly seven PHT midnights later. Never set a past start.
11. Record the baseline tag target and event merge commit hash for rollback.

Operational checks during the event:

- Daily counts by `event_key` and `event_day` for both event tables.
- Confirm no `(event_key, user_id, event_day)` duplicates are possible.
- Compare attendance grants with `MonthsaryAttendance` logs and quest grants with `MonthsaryQuest` logs.
- If grants look wrong, set `MONTHSARY_EVENT_ENABLED=false` and restart first; investigate before considering a code revert.

## 8. Rollback checklist

After the exclusive end timestamp has passed:

Commit ledger to fill during delivery:

| Ref | Exact value to record | Rollback role |
|---|---|---|
| `B` | `98f33ecf65ab7a0d70935d81394a42dfaa792872` (`v-pre-monthsary-event`) | Immutable verification baseline; never force-reset to it |
| `E1` | `65546d4a477b2c0ecfe5a49e65248fdba56f6bdb` | Event-only implementation commit; do not revert individually |
| `M` | Pending review and `--no-ff` merge into current `main` | The one and only target of `git revert -m 1 M` |
| `R` | Pending event completion | Permanent record that removed event code |

`main` advanced after the branch cut to `05b5ff5` with boss-immunity changes in non-overlapping files. Review and integrate current `main` before creating `M`. Recording the exact merge commit `M` remains a mandatory deployment checklist item. No event implementation commit may land directly on `main`; otherwise one merge revert would be incomplete.

1. Confirm the config window has stopped new grants; optionally set the kill switch false immediately.
2. Resolve the recorded `M` hash and verify it is a merge commit whose first parent is the pre-merge `main` line and whose second parent contains all event-only commits.
3. On current `main`, create the rollback commit without rewriting history:

   ```bash
   git revert -m 1 M
   git push origin main
   ```

4. The revert must remove these new files:
   - `src/config/monthsaryEvent.js`
   - `src/engine/monthsaryEvent.js`
   - `scripts/migrations/20260804_01_monthsary_event.sql`
   - `scripts/migrations/20260804_01_monthsary_event_verify.sql`
   - `scripts/monthsary-event-selftest.js`
   - `scripts/monthsary-event-db-selftest.js`
   - `scripts/monthsary-event-selftest.js`
5. The revert must undo only the event blocks in:
   - `src/commands/economy/daily.js`
   - `src/utils/questProgress.js`
6. Deploy the revert commit. Remove the unused event environment variables later; leaving them configured is harmless once no code reads them.
7. Verify removal:

   ```bash
   git diff v-pre-monthsary-event main
   git grep -n "monthsary_2026_08\|MONTHSARY_EVENT\|event_attendance\|event_quest_claims"
   ```

   The diff may contain hotfixes made during the seven-day window, but no event code. `git grep` should return no runtime or migration references after the revert; this planning document may still mention the terms if it was committed separately.
8. Run the baseline daily and quest regression checks after the revert.

Database objects deliberately left behind:

- `public.event_attendance`, including all claim rows,
- `public.event_quest_claims`, including all claim rows,
- their primary keys, checks, `ON DELETE CASCADE` foreign keys, and RLS settings,
- permanent item balances already added to `users_bag`,
- permanent `game_logs` audit rows.

Do not drop tables, delete event rows, reverse inventory increments, or claw back rewards. Keep the `v-pre-monthsary-event` tag as the immutable verification reference.

## 9. Phase 1 conclusion

The event is feasible with a small additive diff. The safest implementation adds two new claim tables, one new config module, one new transaction-bound grant module, and two narrow runtime hooks. Base reward files remain untouched. Maximum event payout is exactly 14 Sacred Relics, and all 14 have an existing use.

Quest scope and reroll behavior are approved. The start timestamp is intentionally not chosen during implementation: it is set to the next midnight PHT only after the reviewed build is merged, deployed fail-closed, enabled, and verified in production. Stop here for plan review; do not begin implementation.
