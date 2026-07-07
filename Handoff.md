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
