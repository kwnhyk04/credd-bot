# Handoff

Timestamp: 2026-07-07 06:45:31 +08:00

## Current Request

Created this handoff file at the user's request.

The attached pasted text for this turn contains a larger follow-up implementation request for remaining Railway env-backed production optimizations. That follow-up implementation has not been started in this turn. The current action is only this handoff log.

## Starting Context

The worktree already contained uncommitted Phase 1 production cost optimization changes. The user previously asked to implement Phase 1 and explicitly said not to commit.

Current uncommitted changes are implementation files only. No `docs/`, `AGENT.md`, or `AGENTS.md` files were modified.

## Actions Completed Earlier

1. Read local project instructions.
   - Read `AGENT.md`.
   - Noted repo instruction not to push/include agent instructions in GitHub-facing work.
   - Followed the user's restriction not to modify docs or agent files.

2. Read the prior attached Phase 1 request.
   - Scope was Phase 1 production cost optimization only.
   - Main goals were attachment egress guard logging, boss status refresh debounce, duplicate render fallback removal, casino startup gating, and lightweight measurement.

3. Inspected recent commits and current implementation.
   - Reviewed latest commits including:
     - `0fad9b3 Update character creation guidance`
     - `a3118df Use custom reward emojis when permitted`
     - `3c27a32 Fallback when battle edit is blocked`
     - `bf3b502 Handle raid render permission failures`
     - `c251108 Guard bot egress paths`
   - Confirmed existing production egress guard behavior before editing.

4. Added production-safe runtime logging helper.
   - Added `src/utils/runtimeLogs.js`.
   - Supports safe env parsing helpers and compact logs for:
     - bandwidth events
     - performance events
     - critical egress warnings
   - Metadata is whitelisted to avoid logging secrets, signed URLs, tokens, or full sensitive URLs.

5. Strengthened attachment fallback visibility.
   - Updated `src/utils/egressGuard.js`.
   - Kept Railway/production Discord image attachment blocking intact.
   - Added structured logging when attachment fallback is attempted or blocked.
   - Existing `ALLOW_DISCORD_IMAGE_ATTACHMENTS=false` behavior remains enforced.

6. Updated optimized image output handling.
   - Updated `src/utils/imageOutput.js`.
   - Added `attachmentFromOptimizedImage()` so an already-optimized buffer can be attached without re-rendering.
   - Added performance logs for output byte size when `PERFORMANCE_LOGS=true`.
   - Kept existing JPEG/PNG optimization behavior intact.

7. Added reusable cache-miss image support.
   - Updated `src/utils/canvasCache.js`.
   - Added optional `returnImageOnFailure` behavior.
   - If R2 upload or cache miss storage fails after rendering, callers can reuse the already-optimized image buffer.
   - Avoids rendering the same canvas twice for one command execution.
   - No global large-buffer storage was added.

8. Removed duplicate render-on-fallback paths.
   - Updated these callers to reuse cache miss buffers where applicable:
     - `src/engine/battleRender.js`
     - `src/engine/bossSystem.js`
     - `src/commands/rpg/profile.js`
     - `src/commands/rpg/stats.js`
     - `src/commands/rpg/create.js`
     - `src/commands/rpg/equipment.js`
     - `src/commands/rpg/deity.js`
     - `src/commands/economy/quests.js`
     - `src/casino/casinoRender.js`
   - Fallbacks still respect the production attachment guard.

9. Added boss live status image debounce/coalescing.
   - Updated `src/engine/bossSystem.js`.
   - Added `BOSS_IMAGE_REFRESH_DEBOUNCE_MS`, default `15000`.
   - Added `BOSS_IMAGE_REFRESH_ENABLED`, default `true`.
   - Nonlethal boss attacks now schedule a shared live message refresh instead of awaiting a full image refresh per attack.
   - Multiple attacks within the debounce window coalesce into one pending refresh per guild.
   - Pending timers are cleared when:
     - boss dies
     - boss expires
     - live message is deleted
     - spawn is replaced
   - Immediate attacker responses are preserved.
   - Boss damage, rewards, cooldowns, and battle logic were not changed.

10. Added text-only boss refresh mode.
    - If `BOSS_IMAGE_REFRESH_ENABLED=false`, boss refresh skips generated status image rendering.
    - Boss HP, stats, and passive information still appear as text.

11. Disabled casino startup work by default.
    - Updated `index.js`.
    - Added `CASINO_ENABLED=false` default behavior.
    - When casino is disabled:
      - casino image/GIF prewarm is skipped
      - stale casino session recovery interval is not started
    - Added startup log showing casino enabled/disabled state.

12. Preserved casino re-enable path.
    - Updated `src/handlers/commandHandler.js`.
    - Updated `src/handlers/interactionHandler.js`.
    - Casino commands and blackjack/crash buttons remain disabled by default.
    - If `CASINO_ENABLED=true`, the existing casino command/button handlers are loaded again.
    - Casino code was not deleted.

13. Added metadata to direct attachment fallback paths.
    - Updated:
      - `src/commands/economy/daily.js`
      - `src/engine/renderSummon.js`
      - `src/commands/rpg/summon.js`
      - `src/engine/skinShopViews.js`
      - `src/engine/bossSystem.js`
      - `src/casino/casinoRender.js`
    - Logs include available command/system, image type, byte size, guild ID, and user ID.

14. Updated `.env.example`.
    - Added:
      - `BANDWIDTH_LOGS=false`
      - `PERFORMANCE_LOGS=false`
      - `BOSS_IMAGE_REFRESH_DEBOUNCE_MS=15000`
      - `BOSS_IMAGE_REFRESH_ENABLED=true`
      - `CASINO_ENABLED=false`

## Validation Completed Earlier

1. Ran `node --check` on edited JavaScript files.
   - All checked files passed.

2. Ran full self-test suite with `npm.cmd run selftest:full`.
   - Battle selftest: 137 passed, 0 failed.
   - Help selftest: 154 passed, 0 failed.
   - Casino selftest: 171 passed, 0 failed.

3. Ran `git diff --check`.
   - Passed.
   - Output included expected Windows line-ending warnings only.

4. Confirmed no database schema changes.

5. Confirmed no gameplay balance changes.

6. Confirmed no public command name changes.

7. Confirmed no Discord intent changes.

8. Confirmed no docs or agent instruction files were modified.

## Current Pending Files

The Phase 1 worktree currently has uncommitted changes in:

- `.env.example`
- `index.js`
- `src/casino/casinoRender.js`
- `src/commands/economy/daily.js`
- `src/commands/economy/quests.js`
- `src/commands/rpg/create.js`
- `src/commands/rpg/deity.js`
- `src/commands/rpg/equipment.js`
- `src/commands/rpg/profile.js`
- `src/commands/rpg/stats.js`
- `src/commands/rpg/summon.js`
- `src/engine/battleRender.js`
- `src/engine/bossSystem.js`
- `src/engine/renderSummon.js`
- `src/engine/skinShopViews.js`
- `src/handlers/commandHandler.js`
- `src/handlers/interactionHandler.js`
- `src/utils/canvasCache.js`
- `src/utils/egressGuard.js`
- `src/utils/imageOutput.js`
- `src/utils/runtimeLogs.js`
- `Handoff.md`

## Current Env Vars Supported By Phase 1 Changes

- `ALLOW_DISCORD_IMAGE_ATTACHMENTS`
- `BANDWIDTH_LOGS`
- `PERFORMANCE_LOGS`
- `BOSS_IMAGE_REFRESH_DEBOUNCE_MS`
- `BOSS_IMAGE_REFRESH_ENABLED`
- `CASINO_ENABLED`

## Recommended Railway Env Vars From Phase 1

```env
ALLOW_DISCORD_IMAGE_ATTACHMENTS=false
BANDWIDTH_LOGS=true
PERFORMANCE_LOGS=true
BOSS_IMAGE_REFRESH_DEBOUNCE_MS=15000
BOSS_IMAGE_REFRESH_ENABLED=true
CASINO_ENABLED=false
```

## Follow-Up Implementation Completed

Timestamp: 2026-07-07 16:13:24 +08:00

This section supersedes the earlier "Not Yet Implemented" list. The remaining env-backed production optimization request has been implemented without committing.

Actions completed in this follow-up:

1. Added robust env parsing/log helpers in `src/utils/runtimeLogs.js`.
   - Added boolean, number, integer, positive integer, and bounded integer parsing helpers.
   - Added one-time warnings for malformed env values.
   - Expanded safe structured log metadata for image bytes, formats, resource stats, cache counters, queue wait time, and CPU/RAM fields.

2. Added an image render/encode semaphore in `src/utils/imageWorkQueue.js`.
   - Supports `IMAGE_RENDER_CONCURRENCY`.
   - Defaults to `2` in code when unset.
   - Railway/example value is `1`.
   - Uses `try/finally` release logic to avoid stuck queue slots.
   - Emits performance logs for queue wait and render/encode duration when `PERFORMANCE_LOGS=true`.

3. Added WebP and aggressive compression support in `src/utils/imageOutput.js`.
   - Supports `IMAGE_OUTPUT_FORMAT=webp`.
   - Supports `IMAGE_WEBP_QUALITY=65`.
   - Supports `IMAGE_COMPRESSION_AGGRESSIVE=true`.
   - WebP is attempted first when allowed.
   - Opaque images flatten to the configured background.
   - Transparent renderers can preserve alpha with `preserveTransparency: true`.
   - Fallback order is WebP -> optimized PNG for transparent images, or WebP -> JPEG -> original PNG for opaque images.
   - Attachment filenames/content now preserve `.webp`, `.jpg`, or `.png` as appropriate.
   - The existing Railway attachment guard still runs before Discord attachment fallback.

4. Updated the canvas/R2 render cache in `src/utils/canvasCache.js`.
   - Render and encode now share the image work queue.
   - R2 cache objects can now be `.webp`, `.jpg`, or `.png`.
   - R2 upload content type now follows the actual optimized image type.
   - Existing fallback behavior is preserved.
   - Optional `returnImageOnFailure` still reuses an already-rendered optimized image when R2 upload/cache write fails, avoiding duplicate render work.
   - Added canvas cache stats for resource logging.

5. Added env-backed remote asset disk caching in `src/utils/assets.js`.
   - Supports `ASSET_DISK_CACHE_ENABLED=true`.
   - Supports `ASSET_MEMORY_CACHE_MAX=100`.
   - Disk cache path is `.cache/assets`.
   - Cache identity includes the normalized asset URL path and `ASSET_VERSION`, excluding query strings.
   - Remote asset downloads now record disk hits/misses and downloaded bytes.
   - Disk cache writes are opportunistic and do not block normal asset fallback behavior.
   - Verified `.cache/` is already ignored by Git; no `.gitignore` edit was needed.

6. Added a production resource monitor in `src/utils/resourceMonitor.js`.
   - Supports `RESOURCE_LOGS=true`.
   - Supports `RESOURCE_LOG_INTERVAL_MS=300000`.
   - Logs RSS, heap, external memory, array buffers, uptime, CPU delta, asset cache counts, disk hits/misses, canvas cache counts, profile cache count, and image queue state.
   - Started from `index.js` after startup cache intervals are configured.
   - Stopped during graceful shutdown.

7. Added a short-lived profile image URL cache in `src/utils/profileImageCache.js`.
   - Supports `PROFILE_IMAGE_CACHE_TTL_MS=60000`.
   - Supports `PROFILE_IMAGE_CACHE_MAX=50`.
   - Stores only URL/signature/timestamp, not image buffers.
   - Uses a signature of profile render revision plus assembled profile data.
   - `PROFILE_IMAGE_CACHE_TTL_MS=0` disables the cache.
   - Emits hit/miss performance logs when `PERFORMANCE_LOGS=true`.

8. Updated `src/commands/rpg/profile.js`.
   - Checks the short TTL profile URL cache before R2 lookup/render.
   - Stores R2-backed profile URLs in the short TTL cache.
   - Does not cache Discord attachment fallback buffers.
   - Keeps public command behavior unchanged.

9. Updated transparent deity rendering paths in `src/commands/rpg/deity.js`.
   - `deities` collection grid now passes `preserveTransparency: true`.
   - Attachment fallbacks still use the same guard and log context.

10. Updated the daily attendance fallback in `src/commands/economy/daily.js`.
    - The generated attendance banner fallback now goes through `makeOptimizedAttachment`.
    - This enables WebP/compression behavior for the fallback while preserving the existing R2 zero-egress path.
    - Added log context for daily banner attachment fallback.

11. Updated `.env.example`.
    - Added the requested env-backed optimization variables.
    - Kept Phase 1 envs present.
    - Did not modify `.env`.

12. Confirmed constraints were preserved.
    - No docs files were modified.
    - `AGENT.md` and `AGENTS.md` were not modified.
    - No gameplay balance changes were made.
    - No public command names were changed.
    - No database schema changes were made.
    - No Discord intents were changed.
    - No commit was created.

## Follow-Up Railway Env Vars

```env
ALLOW_DISCORD_IMAGE_ATTACHMENTS=false
BANDWIDTH_LOGS=true
PERFORMANCE_LOGS=true
IMAGE_OUTPUT_FORMAT=webp
IMAGE_WEBP_QUALITY=65
IMAGE_COMPRESSION_AGGRESSIVE=true
IMAGE_RENDER_CONCURRENCY=1
RESOURCE_LOGS=true
RESOURCE_LOG_INTERVAL_MS=300000
PROFILE_IMAGE_CACHE_TTL_MS=60000
PROFILE_IMAGE_CACHE_MAX=50
ASSET_DISK_CACHE_ENABLED=true
ASSET_MEMORY_CACHE_MAX=100
BOSS_IMAGE_REFRESH_DEBOUNCE_MS=15000
BOSS_IMAGE_REFRESH_ENABLED=true
CASINO_ENABLED=false
```

## Follow-Up Validation

1. Ran `node --check` on all new utility files.
   - `src/utils/runtimeLogs.js`
   - `src/utils/imageWorkQueue.js`
   - `src/utils/imageOutput.js`
   - `src/utils/canvasCache.js`
   - `src/utils/assets.js`
   - `src/utils/resourceMonitor.js`
   - `src/utils/profileImageCache.js`
   - All passed.

2. Ran `node --check` on touched startup/command/engine files.
   - `index.js`
   - `src/commands/rpg/profile.js`
   - `src/commands/rpg/deity.js`
   - `src/commands/economy/daily.js`
   - `src/engine/battleRender.js`
   - `src/engine/bossSystem.js`
   - `src/engine/renderSummon.js`
   - `src/casino/casinoRender.js`
   - `src/handlers/commandHandler.js`
   - `src/handlers/interactionHandler.js`
   - `src/commands/rpg/create.js`
   - `src/commands/rpg/stats.js`
   - `src/commands/rpg/equipment.js`
   - `src/commands/economy/quests.js`
   - `src/commands/rpg/summon.js`
   - `src/engine/skinShopViews.js`
   - `src/utils/egressGuard.js`
   - All passed.

3. Ran `git diff --check`.
   - Passed.
   - Output included only expected Windows CRLF warnings.

4. Ran `npm.cmd run selftest:full`.
   - Battle selftest: 137 passed, 0 failed.
   - Help selftest: 154 passed, 0 failed.
   - Casino selftest: 171 passed, 0 failed.

5. Ran a targeted WebP smoke test.
   - Set `IMAGE_OUTPUT_FORMAT=webp`, `IMAGE_WEBP_QUALITY=65`, `IMAGE_COMPRESSION_AGGRESSIVE=true`, `IMAGE_RENDER_CONCURRENCY=1`, and `ALLOW_DISCORD_IMAGE_ATTACHMENTS=true`.
   - Generated a tiny canvas attachment through `makeOptimizedAttachment`.
   - Confirmed output name was `smoke.webp`.

## Important Notes For Next Agent

- Do not commit unless explicitly asked.
- Do not modify `docs/`, `AGENT.md`, or `AGENTS.md`.
- Do not weaken the Railway attachment egress guard.
- Do not change gameplay balance, public command names, database schema, or required Discord intents.
- Run `node --check` on edited JS files.
- Run `npm.cmd run selftest:full` on Windows because `npm` may be blocked by PowerShell execution policy.
- Run `git diff --check`.

## Pre-Commit Cost Optimization Pass

Timestamp: 2026-07-07 16:33:28 +08:00

Implemented the remaining safe pre-commit production cost optimizations from the audit. No commit was created.

Actions completed:

1. Throttled `canvas_cache.last_used_at` writes in `src/utils/canvasCache.js`.
   - Added per-cache-key touch throttling.
   - Added `CANVAS_CACHE_TOUCH_THROTTLE_MS=300000`.
   - Memory hits and DB hits no longer write `last_used_at` every time.
   - Throttled touches log only when `PERFORMANCE_LOGS=true`.
   - Cache eviction now also drops touch bookkeeping.

2. Throttled `user_guild_activity` writes in `src/handlers/middleware.js`.
   - Added per-user/guild write throttling after command cooldown passes.
   - Added `USER_ACTIVITY_WRITE_THROTTLE_MS=60000`.
   - Activity tracking remains enabled.
   - Throttled writes log only when `PERFORMANCE_LOGS=true`.
   - The in-memory throttle map trims stale entries if it grows beyond 10,000 keys.

3. Reduced `ORDER BY RANDOM()` hotspots.
   - Added `src/utils/selectionPools.js`.
   - Added `SELECTION_POOL_CACHE_TTL_MS=300000`.
   - Added `SELECTION_POOL_CACHE_MAX=50`.
   - `src/engine/summonEngine.js`: deity roster rows are loaded by tier and sampled uniformly in JS.
   - `src/commands/rpg/open.js`: weapon, armor, and rune roster rows are loaded by eligible pool and sampled uniformly in JS.
   - `src/commands/rpg/ranked.js`: dynamic ranked candidate sets are not cached, but SQL random sort was replaced with JS uniform sampling from each existing matchmaking window.
   - Drop tiers, weights, ownership, pity, duplicate handling, and reward probabilities were not changed.

4. Added boss log cache caps in `src/engine/bossSystem.js`.
   - Added `BOSS_LOG_CACHE_MAX_ATTACKERS=50`.
   - Added `BOSS_LOG_CACHE_MAX_EVENTS_PER_ATTACKER=20`.
   - Cached boss sims are compacted to recent log events only.
   - Per-spawn attacker log entries are capped with oldest-entry eviction.
   - Boss runtime caches are purged on spawn replacement, boss death, boss expiry, and live message deletion.
   - Reward calculation remains database-backed and unchanged.

5. Updated `.env.example`.
   - Added only the new env vars for this pass.
   - Did not modify `.env`.

6. Confirmed scope constraints.
   - No docs files were modified.
   - `AGENT.md` and `AGENTS.md` were not modified.
   - No gameplay balance changes were made.
   - No public command names were changed.
   - No database schema changes were made.
   - No Discord intents were changed.
   - No files were staged.

Validation in this pass:

1. Ran `node --check` on 29 modified/new JavaScript files.
   - Passed.

2. Ran `npm.cmd run selftest:full`.
   - Battle selftest: 137 passed, 0 failed.
   - Help selftest: 154 passed, 0 failed.
   - Casino selftest: 171 passed, 0 failed.

3. Ran `npm.cmd run preflight`.
   - First run reached DB validation but sandbox networking blocked the DB connection.
   - Escalated read-only rerun reached the database but failed with `password authentication failed for user "postgres"`.
   - Asset/env checks before the DB step passed.
   - Existing optional chest GIF warnings remain.

4. Ran `git diff --check`.
   - Passed.
   - Output included only expected Windows CRLF warnings.

5. Ran final status review.
   - No files are staged.
   - `Handoff.md` remains untracked/local and should not be staged unless intentionally public.

Do not stage or commit `Handoff.md` unless the handoff log is intentionally meant to be public.

## Avatar System Implementation

Timestamp: 2026-07-07 18:55:33 +08:00

Implemented the initial current-class avatar system requested in the latest attachment. No files were staged, committed, or pushed.

Actions completed:

1. Added avatar data/model support in `src/engine/avatarSystem.js`.
   - Uses the existing Cloudflare/R2 asset resolver pattern through `assetPath(...)`.
   - Does not assume the old local asset folder exists.
   - Avatar catalog rows store R2-relative asset paths under:
     - `skins/avatars/male/<class>`
     - `skins/avatars/female/<class>`
   - Example paths:
     - `skins/avatars/male/swordsman/...`
     - `skins/avatars/female/swordsman/...`
   - Default stats avatar uses current class art from `classes/<class>.png`.
   - If no avatar is equipped, or the equipped avatar is not valid for the current class, stats falls back to the default class avatar.

2. Added avatar commands in `src/commands/rpg/avatar.js`.
   - New prefix commands:
     - `crd avatars`
     - `crd avatar shop`
     - `crd avatar buy <id>`
     - `crd avatar equip <id>`
     - `crd avatar default`
   - New slash commands:
     - `/avatars`
     - `/avatar shop`
     - `/avatar buy id:<id>`
     - `/avatar equip id:<id>`
     - `/avatar default`
   - `crd avatars` and `/avatars` show only owned avatars for the current class, plus the always-available default class avatar.
   - `crd avatar shop` and `/avatar shop` show active catalog avatars for the current class.
   - Pagination is capped at 10 avatars per page.
   - Button controls are owner-gated under the `avat:` custom id namespace.

3. Added class filtering and ownership/equip rules.
   - Shop and collection are filtered to the player's current class.
   - Buying rejects avatars for another class.
   - Equipping rejects avatars for another class.
   - Equipping requires ownership unless developer unlock is active.
   - `crd avatar default` clears the equipped avatar override.

4. Added pricing rules.
   - `cyber` avatars cost 9 supporter tokens.
   - `anime` avatars cost 12 supporter tokens.
   - `webtoon` avatars cost 15 supporter tokens.
   - Runtime purchase logic enforces the style price from code.
   - The migration also adds a database check constraint for the style/token-cost pairing.

5. Added developer account non-production unlock behavior.
   - Uses the existing central `DEV_ACCOUNT_IDS` source.
   - Developer accounts can view/equip all class-valid avatars only when avatar dev unlocks are enabled.
   - Dev unlock defaults on when `NODE_ENV` is not `production` or `BETA_MODE=true`.
   - Added `AVATAR_DEV_UNLOCKS=false` to `.env.example` so non-production Railway deployments can explicitly enable it without enabling it in production.
   - Added `AVATAR_DEV_UNLOCKS` to production preflight dangerous flag checks.

6. Added stats layout/avatar rendering changes.
   - `src/commands/rpg/stats.js` now resolves `data.avatarPath` before cache lookup.
   - Stats render revision bumped from `2` to `3`.
   - `src/engine/renderStats.js` now prefers game avatar/class art over Discord profile image.
   - Default stats layout moves the name/title lower in the left header and draws the avatar/class image in the right avatar slot.
   - `src/engine/statsLayoutRenderer.js` now uses `d.avatarPath` for skin-based stats layouts too.
   - Bottom combat stats/records layout was left unchanged.

7. Added database migration.
   - New file: `scripts/avatar-system-schema.sql`.
   - Updated `.gitignore` to allow this migration file through the repo's broad `*.sql` ignore rule.
   - Adds idempotent schema for:
     - `avatar_catalog`
     - `user_avatars`
     - `equipped_avatars`
   - Adds indexes:
     - `idx_avatar_catalog_class_style_gender`
     - `idx_user_avatars_user`
     - `idx_equipped_avatars_avatar`
   - Updated `scripts/production-preflight.js` to require the avatar tables, columns, and indexes.

8. Updated command routing and help.
   - `src/handlers/commandHandler.js` registers `avatars` and `avatar`.
   - `src/handlers/interactionHandler.js` routes avatar pagination buttons.
   - `src/commands/slashDefinitions.js` registers `/avatars` and `/avatar`.
   - `src/commands/help.js` lists avatar commands under Account & Profile.

How to test:

1. Apply `scripts/avatar-system-schema.sql` to the target database.
2. Insert active `avatar_catalog` rows with asset paths under `skins/avatars/male/<class>` or `skins/avatars/female/<class>`.
3. Run `crd avatar shop` and `/avatar shop`; confirm only the current class appears.
4. Run `crd avatars` and `/avatars`; confirm only owned current-class avatars plus `default` appear.
5. Try `crd avatar buy <id>` and `/avatar buy id:<id>` as a normal user with and without enough supporter tokens.
6. Try `crd avatar equip <id>` and `/avatar equip id:<id>` for owned, unowned, and wrong-class avatars.
7. Try `crd avatar default` and `/avatar default`; confirm stats uses current class art.
8. Enable `AVATAR_DEV_UNLOCKS=true` in a non-production environment for a `DEV_ACCOUNT_IDS` user; confirm class-valid avatars can be viewed/equipped without purchase.
9. Run `crd stats` or `/stats`; confirm the right avatar slot shows the equipped avatar or default class avatar and that name/title text does not overlap.

Notes:

- No `docs/` files were edited.
- `AGENT.md` and `AGENTS.md` were not edited.
- No commit was created.

## Avatar Fix Follow-Up

Timestamp: 2026-07-07 19:06:42 +08:00

Implemented fixes from the screenshots showing the stats avatar placement and empty avatar shop/list.

Actions completed:

1. Fixed skin-based stats avatar layout in `src/engine/statsLayoutRenderer.js`.
   - User name and equipped title are now centered in the header.
   - The avatar is moved out of the header and into a portrait frame below the separator/content break.
   - Avatar rendering now supports rectangular portrait boxes with contain-style image fitting, so class/avatar art is not forced into a square crop.

2. Fixed default stats renderer layout in `src/engine/renderStats.js`.
   - User name and equipped title are centered in the header.
   - The default renderer also draws the stats avatar below the separator.
   - The avatar frame is portrait ratio instead of square.
   - Image fitting preserves source ratio inside the portrait frame.

3. Fixed empty avatar shop/catalog behavior in `src/engine/avatarSystem.js`.
   - Added runtime seeding for the conventional avatar catalog rows when avatar commands run and the avatar tables already exist.
   - Seeded rows follow the Cloudflare/R2 relative path pattern:
     - `skins/avatars/male/<class>/<style>.png`
     - `skins/avatars/female/<class>/<style>.png`
   - Seeded classes: Swordsman, Fighter, Mage, Knight, Archer.
   - Seeded genders: male, female.
   - Seeded styles/prices:
     - cyber = 9 supporter tokens
     - anime = 12 supporter tokens
     - webtoon = 15 supporter tokens
   - Shop price text now says `supporter tokens`.

4. Updated `scripts/avatar-system-schema.sql`.
   - Added the same 30 conventional catalog seed rows to the migration.
   - Uses `ON CONFLICT (avatar_key) DO UPDATE` so rerunning the migration refreshes price/path/display data safely.

5. Adjusted developer account non-production unlock behavior.
   - `AVATAR_DEV_UNLOCKS` still overrides explicitly.
   - Default unlock behavior now also treats Railway environments whose name is not `production` or `prod` as non-production, even when `NODE_ENV=production`.
   - Updated `.env.example` comment to document this.

Follow-up test notes:

1. Run or rerun `scripts/avatar-system-schema.sql`, or let the avatar command runtime seed rows after the tables exist.
2. On the non-prod bot, confirm `RAILWAY_ENVIRONMENT` or `RAILWAY_ENVIRONMENT_NAME` is not `production`/`prod`, or set `AVATAR_DEV_UNLOCKS=true`.
3. Run `crd avatar shop`; it should show class-filtered seeded avatar rows with supporter-token prices.
4. Run `crd avatars` as a dev account in non-prod; it should show the default plus all class-valid seeded avatars.
5. Run `crd stats`; the avatar should render below the separator in a portrait frame, with centered name/title.

## Avatar Shop Polish And Dev Grants

Timestamp: 2026-07-07 21:06:26 +08:00

Implemented the requested avatar shop row/header polish and added dev ownership SQL.

Actions completed:

1. Updated `src/engine/avatarSystem.js`.
   - Avatar shop header now uses the same supporter shop header emoji via `iconShop()`.
   - Avatar shop header text now matches the supporter shop style: `Supporter Shop`.
   - Avatar shop rows now render as:
     - supporter token emoji
     - price
     - short avatar id
     - `:frame_photo:`
     - display name
   - Class name is no longer shown in avatar display names.
   - Display names are now `Cyber Male Avatar`, `Cyber Female Avatar`, `Anime Male Avatar`, etc.
   - Short IDs are class-scoped:
     - `cm` = Cyber Male
     - `cf` = Cyber Female
     - `am` = Anime Male
     - `af` = Anime Female
     - `wm` = Webtoon Male
     - `wf` = Webtoon Female
   - Runtime seed rows now use avatar keys like `mage_cm`, while the UI and commands use the class-scoped short IDs like `cm`.
   - Runtime seed cleanup disables the older long keys such as `mage_male_cyber` to avoid duplicate rows if they were already seeded.

2. Updated `src/commands/rpg/avatar.js`.
   - `crd avatar buy <id>` and `crd avatar equip <id>` now resolve short IDs inside the user's current class.
   - Replies now show short IDs instead of full internal catalog keys.

3. Updated `scripts/avatar-system-schema.sql`.
   - Seed rows now use internal keys like `<class>_<short_id>`.
   - Seed display names omit class names.
   - Added cleanup to disable old long-key seed rows.

4. Added `scripts/avatar-dev-owner-grants.sql`.
   - Grants all active avatars to dev accounts:
     - `980773258238492762`
     - `1508745825315196979`
   - Uses `JOIN users` so it only inserts ownership for already-registered users and does not violate the foreign key.

5. Updated `.gitignore`.
   - Added `!scripts/avatar-dev-owner-grants.sql` so the grant script is tracked despite the broad `*.sql` ignore rule.

## Default Stats Avatar Fix

Timestamp: 2026-07-07 21:25:17 +08:00

Fixed the default stats renderer only. The shared skin layout renderer was restored to its committed behavior so founder/supporter skin layouts are not affected by this follow-up.

Actions completed:

1. Updated `src/commands/rpg/stats.js`.
   - Bumped `STATS_RENDER_REV` from `3` to `4` so cached stats cards with the old Discord-avatar render are invalidated.

2. Updated `src/engine/renderStats.js`.
   - Default stats renderer now tries avatar asset candidates with `.png`, `.webp`, `.jpg`, and `.jpeg` extensions.
   - If a game avatar path exists but the asset cannot be loaded, it no longer falls back to the Discord avatar.
   - Avatar top is aligned with the default renderer's Character Class row.
   - Default renderer text now measures against the avatar's left edge.
   - Long class, combat EXP, equipment, deity, blessing, and stat text is shrunk or truncated before colliding with the avatar.

Validation:

1. Ran `node --check` on:
   - `src/commands/rpg/stats.js`
   - `src/engine/renderStats.js`
   - `src/engine/statsLayoutRenderer.js`
2. Rendered a local default stats smoke image with long text and a game avatar path.
3. Ran `node scripts/help-selftest.js`.
4. Ran `npm.cmd run selftest:full`.
5. Ran `git diff --check`; only CRLF warnings were reported.

## Avatar Asset Path and Combat Cooldown Fix

Timestamp: 2026-07-07 21:30:28 +08:00

Fixed the blank default stats avatar caused by the uploaded R2 avatar filenames not matching the seeded catalog path convention.

Actions completed:

1. Updated `src/engine/avatarSystem.js`.
   - Runtime avatar catalog seeding now uses `skins/avatars/<gender>/<class>/<class>_<style>.png`.
   - This matches the uploaded R2 folder structure such as `skins/avatars/female/mage/mage_webtoon.png` and `skins/avatars/male/archer/archer_cyber.png`.

2. Updated `src/engine/renderStats.js`.
   - Default stats avatar loading now tries the direct catalog path first.
   - It also maps older catalog paths like `skins/avatars/female/mage/webtoon.png` to `skins/avatars/female/mage/mage_webtoon.png`.
   - It accepts both `skins/avatars/...` and `avatars/...` prefixes for compatibility.
   - It includes an archer typo fallback for uploaded files named like `acher_cyber.png`.
   - Extension fallbacks remain available for `.webp`, `.png`, `.jpg`, and `.jpeg`.
   - Founder/supporter skin layout files were not changed.

3. Updated `src/commands/rpg/stats.js`.
   - Bumped `STATS_RENDER_REV` from `4` to `6` so cached blank-avatar and pre-alignment stats renders are invalidated.
   - Added stats-specific optimized image options for the canvas cache upload and attachment fallback path.

4. Updated `scripts/avatar-system-schema.sql`.
   - Seeded `avatar_catalog.asset_path` values now use the uploaded R2 filename convention.
   - Updated schema comments to show the new path pattern.

5. Updated `src/config/cooldowns.js`.
   - `crd raid` / `crd r` cooldown is now 30 seconds.
   - `crd ranked` / `crd rk` cooldown is now 30 seconds.
   - Casino and default command cooldowns remain 10 seconds.

Validation:

1. Ran `node --check` on:
   - `src/engine/avatarSystem.js`
   - `src/engine/renderStats.js`
   - `src/commands/rpg/stats.js`
   - `src/config/cooldowns.js`
2. Ran `npm.cmd run selftest:full`.
   - Battle selftest: 137 passed, 0 failed.
   - Help selftest: 160 passed, 0 failed.
   - Casino selftest: 171 passed, 0 failed.
3. Ran `git diff --check`; only CRLF normalization warnings were reported.

## Fable 5 Change Audit - July 9

Timestamp: 2026-07-09 02:34:18 +08:00

Implemented by: Fable 5, per project owner.

Audited commits:

1. Commit `3f78bae` - `Fix stats skin layout and info embeds`.
   - Corrected stats skin layout selection and avatar behavior.
   - Improved profile/stats command rendering inputs.
   - Improved deity and equipment information embeds.
   - Updated runtime logging for the affected render path.

2. Commit `7ddf01d` - `Restore stats panel text alignment`.
   - Restored the stats panel text positions after the layout update.
   - Added layout-aware alignment for identity, equipment, deity, statistics, record, and quote fields.

## Fable 5 Change Audit - July 11

Timestamp: 2026-07-11 03:41:04 +08:00

Implemented by: Fable 5. Commit metadata includes `Co-Authored-By: Claude Fable 5`.

Audited commit:

1. Commit `f6f1b1c` - `Ascension patch (SP3-5) + founder/skin/badge render fixes`.
   - Added the Sigil and deity Ascension system, transaction-safe unlock and ascend actions, and updated deity stat assembly.
   - Added the paginated RPG glossary for deities, weapons, armor, and runes.
   - Added asset recompression tooling.
   - Added Founder set grants and class-matched Founder avatar handling.
   - Added class battle-skin layout fallback behavior.
   - Added initial supporter badge rendering and render-cache revisions.
   - Added stats header clamping and related regression tests.

Additional Fable 5 work included in the next consolidated commit:

1. Added four Sigil emoji mappings to `assets/data/game_items.txt`.

## Founder, Badge, Balance, and Memory Follow-up

Timestamp: 2026-07-11 18:57:07 +08:00

Implemented by: Codex.

Root-cause findings:

1. Founder collection visibility was checked against the configured testing database and the actual collection page builder for Discord ID `1475898881467355221`.
   - The account is an active Eternal Founder with Founder number 1.
   - All four active Founder catalog cosmetics have explicit `user_cosmetics` rows.
   - All four are equipped and render on collection pages 1 through 4: Profile, Battle, Battle Result, and Summon.
   - The database-wide Founder coverage query reported zero founders missing cosmetic grants.
   - The supplied collection screenshot shows page 1 of 4, so it does not demonstrate missing ownership on pages 2 through 4.

2. The missing Profile badge was reproduced from the supplied screenshot state.
   - The badge asset exists at `skins/supporters/badge/founder.png`; the older path without the `badge` directory does not exist in the testing bucket.
   - Profile rendering required an equipped title position before drawing the badge. Accounts with no equipped title therefore suppressed a valid badge.
   - Stats uses a separate renderer and badge branch; it was audited and retained its independent no-title fallback.

Actions completed:

1. Updated Founder entitlement synchronization.
   - Founder cosmetics and avatars are inserted as explicit, idempotent ownership rows for activation, manual confirmation, and repair flows.
   - Existing equipment choices are preserved; the repair does not force-equip cosmetics or avatars.
   - Eternal Founder token stipend remains idempotent.

2. Updated Profile and Stats identity rendering.
   - Profile now draws a supporter badge even when no title is equipped and anchors it to the Profile combat-EXP column.
   - Stats retains its distinct identity layout and no-title fallback.
   - Supporter badges use a shared aspect-ratio-preserving geometry helper.
   - Stats avatars use contain-fit geometry so non-square art is not distorted.
   - Render revisions were bumped to invalidate stale cached cards.

3. Added deity passive database update SQL.
   - `scripts/deity-passive-description-update.sql` updates Bathala, Odin, and Zeus blessing names/descriptions by stable `blessing_key`.
   - This updates the fields consumed by both `crd glossary` and `crd deity info`.
   - The SQL was prepared for manual execution and was not run by Codex.

4. Updated requested combat and reward behavior.
   - Swordsman Bleed ramps by 3% per stack up to 10 stacks.
   - Knight takes 20% less incoming damage and deals 30% more outgoing damage.
   - Fighter Bash and Dizzy behavior was added.
   - Bathala, Odin, and Zeus blessings were updated to their requested behavior.
   - Regular raid Silver Chest chance is 10%; Elite raid Gold Chest chance is 20%.

5. Updated RPG information formatting.
   - Deity and equipment info cards use consistent enhancement display, ownership, stats, lore, and help formatting.
   - Added reusable enhancement formatting and Sigil emoji usage.

6. Added memory controls and diagnostics.
   - Added bounded image caches, render work queues, memory logging, and configurable cache defaults.
   - Added memory, requested-patch, Founder entitlement, supporter badge asset, and visual preview diagnostics.

Validation:

1. Founder diagnostic returned all four owned and equipped Founder collection categories and five Founder avatars.
2. Supporter badge diagnostic confirmed the live Founder badge asset and rejected the stale blueprint path.
3. Rendered and visually inspected separate no-title Founder Profile and Stats previews using the real Founder badge.
4. `scripts/requested-patch-selftest.js` includes no-title badge geometry and entitlement regression coverage.
5. Ran `npm.cmd run selftest:full`.
   - Battle selftest: 185 passed, 0 failed.
   - Requested patch selftest: passed.
   - Help selftest: 160 passed, 0 failed.
   - Casino selftest: 171 passed, 0 failed.
6. Ran `npm.cmd run selftest:memory`.
   - Baseline RSS: 68 MB.
   - Peak queued-concurrent RSS: 450 MB.
   - RSS after the idle interval: 203 MB.
   - Warm growth check: -10 MB.
   - Result: passed.
7. Ran `git diff --check`; only expected LF-to-CRLF working-tree warnings were reported.
8. Attempted a local render smoke test with a temporary `assets/avatars/...` file during path investigation.
   - The sandbox blocked creating that temporary directory with `EPERM`, so no tracked asset files were added.

## Stats Avatar Alignment and Compression Follow-up

Timestamp: 2026-07-07 21:36:47 +08:00

Completed the follow-up correction from the latest screenshot.

Actions completed:

1. Updated `src/engine/renderStats.js`.
   - The default stats avatar frame now starts at the top of the Character Class text row instead of aligning to the text baseline.
   - Avatar path candidates now match `skins/avatars/<gender>/<class>/<class>_<style>.png`.
   - Kept compatibility for old rows using `skins/avatars/<gender>/<class>/<style>.png`.
   - Kept extension fallback for `.webp`, `.png`, `.jpg`, and `.jpeg`.
   - Added an archer-specific fallback for uploaded filenames that appear as `acher_<style>.png`.

2. Updated `src/commands/rpg/stats.js`.
   - `STATS_RENDER_REV` is now `6` to invalidate cached cards from the blank-avatar and previous-alignment renders.
   - Stats canvas cache and attachment fallback now both pass the same optimized image settings:
     - opaque output
     - WebP allowed
     - JPEG fallback quality 80
     - minimum savings threshold 2%
   - Deployment env still controls the aggressive encoder mode through `IMAGE_OUTPUT_FORMAT=webp`, `IMAGE_WEBP_QUALITY=65`, and `IMAGE_COMPRESSION_AGGRESSIVE=true`.

3. Updated `src/engine/avatarSystem.js` and `scripts/avatar-system-schema.sql`.
   - Seed paths now match the R2 breadcrumb: `skins/avatars/<gender>/<class>/<class>_<style>.png`.

4. Updated `src/config/cooldowns.js`.
   - `raid` and `ranked` remain set to 30 seconds.

## Skin and Avatar Ownership Audit Add-on

Timestamp: 2026-07-08 16:35:03 +08:00

Completed the add-on review and default-only collection correction for skin/avatar ownership behavior.

Actions completed:

1. Updated `src/engine/supporterEntitlements.js`.
   - Added non-production gating for developer unlock-all skin behavior.
   - Added a collection-specific ownership resolver so `crd skin collection` uses explicit `user_cosmetics` ownership rows, plus non-prod developer unlocks, instead of treating every dynamic entitlement as visible collection ownership.

2. Updated `src/engine/avatarSystem.js`.
   - Tightened avatar developer unlock-all gating so Railway production cannot enable unlock-all behavior just because `NODE_ENV` is unset.

3. Updated `src/engine/skinShopViews.js`.
   - `crd skin collection` now displays the synthetic Default row plus owned skins from `user_cosmetics`.
   - Unowned non-default skins are no longer shown in collection mode.
   - Shop mode remains unchanged and still shows purchasable skins with ownership markers.

4. Updated `src/commands/rpg/skin.js`.
   - Corrected the command comment to describe default-plus-owned collection behavior.

5. SQL backfill prepared for manual review only.
   - Backfills missing `user_cosmetics` rows from `equipped_skins`.
   - Does not insert avatars into `user_cosmetics`.
   - Does not touch `user_avatars`.
   - Does not delete or modify `equipped_skins`.
   - Uses `source = 'grant'` because the actual production schema constrains `user_cosmetics.source` to `base`, `shop`, `founder`, or `grant`; longer values such as `legacy_equipped_backfill` would violate the current check constraint.

6. Current untracked changes at the time of this handoff entry:
   - None reported by `git status --short` before edits started.
   - After this add-on, modified files are expected to be `Handoff.md`, `src/commands/rpg/skin.js`, `src/engine/avatarSystem.js`, `src/engine/skinShopViews.js`, and `src/engine/supporterEntitlements.js`.

## Unrecorded Change Audit and Final Ownership Commit

Timestamp: 2026-07-08 16:39:25 +08:00

Reviewed recent commits and the current working tree after the user reported unrecorded work from the prior night. This entry records the previously missing production optimization/boss lifecycle batch and the current ownership add-on before committing all changes.

Previously committed but not fully recorded:

1. Commit `b1b7ae1` - `Optimize embeds, raid images, and boss lifecycle`.
   - Updated equipment/deity info to use native embed thumbnails instead of normal info canvas/card attachments.
   - Added cleaner equipment/deity stats grouping with defensive stats first, then offensive stats.
   - Added shared avatar image loading and candidate fallback support for stats/profile portrait slots.
   - Added class fallback avatar behavior for `crd stats` and `crd profile`.
   - Preserved the previous battle canvas image when final battle frame rendering is skipped.
   - Added raid-specific WebP quality controls for battle frame and battle result images.
   - Set raid image max-width default to disabled (`RAID_IMAGE_MAX_WIDTH=0`) so raid canvases keep original dimensions.
   - Added profile/stats/boss image quality env controls.
   - Routed local boss banner fallback through optimized attachment handling.
   - Updated auto raid progress/done wording to avoid stale Discord relative timestamps.
   - Changed boss lifecycle so active bosses remain until defeated.
   - Limited normal boss spawning and `crd boss` behavior to the official support server.
   - Added non-official guild boss redirect messaging.
   - Added boss stat multiplier and daily attack limit env controls.
   - Disabled `setannouncementchannel` and `setbosschannel` behavior while keeping command names/help entries visible.
   - Added `src/config/officialSupport.js`.
   - Added `src/engine/avatarImageLoader.js`.

2. Files included in commit `b1b7ae1`.
   - `.env.example`
   - `src/commands/admin.js`
   - `src/commands/help.js`
   - `src/commands/rpg/autoRaid.js`
   - `src/commands/rpg/boss.js`
   - `src/commands/rpg/deity.js`
   - `src/commands/rpg/dev.js`
   - `src/commands/rpg/equipment.js`
   - `src/commands/rpg/profile.js`
   - `src/commands/rpg/stats.js`
   - `src/commands/slashDefinitions.js`
   - `src/config/officialSupport.js`
   - `src/engine/avatarImageLoader.js`
   - `src/engine/avatarSystem.js`
   - `src/engine/battleRender.js`
   - `src/engine/bossSystem.js`
   - `src/engine/profileLayoutRenderer.js`
   - `src/engine/renderProfile.js`
   - `src/engine/renderStats.js`
   - `src/engine/statsLayoutRenderer.js`
   - `src/schedulers/bossScheduler.js`
   - `src/utils/imageOutput.js`
   - `src/utils/runtimeLogs.js`

Current uncommitted add-on changes to be committed next:

1. `src/engine/supporterEntitlements.js`
   - Added production-safe skin developer unlock gating.
   - Added `collectionOwnedIdsResolved()` so collection display uses explicit `user_cosmetics` ownership rows, with non-prod developer unlocks only.

2. `src/engine/avatarSystem.js`
   - Tightened avatar developer unlock gating so Railway production cannot unlock all avatars when `NODE_ENV` is unset.

3. `src/engine/skinShopViews.js`
   - `crd skin collection` now displays Default plus owned skins only.
   - Unowned non-default skins no longer appear in collection mode.

4. `src/commands/rpg/skin.js`
   - Updated the command comment to match default-plus-owned collection behavior.

5. `Handoff.md`
   - Added the ownership add-on entry and this unrecorded-change audit entry.

Manual SQL prepared but not run:

```sql
BEGIN;

INSERT INTO user_cosmetics (discord_id, cosmetic_id, source, acquired_at)
SELECT DISTINCT
       es.discord_id,
       es.cosmetic_id,
       'grant' AS source,
       COALESCE(es.updated_at, NOW()) AS acquired_at
  FROM equipped_skins es
  JOIN cosmetic_catalog cc
    ON cc.cosmetic_id = es.cosmetic_id
 WHERE es.cosmetic_id IS NOT NULL
   AND cc.category = es.category
ON CONFLICT (discord_id, cosmetic_id) DO NOTHING;

COMMIT;
```

SQL notes:

1. `equipped_skins.discord_id` maps to `user_cosmetics.discord_id`.
2. `equipped_skins.cosmetic_id` maps to `user_cosmetics.cosmetic_id`.
3. `source` is set to `grant` because the current production schema only allows `base`, `shop`, `founder`, or `grant`.
4. `equipped_skins.updated_at` maps to `user_cosmetics.acquired_at`, with `NOW()` fallback.
5. The script does not insert avatars into `user_cosmetics`.
6. The script does not touch `user_avatars`.
7. The script does not delete or modify `equipped_skins`.
8. `ON CONFLICT (discord_id, cosmetic_id) DO NOTHING` prevents duplicate ownership rows.

Validation before final commit:

1. Ran `node --check` on:
   - `src/engine/supporterEntitlements.js`
   - `src/engine/skinShopViews.js`
   - `src/commands/rpg/skin.js`
   - `src/engine/avatarSystem.js`
2. Ran `npm.cmd run selftest:full`.
   - Battle selftest: 137 passed, 0 failed.
   - Help selftest: 160 passed, 0 failed.
   - Casino selftest: 171 passed, 0 failed.
3. Ran `git diff --check`; only CRLF normalization warnings were reported.

## Codex Update Ã¢â‚¬â€ Layout, Memory, Compression, and Boss HP Canvas

Timestamp: 2026-07-11 23:13:54 +08:00 (Asia/Taipei)

Updated using: OpenAI Codex.

This entry appends the latest Codex work without replacing or superseding the earlier Claude/Fable and Codex handoff history.

### Commits

1. `8c60bf8` Ã¢â‚¬â€ `Optimize image memory and card layouts`
2. `4d13a78` Ã¢â‚¬â€ `Refresh boss HP canvas after attacks`

### Default Profile and Stats Layout Updates

Default `crd profile` only:

1. Removed the Character Class and Combat Level line.
2. Removed Combat EXP text and its progress bar.
3. Kept the user name at its existing position.
4. Positioned the equipped title 30px below the name.
5. Positioned the active supporter badge relative to the avatar without resizing it.
6. Did not modify supporter-specific or layout-driven profile templates.

Default `crd stats` only:

1. Restored the previous compact 118px header layout.
2. Removed unintended reserved vertical space.
3. Kept the user name at its previous position.
4. Positioned the equipped title 30px below the name.
5. Positioned the active supporter badge relative to the avatar without resizing it or reserving layout space.
6. Kept character, equipment, deity, statistics, and combat-record sections in their compact positions.
7. Did not modify supporter-specific or layout-driven stats templates.

### Image Compression and Memory Updates

1. Generated opaque image attachments now default to WebP unless JPEG is explicitly requested.
2. Sharp WebP encoding uses effort 5 normally and effort 6 in aggressive mode.
3. Existing transparency-preserving output paths remain intact.
4. Image rendering remains serialized by default with `IMAGE_RENDER_CONCURRENCY=1`.
5. Added a bounded render queue through `IMAGE_RENDER_QUEUE_MAX`, default 32.
6. Queue overflow fails with `IMAGE_RENDER_QUEUE_FULL` instead of growing without limit.
7. Added a default decoded asset-cache TTL of 30 minutes.
8. Added a maximum of 1,000 remote asset availability records.
9. Cooldown and activity-write Maps are periodically swept and capped at 10,000 entries.
10. Resource diagnostics default to a 10-minute interval.
11. Added RSS warnings at 450MB and 600MB.
12. Diagnostics include heap, external memory, ArrayBuffers, native gap, CPU, PostgreSQL pool state, major cache sizes, and image queue state.
13. No forced garbage collection or `--expose-gc` requirement was added.

### Railway Production Environment Guidance

Lower image quality values mean stronger compression. The deployed Railway values may intentionally remain lower than `.env.example`.

```env
IMAGE_OUTPUT_FORMAT=webp
IMAGE_COMPRESSION_AGGRESSIVE=true
IMAGE_FAST_OPAQUE_ENCODE=true

IMAGE_WEBP_QUALITY=60
PROFILE_IMAGE_WEBP_QUALITY=50
STATS_IMAGE_WEBP_QUALITY=50
BOSS_IMAGE_WEBP_QUALITY=50
RAID_BATTLE_FRAME_WEBP_QUALITY=42
RAID_BATTLE_RESULT_WEBP_QUALITY=42

IMAGE_RENDER_CONCURRENCY=1
IMAGE_RENDER_QUEUE_MAX=32

ASSET_DISK_CACHE_ENABLED=true
ASSET_MEMORY_CACHE_MAX_MB=32
ASSET_CACHE_TTL_MS=1800000
ASSET_REMOTE_CHECK_MAX=1000
CANVAS_MEMORY_CACHE_MAX_MB=8

BATTLE_STATIC_LAYER_CACHE_MAX=20
BATTLE_STATIC_LAYER_CACHE_TTL_MS=300000
BATTLE_RENDER_CACHE_MAX_MB=24

PROFILE_IMAGE_CACHE_TTL_MS=60000
PROFILE_IMAGE_CACHE_MAX=25

RESOURCE_LOGS=true
RESOURCE_LOG_INTERVAL_MS=600000

BOSS_IMAGE_REFRESH_ENABLED=true
```

Important:

1. Keep `IMAGE_RENDER_CONCURRENCY=1` to limit simultaneous native Canvas allocations.
2. Keep `CANVAS_MEMORY_CACHE_MAX_MB=8` for the current low-user Railway deployment.
3. Add `IMAGE_RENDER_QUEUE_MAX=32`, `ASSET_CACHE_TTL_MS=1800000`, and `ASSET_REMOTE_CHECK_MAX=1000` if absent.
4. Keep `BOSS_IMAGE_REFRESH_ENABLED=true` so the boss HP canvas regenerates after attacks.

### Memory Validation

The expanded memory test rendered 100 sequential profile/stats images and then 16 queued concurrent images.

1. Baseline RSS: 65MB.
2. Cold render RSS: 143MB.
3. RSS after 100 sequential images: 354MB.
4. Concurrent batch RSS: 346MB.
5. RSS after idle cleanup: 293MB.
6. Warm-to-idle growth: -61MB.
7. JavaScript heap remained around 8Ã¢â‚¬â€œ9MB.
8. Asset cache stabilized at 10 entries and approximately 44MB under the test configuration.

The measurements indicate that most temporary growth came from native image allocations, external Buffers, and ArrayBuffers rather than an expanding JavaScript heap. RSS fell after rendering stopped.

Representative quality-68 WebP measurements:

1. Profile: 3,525,971-byte PNG to 329,014-byte WebP, a 90.7% reduction.
2. Stats: 3,525,807-byte PNG to 330,084-byte WebP, a 90.6% reduction.

### Boss HP Canvas Fix

1. Fixed the successful boss-attack refresh path.
2. The bot now fetches the committed boss state and immediately regenerates the full live boss status canvas.
3. Canvas HP text and the HP bar now display updated HP after an attack.
4. The text-only path remains only when `BOSS_IMAGE_REFRESH_ENABLED=false`.
5. Boss damage, combat simulation, attack limits, rewards, and database behavior were not changed.

### Validation

1. JavaScript syntax checks passed.
2. `git diff --check` passed apart from expected Windows line-ending warnings.
3. Requested patch self-test passed.
4. Memory stress test passed.
5. Battle self-test: 186 passed, 0 failed.
6. Schema drift self-test passed.
7. Help self-test: 181 passed, 0 failed.
8. Casino self-test: 171 passed, 0 failed.

Use `npm.cmd` on Windows because PowerShell may block `npm.ps1`:

```powershell
npm.cmd run selftest:full
npm.cmd run selftest:memory
```

### Agent Attribution Note

This appended section was written by OpenAI Codex. Earlier entries must remain intact because the repository is also maintained using Claude/Fable. Future agents should append their work with a timestamp and agent attribution rather than deleting prior history.
