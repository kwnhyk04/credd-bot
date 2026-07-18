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
   - Grants all active avatars to the two configured development accounts.
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

1. Founder collection visibility was checked against the configured testing database and the actual collection page builder for the configured Founder test account.
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

---

### Boss Stat Rescale + Sudden-Death Player-Only Drain

**Agent:** Claude Code (Opus 4.8)
**Timestamp:** 2026-07-14 04:43:52 TST
**Commit:** 5f6cd96

1. Boss stat multipliers lowered: HP 10x to 5x, ATK/DEF 2x to 1.5x.
2. Defaults changed in `bossStatMultiplier()` and `bossAttackDefenseMultiplier()` (`src/engine/bossSystem.js`) and in `.env.example` (`BOSS_STAT_MULTIPLIER`, `BOSS_ATK_DEF_MULTIPLIER`).
3. Applied at the single spawn path via `scaledBossStats`; normal and elite mob scaling untouched. Greater-boss chest HP multiplier (`hpMultiplierForChest`) left unchanged.
4. Already-spawned bosses keep their persisted `max_hp`/`scaled_atk`/`scaled_def`; only new spawns use the new multipliers.
5. Round-30 sudden-death HP drain (`src/engine/battleEngine.js`) now hits only player (user) sides. Mobs and bosses are exempt, so in PvE the user bleeds out while the enemy does not; PvP duels still drain both user sides.

**Validation:** Battle self-test 186 passed / 0 failed; requested patch self-test passed.

**Note:** Only the three files above were committed. The unrelated pre-existing working-tree modifications from prior sessions were left unstaged and untouched.

---

### Complete Production Memory Audit and Retention Fixes

**Agent:** OpenAI Codex (5.6 Sol ultra)
**Timestamp:** 2026-07-14 04:49:00 TST
**Commit:** This entry is included in the memory-audit commit created immediately afterward.

Audits performed and changes completed:

1. Audited every application-owned module-scope Map, Set, Array, cache, queue, Buffer holder, Canvas holder, Image holder, timer, collector, and listener.
   - Classified request-local containers as collectible after the request lifecycle.
   - Classified fixed registries, schema snapshots, lore, mythology lists, font registrations, and guild-scoped records as finite or lifecycle-owned.
   - Added lightweight counters for 32 cache and runtime sources without exposing or retaining their contents.

2. Found the primary production memory leak in `src/casino/casinoCanvas.js`.
   - The old card source image cache retained about 436.2 MB of decoded images.
   - The old 52-card face cache retained about 311.8 MB of 1024x1536 canvases.
   - Removed the duplicate source image cache and routed card assets through the shared asset cache.
   - Reduced composited card faces to 140x196 and bounded them to eight entries, 4 MB, and a 10-minute TTL.
   - The full-deck test now retains about 1 MB of face canvases.

3. Audited all battle, raid, result, profile, stats, equipment, weapon, portrait, deity, summon, quest, bag, boss, and casino renderers.
   - Removed duplicate renderer-local Image caches from portrait, weapon, quest, bag-local, summon-frame, battle-skin, result-skin, and battle-emoji paths.
   - Kept layout caches metadata-only where possible.
   - Bounded battle and result static canvases to a combined 16 MB and eight entries per cache with a 10-minute TTL.
   - Released evicted battle/result base canvases immediately.

4. Added deterministic Canvas disposal after image encoding.
   - Added `releaseCanvas()` in `src/utils/canvasEncode.js`.
   - Request canvases are resized to 1x1 in `finally` immediately after PNG or JPEG encoding so native surfaces do not wait for V8 heap pressure.
   - Applied this lifecycle to production render paths without changing their output or gameplay behavior.

5. Audited R2 asset downloads and image decoding.
   - Added shared in-flight deduplication for buffer and image loads with `finally` cleanup.
   - Kept the decoded asset and source buffer caches under one 256-entry, 40 MB, 30-minute ceiling.
   - Removed the compressed R2 Buffer after decoding when the disk cache can reload it, avoiding duplicate encoded and decoded copies.
   - Kept remote availability checks capped at 1,000 entries with negative-result expiry.
   - Values below the measured 40 MB decoded working-set floor now fall back to 40 MB to prevent eviction and decode churn.

6. Audited generated PNG, JPEG, WebP, GIF, raw-frame, and composite buffers.
   - Output buffers remain request-local until the Discord send/edit or R2 upload resolves.
   - Canvas and profile caches retain R2 URLs rather than generated buffers.
   - The only intentional generated-buffer caches are bounded casino processed media and boss banners.
   - Added a WeakRef memory test that confirmed zero generated profile/stats output buffers remained reachable after forced garbage collection.

7. Bounded native and image-processing work.
   - Configured Sharp for an 8 MB memory cache, zero file cache, 20 cached items, and concurrency one.
   - Reduced the image queue maximum from 32 to 16 and retained one active renderer by default.
   - Added queue and active-job age instrumentation with guaranteed `finally` cleanup.

8. Audited casino media, boss, Discord, and secondary caches.
   - Casino processed GIF/PNG buffers now share a 12-entry, 24 MB, 10-minute cache; R2 production prewarming is skipped.
   - Boss banners now use four entries, 8 MB, and a 10-minute TTL.
   - Boss logs now retain only compact names, winner, seed, and capped event text rather than full snapshots.
   - Emoji Images are bounded to 256 entries, 4 MB, and a 30-minute TTL.
   - Profile/stats layout metadata is capped at 64 entries and mob roster data at 32 entries.
   - Discord messages are limited to five per channel and swept after five minutes; unused managers are disabled and members, users, and emojis are bounded.

9. Audited sessions, timers, schedulers, collectors, listeners, and queues.
   - Blackjack and crash sessions now clear Maps and timers on reply, render, timeout, settlement, and error exits.
   - Boss refreshes coalesce to one active job and one rerun per guild instead of overlapping.
   - Battle collectors retain prebuilt log pages instead of full simulations and expire after five minutes.
   - Bestow and duel collectors retain their fixed 60-second lifetimes and expose active counts.
   - Battle, boss, reset, and season schedulers now return stop callbacks that run during graceful shutdown.
   - Guild-owned configuration and boss runtime state are cleared on `guildDelete`.

10. Added 10-minute production memory instrumentation in `src/utils/resourceMonitor.js`.
    - Logs `heapUsed`, `heapTotal`, `rss`, `external`, and `arrayBuffers` together.
    - Also logs native gap, RSS delta and peak, CPU, PostgreSQL pool counts, Discord cache/listener counts, active Node resource types, image queue state, and every registered cache size and limit.
    - Keeps warning thresholds at 450 MB and 600 MB.

11. Added and expanded validation.
    - `npm.cmd run selftest:memory` passed at 310 MB idle RSS and 300 MB after forced GC, with zero generated output buffers reachable.
    - `npm.cmd run selftest:memory:casino` passed at 328 MB final RSS, eight card faces, about 1 MB of face canvases, and 36 MB of shared assets.
    - `npm.cmd run selftest:full` passed: 186 battle checks, requested patch and schema checks, 181 help/command checks, and 171 casino checks.
    - JavaScript syntax checks and `git diff --check` passed.

12. Added `docs/production-memory-audit.md` with the complete inventory, measured consumers, renderer and R2 lifecycle review, instrumentation reference, validation results, and Railway recommendations.

`.env.example` memory changes in this audit:

1. Changed `IMAGE_RENDER_QUEUE_MAX` from `32` to `16`.
2. Added `SHARP_CACHE_MEMORY_MB=8`.
3. Added `SHARP_CACHE_FILES=0`.
4. Added `SHARP_CACHE_ITEMS=20`.
5. Added `SHARP_CONCURRENCY=1`.
6. Changed `BATTLE_STATIC_LAYER_CACHE_MAX` from `30` to `8`.
7. Changed `BATTLE_RENDER_CACHE_MAX_MB` from `48` to `16`.
8. Changed `ASSET_MEMORY_CACHE_MAX_MB` from `48` to `40`.
9. Added `LAYOUT_METADATA_CACHE_MAX=64`.
10. Added `MOB_ROSTER_CACHE_MAX=32`.
11. Added `EMOJI_IMAGE_CACHE_MAX=256`.
12. Added `EMOJI_IMAGE_CACHE_MAX_MB=4`.
13. Added `EMOJI_IMAGE_CACHE_TTL_MS=1800000`.
14. Added `BOSS_BANNER_CACHE_MAX=4`.
15. Added `BOSS_BANNER_CACHE_MAX_MB=8`.
16. Added `BOSS_BANNER_CACHE_TTL_MS=600000`.
17. Added `CASINO_CARD_FACE_CACHE_MAX=8`.
18. Added `CASINO_CARD_FACE_CACHE_MAX_MB=4`.
19. Added `CASINO_CARD_FACE_CACHE_TTL_MS=600000`.
20. Added `CASINO_MEDIA_CACHE_MAX=12`.
21. Added `CASINO_MEDIA_CACHE_MAX_MB=24`.
22. Added `CASINO_MEDIA_CACHE_TTL_MS=600000`.

Production note:

1. Keep `RESOURCE_LOGS=true` and set `RESOURCE_LOG_INTERVAL_MS=600000` for the requested 10-minute snapshots.
2. Keep `ASSET_DISK_CACHE_ENABLED=true` and do not lower `ASSET_MEMORY_CACHE_MAX_MB` below 40; a 24 MB stress run caused continuous native re-decoding and temporary RSS around 1.1 to 1.25 GB.
3. Restart the production process after deployment so native allocations retained by the old process are fully released.
4. No combat, rewards, odds, command behavior, database schema, or other gameplay logic was changed by this memory-audit batch.

---

### Production Baseline and Repeated-Egress Follow-up Audit

**Agent:** OpenAI Codex (5.6 Sol ultra)
**Timestamp:** 2026-07-14 17:10:24 TST
**Commit:** This entry documents the focused telemetry and cache-key commit created immediately afterward.

Measured findings:

1. The eager Discord, command, and render dependency graph uses about 100 MB RSS, 21 MB JavaScript heap, and 803 loaded modules before gateway state. No R2 Buffer, decoded Image, generated Canvas, or generated attachment cache is populated by module loading.
2. The dominant remaining post-render memory is native Canvas/Skia allocator high-water. Profile/stats stress settled at 293 MB before the disk-path decode fix, while the casino full-deck test settled at about 319 MB despite only about 37 MB of reported live image caches.
3. A first-seen supporter-skinned raid uploaded 402,346 bytes to R2 across its start frame, final frame, and result image. A profile state miss measured 294,738 bytes and a stats state miss measured 293,112 bytes.
4. The battle start-frame cache key included randomized final fighter HP and other non-rendered simulation state. Identical start-frame pixels therefore received different cache keys and were uploaded repeatedly.
5. `BATTLE_FRAME_RENDER_MODE=start_and_final` renders only snapshot zero and the final snapshot. No intermediate battle frames are rendered or uploaded.
6. Generated profile, stats, battle, raid, boss, summon, equipment, and casino outputs remain request-local. Forced garbage collection found zero generated profile/stats output buffers reachable.
7. The idle recurring application traffic is the one-minute battle reaper query, the one-minute official boss query, the optional one-minute casino recovery transaction, Discord gateway heartbeats, daily reset/season jobs, and the six-hour canvas sweep. There is no application health-check HTTP server.

Focused changes:

1. Added 10-minute process, V8, cache, Discord, PostgreSQL socket, R2, Discord attachment, and active-work telemetry with bounded counters.
2. Narrowed battle frame/result cache keys to fields that actually affect pixels and separated ranked telemetry from duel rendering behavior.
3. Added canonical same-path R2 URL keys when `ASSET_VERSION` is set, separate cache hit/miss/coalesced counters, download bytes by category, and bounded persistent disk caching.
4. Managed R2 images now decode from the bounded disk-cache path. This prevents `Image.src` from retaining the compressed download Buffer beside decoded pixels. The profile/stats test reduced forced-GC external memory from 166 MB to 69 MB and ArrayBuffers from 145 MB to 58 MB; forced-GC RSS reduced from 293 MB to 284 MB.
5. Increased the PostgreSQL idle fallback from 30 seconds to 120 seconds and added preflight enforcement so the 60-second jobs do not force a fresh TLS/auth connection every minute.
6. Added overlap guards to casino recovery, canvas sweeps, and the battle reaper. Boss attack refresh timing remains immediate and unchanged.
7. Discord REST response clones are cancelled after telemetry reads their headers. Attachment buffers are attributed through a WeakMap, which does not extend their lifetime.
8. Removed unused duel/ranked result-skin database lookups because those modes never render the raid-only result panel.

Production environment changes:

```env
RESOURCE_LOGS=true
RESOURCE_LOG_INTERVAL_MS=600000
PG_IDLE_TIMEOUT_MS=120000
ASSET_VERSION=r2-v1
ASSET_DISK_CACHE_ENABLED=true
ASSET_DISK_CACHE_MAX_FILES=2000
ASSET_DISK_CACHE_MAX_MB=96
ASSET_DISK_CACHE_SWEEP_INTERVAL_MS=3600000
ASSET_MEMORY_CACHE_MAX_MB=40
ASSET_CACHE_TTL_MS=1800000
BATTLE_FRAME_RENDER_MODE=start_and_final
ALLOW_DISCORD_IMAGE_ATTACHMENTS=false
```

Validation:

1. Full application self-test passed: 186 battle checks, requested patch, telemetry, schema drift, 181 help checks, and 171 casino checks.
2. Profile/stats memory test passed at 291 MB idle and 284 MB after forced collection, with zero generated buffers reachable.
3. Casino memory test passed at 319 MB final RSS, eight face canvases, about 1 MB of face pixels, and about 36 MB of shared decoded assets.
4. The production sub-400 MB target is not claimed until at least six new 10-minute production snapshots are collected. If native gap remains dominant, the next measured fix is 52 lossless pre-rendered 140x196 card faces in R2, replacing runtime decoding of roughly 436 MB of full-resolution card components.

---

### R2 Skin Rendering Regression Fix

**Agent:** OpenAI Codex (5.6 Sol ultra)
**Timestamp:** 2026-07-14 19:07:40 TST
**Commit:** This entry documents the skin-rendering fix committed immediately afterward.

Findings and fixes:

1. Production's 8 MB combined battle render-cache budget gives each static battle/result cache 4 MB, while a normal 1536x1024 base canvas occupies about 6 MB. A new base was therefore inserted, immediately evicted and resized to 1x1, and then used by the current render. This produced the text-and-HP-only image shown in Discord.
2. Battle and result renderers now bypass an undersized static-layer cache and draw the base directly into the request-local output canvas. Cache limits and memory cleanup remain intact.
3. Founder/tester folder overrides previously required local `assets/skins` files even when R2 was enabled. Profile, stats, battle, result, and summon candidates now use bounded R2 availability checks.
4. Summon resolution now honors the equipped catalog item, supports `founder_summon.webp`, preserves Discord-emoji rendering for `_sN` store skins, and recognizes versioned R2 image URLs.
5. Avatar candidate parsing now preserves `ASSET_VERSION` while trying extension and historical `acher_*` fallback variants.
6. Dev whole-set validation now accepts an R2-only skin folder.
7. Battle/result render revisions were bumped so previously cached blank outputs are not reused. Battle frame cache identity also distinguishes an unavailable requested skin from the same skin after it loads successfully.

Audited render paths:

1. Battle, raid, boss, duel, and ranked frames all share the corrected battle base path.
2. Raid victory and defeat panels use the corrected result base path; duel and ranked do not render this raid-only panel.
3. Profile and stats share the same decoded custom R2 background cache entry without duplicate downloads.
4. Founder/tester and catalog summon skins, store Discord-emoji summons, equipment rendering, and avatar variants were checked. Equipment uses a separate path and was unaffected.
5. The active production R2 catalog and class battle bases were checked; the expected objects are available. Four stale local store `.gif` names are intentionally superseded by the active `.webp` catalog paths.

Production environment correction:

```env
ASSET_VERSION=2026-07-03
ALLOW_DISCORD_IMAGE_ATTACHMENTS=true
```

No new production environment change is required if these are already the deployed values. Keep `BATTLE_RENDER_CACHE_MAX_MB=8` if desired; oversized bases now safely bypass that cache. The render revision bump causes one first-use regeneration per invalidated image key after deployment, then normal R2 canvas-cache reuse resumes.

Validation:

1. The R2-only regression test covers profile, stats, battle, victory, defeat, founder summon WebP, store summon emoji, and avatar fallback behavior.
2. The production-sized cache reproduction now retains the complete battle/result background at the same 8 MB combined budget.
3. Full application self-tests passed: 186 battle checks, requested-patch, telemetry, R2 skin, schema, 181 help checks, and 171 casino checks.
4. The memory test passed below the 350 MB target with zero reachable generated output buffers after forced collection.

---

### Persistent Asset Cache and Image-Egress Audit

**Agent:** OpenAI Codex (5.6 Sol ultra)
**Timestamp:** 2026-07-14 20:52:28 TST
**Commit:** `78159d4` (`Persist and instrument remote asset caching`)

Measured findings:

1. The bounded memory-cache changes did expose repeated cold downloads, but the managed R2 loader itself was not bypassing disk during one process lifetime. Twelve concurrent aliases produced one R2 GET and eleven coalesced waits; after clearing memory, the next request was a disk hit with no second GET.
2. The default cache directory was `process.cwd()/.cache/assets`. It survives memory eviction but is deployment-ephemeral on Railway unless its path is backed by a mounted Volume.
3. The previous 96 MB disk cap was already effectively full: 82 files used 98,336,843 bytes (93.78 MiB). Result backgrounds used 45.58 MiB, battle backgrounds 33.89 MiB, and profile/stats backgrounds 14.24 MiB. Those three groups consumed 97.7 percent of the cap before class images, avatars, equipment, runes, deity, boss, or summon assets.
4. Disk eviction was FIFO by original write time rather than LRU because disk hits did not update file timestamps. Hourly-only sweeping could also lag behind warm-up writes.
5. Query/version aliases and hostname capitalization converged when `ASSET_VERSION` was present, but equivalent percent-encoded paths could receive different keys. R2 object-path capitalization must remain distinct because object keys are case-sensitive.
6. Three sequential requests for the same missing managed object produced three GETs. Only simultaneous requests were deduplicated.
7. Eight simultaneous Discord emoji requests produced eight downloads because the bag icon loader had no in-flight map. Discord identity avatars were memory-only and downloaded again after decoded-image eviction.
8. Fonts are bundled under `assets/fonts` and are not fetched remotely. Static battle backgrounds, class images, R2 avatars/skins, equipment assets, deity assets, boss assets, and summon assets use the shared loader; no uncontrolled remote `loadImage(url)` bypass was found.
9. `BATTLE_FRAME_RENDER_MODE=start_and_final` renders and delivers only frame zero and the final frame. Raid can still legitimately create three unique outputs on a cold state: start frame, final frame, and result panel.
10. Generated render buffers remain request-local through R2/Discord completion. Canvas-cache entries retain URLs, not PNG/WebP buffers, and generated images are not downloaded back through the source-asset loader.
11. The largest avoidable repeated output was the live boss HP image: every surviving attack was immediately rendering and editing the Discord message even though a 15-second debounce implementation already existed but had no caller.

Focused changes:

1. Added `ASSET_DISK_CACHE_DIR` with `ASSET_DISK_CACHE_ROOT` compatibility, a startup write probe and inventory log, and production preflight checks. The default remains `.cache/assets` when no directory is configured.
2. Raised only the disk-cache default from 96 MiB to 384 MiB. The decoded memory cache remains bounded at 40 MiB and its TTL is unchanged.
3. Converted disk eviction to access-aware LRU by periodically touching hot files and added write-count/limit-triggered sweeps in addition to the hourly sweep.
4. Canonicalized managed R2 keys across hostname case, query aliases, asset versions, and equivalent percent encoding, including when `ASSET_VERSION` is blank. R2 path case remains intentionally case-sensitive. Discord CDN query parameters are sorted rather than removed because they can affect the requested rendition.
5. Added a bounded 1,000-entry, 10-minute negative cache for managed R2 404/410 responses and retained the existing in-flight buffer/image deduplication.
6. Added persistent disk reuse for Discord identity avatars and in-flight coalescing plus disk reuse for Discord emoji/Twemoji icons. Their decoded Images remain under the existing 4 MiB memory limit.
7. Added command attribution for prefix, slash, and component interactions. Ten-minute resource logs now include asset memory/disk/negative hits and misses, downloads by category and command, R2 uploads, Discord attachment bytes by command, V8/process memory, and active collectors/timers/battles/raids/render jobs.
8. Connected surviving boss attacks to the existing 15-second status-image debounce. Damage, rewards, combat state, image dimensions, encoding, and quality are unchanged.
9. Hardened the persistent cache as an owned, dedicated directory. Startup rejects filesystem/project/source/shared directories, sweeps only recognized cache files, uses atomic same-directory writes, serializes concurrent sweep accounting, repairs corrupt icons, and blocks raw or percent-encoded traversal before network/local fallback.
10. A successful R2 HEAD now clears an earlier cached GET 404, so a newly uploaded or corrected skin becomes visible without waiting for the negative TTL or restarting.
11. Production preflight no longer requires R2-only images in a clean GitHub checkout, accepts the runtime boolean spellings and cache-root alias, and rejects unsafe cache paths.
12. Added deterministic cache tests for persistent reuse, URL aliases, traversal, unsafe roots, concurrent 80-file cap enforcement, exact disk accounting, atomic writes, corrupt-file recovery, positive-HEAD recovery, avatar/icon reuse, missing-object suppression, coalescing, and grouped telemetry.

Production environment:

```env
RESOURCE_LOGS=true
RESOURCE_LOG_INTERVAL_MS=600000
ASSET_VERSION=2026-07-03
ASSET_DISK_CACHE_ENABLED=true
ASSET_DISK_CACHE_DIR=/data/credd-asset-cache
ASSET_DISK_CACHE_MAX_FILES=2000
ASSET_DISK_CACHE_MAX_MB=384
ASSET_DISK_CACHE_SWEEP_INTERVAL_MS=3600000
ASSET_DISK_CACHE_TOUCH_INTERVAL_MS=300000
ASSET_DISK_CACHE_SWEEP_WRITE_THRESHOLD=16
ASSET_MEMORY_CACHE_MAX_MB=40
ASSET_CACHE_TTL_MS=1800000
ASSET_REMOTE_CHECK_MAX=1000
ASSET_REMOTE_MISS_TTL_MS=600000
ASSET_REMOTE_MISS_MAX=1000
EMOJI_REMOTE_MISS_TTL_MS=600000
EMOJI_REMOTE_MISS_MAX=256
BATTLE_FRAME_RENDER_MODE=start_and_final
BOSS_IMAGE_REFRESH_ENABLED=true
BOSS_IMAGE_REFRESH_DEBOUNCE_MS=15000
ALLOW_DISCORD_IMAGE_ATTACHMENTS=true
```

Mount a Railway Volume at `/data` before setting `ASSET_DISK_CACHE_DIR=/data/credd-asset-cache`. Without the Volume, the cache still works within one deployment but cold-warms again after each redeploy.

Validation:

1. The focused disk-cache test passed all managed R2, Discord CDN, canonicalization, disk-hit, in-flight, negative-cache, and telemetry assertions.
2. The complete application self-test passed: 188 battle checks, requested-patch, telemetry, asset disk cache, R2 skin, schema, 181 help checks, and 171 casino checks.
3. The final render memory stress test passed at 312 MB peak RSS and 299 MB after forced collection, with zero reachable generated buffers.
4. The final casino memory test passed at 319 MB RSS with about 36 MB of shared decoded assets and the existing bounded face cache.
5. JavaScript syntax checks and `git diff --check` passed.

---

### Railway 800 MB Memory and Recurring-Egress Audit

**Agent:** OpenAI Codex
**Timestamp:** 2026-07-16 TST
**Commit:** Working-tree implementation; no commit was requested.

Measured conclusions:

1. The approximately 800 MB plateau is primarily the process-wide Skia cache/high-water owned by `@napi-rs/canvas`, not a growing V8 object graph. A controlled 100× 1536x1024 Canvas run moved RSS from 67 MB to 396 MB while heap, external, and ArrayBuffers stayed nearly flat; `clearAllCache()` returned RSS to 68 MB.
2. Profile/stats decode and Sharp scratch was the second-largest native working set: the final stress run settles below 300 MB with zero generated output Buffers reachable.
3. Casino amplified native memory by decoding 1024x1536-or-larger source components to draw a 140x196 card. Preprocessing sources to their exact displayed size reduced the all-card test from about 319 MB to 130 MB in the final run.
4. The leading egress path is a cold raid's required opening frame + final frame + result frame. One measured raid sent 402,346 bytes; a 17-skin survey puts the median three-image combination near 502 KB and upper cases near 713 KB. Nearby raids match the observed 0.5–1.7 MB spikes.
5. Profile/stats deterministic-cache misses measured 294,738 and 293,112 bytes. Live boss HP refreshes were the highest-frequency background-like generated-image path.

Implemented changes:

1. Raid, duel, and ranked retain their original Canvas delivery: an opening battle image followed by the final battle image. Raid also retains its separate result image. There are no per-turn Discord edits between those two battle frames. Permission recovery preserves the Canvas payload instead of changing the command to text-only.
2. Every surviving boss attack still schedules the latest-HP Canvas status render. Nearby attacks coalesce into one refresh per `BOSS_IMAGE_REFRESH_DEBOUNCE_MS` window; scheduler recovery can rebuild the same status card. A running progress edit is lifecycle-guarded and terminal defeat waits for it, preventing stale state from overwriting the final card.
3. Existing local boss banners remain visible by retaining their Discord attachment ID and reusing the existing CDN URL. Full-size summon media is tester-only and suspense-only: the final summon edit clears local attachments and omits remote media. Base, founder, store, future catalog, and arbitrary non-tester overrides remain header-emoji-only. No summon media bytes are uploaded a second time; after restart/deletion, boss recovery attaches one local static banner only when no reusable URL exists.
4. Every application Canvas is tracked from allocation through explicit release. Request canvases are resized to 1x1 immediately after encode; evicted cached canvases use the same path. A one-second quiescent debounce clears Skia's process-wide cache without forced V8 garbage collection.
5. Casino backgrounds and glyphs are prepared with high-quality Lanczos downsampling before Canvas decode. The old alpha cutoff and final 140x196 geometry are preserved. Card-face cache eviction is lease-aware, byte/entry/TTL bounded, and explicitly releases native surfaces.
6. Discord upload telemetry now records one safe event per actual attempt: command, sanitized filename, bytes, upload count/index, salted user hash, hashed request correlation, surface, phase, route category, retry/status, and bounded duplicate fingerprint. R2 GET/HEAD/PUT counts and bytes are grouped by command.
7. Five-minute resource records include raw `process.memoryUsage()`, V8 heap/spaces, all cache entries/estimated bytes, disk bytes, active Canvas pixels, Sharp state, renderer queue, battles/collectors/timers, Discord caches, PostgreSQL network counters, R2 traffic, and Discord attachments by command/phase. The interval is clamped between 60 seconds and five minutes.
8. Queue jobs and raw Canvas lifecycles both emit before/after/delta `[renderer-memory]` records, covering direct attachment fallbacks that render before Sharp optimization.
9. R2 fetch/HEAD/PUT/DELETE response bodies are consumed or canceled; in-flight source and deterministic-render promises are removed in `finally`; telemetry stores no raw IDs or image Buffers.
10. The detailed evidence, complete renderer/object lifecycle inventory, exact code references, acceptance criteria, and commands are in `docs/production-memory-audit.md`.

Manual Railway environment changes (`.env.example` remains intentionally Git-ignored):

```env
RESOURCE_LOGS=true
RESOURCE_LOG_INTERVAL_MS=300000

IMAGE_OUTPUT_FORMAT=webp
IMAGE_WEBP_QUALITY=55
PROFILE_IMAGE_WEBP_QUALITY=60
STATS_IMAGE_WEBP_QUALITY=60
BOSS_IMAGE_WEBP_QUALITY=55
RAID_BATTLE_FRAME_WEBP_QUALITY=50
RAID_BATTLE_RESULT_WEBP_QUALITY=50
IMAGE_COMPRESSION_AGGRESSIVE=true

ALLOW_DISCORD_IMAGE_ATTACHMENTS=true
BATTLE_FRAME_RENDER_MODE=start_and_final
BATTLE_FRAME_RENDER_COOLDOWN_MS=30000
BATTLE_RESULT_RENDER_ENABLED=true
BOSS_IMAGE_REFRESH_ENABLED=true
BOSS_IMAGE_REFRESH_DEBOUNCE_MS=15000
```

The lower WebP quality values reduce transfer bytes without changing dimensions, command timing, image count, or Canvas layout. The final block is behavior-preserving and should not be disabled for the production presentation described above.

Validation:

1. General profile/stats stress: 311 MB burst peak and 295 MB steady, zero reachable generated Buffers.
2. Casino full-deck stress: 130 MB final RSS, eight faces/about 1 MB, shared assets about 39 MB.
3. Integrated no-GC stress: 143 MB idle after all 52 card faces plus 20 profile and 20 stats renders, below the 400 MB target.
4. Canvas benchmark: roughly 63–66 MB baseline, 79–82 MB burst, 67–70 MB after quiescence without forced GC.
5. Full application suite passes: 201/201 battle, 181/181 help, 171/171 casino, plus telemetry, asset-cache, R2-skin, Canvas, schema, and requested-patch checks; `git diff --check` is clean.

Production verification:

1. Restart the Railway process so the old process's native high-water is discarded.
2. Review at least six consecutive five-minute `[resource]` snapshots under light use.
3. Accept when RSS remains below 400 MB after quiescence, battle progress has no intermediate attachment bytes, and boss progress produces no more than one status attachment per completed coalesced refresh window.
4. If RSS remains high while Canvas pixels, external, ArrayBuffers, cache bytes, and active work are low, capture a native allocator profile; the residual would be outside the application-owned object graph.

---

### Boss Balancing — Database-Authoritative Stats

**Branch:** `codex/boss-balancing`
**Timestamp:** 2026-07-16 TST

1. Removed `BOSS_STAT_MULTIPLIER` (old HP ×5) and `BOSS_ATK_DEF_MULTIPLIER` (old ATK/DEF ×1.5) from the spawn path.
2. Restored only Greater chest-driven HP at lower values: 2× Boss Treasure Chest gives ×1.5 max HP; 1× Boss Golden Chest gives ×2 max HP. Greater ATK, DEF, and CRIT remain unmultiplied database values.
3. Every spawn first uses `computeBossStats(row, level)` directly: `base_* + *_per_level × boss_level`; only Greater `max_hp` then receives the chest multiplier. Normal bosses remain fully database-authored.
4. Existing active bosses retain the HP/ATK/DEF snapshot already stored in `boss_state`. Database changes take effect on the next spawn.
5. Current effective multipliers relative to the database formula are: normal HP/ATK/DEF/CRIT ×1; Greater HP ×1.5 for Treasure (80%) or ×2 for Golden (20%), with Greater ATK/DEF/CRIT ×1.
6. `.env.example` remains ignored; remove/unset `BOSS_STAT_MULTIPLIER` and `BOSS_ATK_DEF_MULTIPLIER` manually because the branch no longer reads them.
7. The Greater chest is still rolled once per spawn. If Railway restarts, the outcome is reconstructed from persisted `max_hp`, preventing the announcement/payout from changing chest tier.

### Tester-Only Summon Media

1. Full-size summon suspense media is authorized only for `tester_*` catalog cosmetics, the beta tester fallback, or raw overrides rooted under `testers/`.
2. Base, founder, store, future catalog, and non-tester override summons render the usual animated header emoji. Equipping one changes only the emoji key; image filenames cannot authorize a MediaGallery.
3. The final tester result preserves the `✨ Invocation Complete` header while omitting the media, and the Discord edit uses `attachments: []` to remove a local suspense upload.
4. Emoji-only summons no longer depend on the obsolete local `card_flip.gif` disk guard, so the normal four-second header phase also works in assetless production.

---

### Claude Code Completion — Boss Balancing and Tester-Only Summon Media

**Agent:** Claude Code
**Branch:** `codex/boss-balancing`
**Started from:** `f3fc615` (`Audit image memory and network egress`)
**Completed:** 2026-07-16 07:30:20 TST

Commit sequence and exact local commit times:

1. `661db0b` — 2026-07-16 06:57:00 TST — `Remove runtime boss stat multipliers`
2. `7196823` — 2026-07-16 06:57:15 TST — `Remove summon suspense media from results`
3. `1c1fea5` — 2026-07-16 07:10:48 TST — `Restrict summon media to tester skins`
4. `d5af2ca` — 2026-07-16 07:30:20 TST — `Restore Greater boss chest HP scaling`

Completed work:

1. Removed the runtime HP ×5 and ATK/DEF ×1.5 boss multipliers so normal boss stats come directly from the database level formula.
2. Restored only the intended Greater-boss chest HP modifier: Treasure Chest ×1.5 max HP and Golden Chest ×2 max HP. Greater ATK, DEF, and CRIT remain database-authored.
3. Persisted/reconstructed the Greater chest result from the spawned boss snapshot so a restart cannot change the announced chest tier or reward path.
4. Removed full-size summon media from the final summon result and explicitly clears suspense attachments on the result edit.
5. Restricted the suspense MediaGallery to tester cosmetics and tester-rooted overrides. Base, founder, store, future catalog, and arbitrary non-tester overrides use the normal animated header emoji.
6. Removed the obsolete local `card_flip.gif` requirement from the emoji-only summon path and expanded boss/summon/skin regression coverage.

---

### Balance Patch Continuation, Passive SQL, and Branch Merge

**Agent:** OpenAI Codex
**Working branch:** `balance-patch`
**Final local branch:** `main`
**Completed:** 2026-07-16 17:58:07 TST

Balance-patch history continued from:

1. `383d451` — 2026-07-16 12:28:58 TST — `Balance patch: stun-lock fix, dizzy nerf, casino cap, summon line, compare cmd`
2. `a02fd48` — 2026-07-16 12:42:18 TST — `Balance patch (task 1b, stage A): rebalance ~27 registry-only passives`
3. `747e623` — 2026-07-16 12:51:15 TST — `Balance patch (task 1b, stage B): 10 engine-primitive passives`

Codex completion and merge commits:

1. `0edae9b` — 2026-07-16 17:57:09 TST — `feat: complete RPG balance patch`
2. `e1c281f` — 2026-07-16 17:58:07 TST — `Merge branch 'codex/boss-balancing' into balance-patch`

Continued and finalized work:

1. Fixed Discord duel accept/decline interactions that could display `This interaction failed`. Hardened button ID parsing, pending-duel lookup/cancellation, lock ownership, interaction acknowledgement, and terminal component cleanup.
2. Set the casino wager ceiling to 500,000 and completed the Crash progression changes. Crash now has at most 10 steps; at step 10 only Cash Out remains available, with no further continue action.
3. Finalized the Fighter stun probabilities at 15% for a one-turn stun and 10% for a two-turn stun, with no forced first-turn stun.
4. Added a central battle-engine stun guard: an active stun cannot be refreshed by any stun source, and the recovery round prevents immediate re-stunning. Adversarial deterministic testing capped consecutive skipped rounds at two and prevented unlimited stun loops.
5. Reduced Dizzy's miss chance to 15% and audited stun, freeze, paralyze, charm, evasion, queued attacks, criticals, burns, reflects, lifesteal, defeat effects, and end-turn stack timing.
6. Completed all requested deity and weapon passive implementations in `src/engine/passiveRegistry.js` and synchronized all 43 keys/descriptions in `assets/data/passive_registry_keys.md`.
7. Corrected attack-bound effects so they trigger only on landed hits, preserved queued next-attack effects through crowd control, fixed same-round critical reactions, and corrected stack timing for Mandarangan, Ares, Hera, Athena, Vidar, Magwayen, Spear of Ares, Tyrfing, and related passives.
8. Completed multi-word deity comparison and ownership/duplicate handling, plus summon result essence lines including explicit `+0` output.
9. Added `scripts/update-final-passive-descriptions.js`, with dry-run by default and transactional `--apply` support.
10. Added `scripts/final-passive-description-updates.sql` for PostgreSQL. It updates only `deity_roster.blessing_description` and `weapon_roster.passive_description`; roster names and registry keys are match guards and are not modified. All 38 deity and 5 weapon updates run atomically and require an exact one-row match.
11. Mapped the requested `Laevateinn` weapon to its stored database name, `Laevateinn Staff`. The final descriptions were applied in one live transaction and verified exactly during the continuation.
12. Added patch-specific tests that associate every final registry key with its implementation, documentation text, and exact SQL tuple. Casino tests finished at 182/182, help at 183/183, schema drift passed, the requested-patch suite passed, and the post-merge R2 skin suite passed.

Merge and validation result:

1. `codex/boss-balancing` merged into `balance-patch` without conflicts. Git automatically combined the overlapping `scripts/battle-selftest.js` and `src/engine/renderSummon.js` changes; no manual conflict resolution was required.
2. Local `main` was then fast-forwarded to merge commit `e1c281f`, and the two local feature branch names were deleted. Their commits remain reachable through `main`.
3. The post-merge full battle suite finished at 241 passed and 1 failed. The remaining assertion is `surviving boss attacks keep the Canvas status image`; the same assertion was already failing before the branch merge at 234 passed and 1 failed.
4. At handoff time, local `main` is 10 commits ahead of `origin/main`, the tracked worktree is clean, and nothing has been pushed.
5. `handoff.md` remains intentionally ignored by Git and was updated locally only; it was not staged or committed.

---

### Tester Avatar Rendering, Tester2 Profile Alignment, and Loki Completion

**Agent:** OpenAI Codex
**Branch:** `main`
**Completed:** 2026-07-17 22:36 TST

Functional commit sequence:

1. `ccaa388` — `fix: align tester profiles and avatar assignments`
2. `e11654e` — `fix: render directly equipped avatars`
3. `35c1e58` — `fix: shift tester2 profile avatar left`
4. `30bf9b9` — `fix: finalize Loki illusory double`
5. `9000c48` — `test: support CRLF in boss image assertion`

Tester avatar and profile work:

1. Traced stale production stats avatars through `avatar_catalog`, `user_avatars`, `equipped_avatars`, the R2 availability guard, the layout renderers, and the deterministic Canvas cache.
2. Added `scripts/repair-tester-avatar-assignments.sql`, an idempotent transaction that grants ownership and equips the intended class-matched tester avatars for the two previously reported tester accounts. The script validates both assignments before writing and returns a verification result. Codex did not execute this script against production because the available database connection was non-production; it is committed for controlled use if those ownership rows are still desired for avatar collections.
3. Corrected stats rendering so an active, class-matched `equipped_avatars` row is authoritative even when an administrator or seed flow did not also insert a duplicate `user_avatars` row. User-driven `crd avatar equip` still checks ownership before it writes equipment.
4. Verified the newly reported tester avatar object at its exact public R2 path: HTTP 200, `image/png`, 3,079,001 bytes. Once the resolver returns that equipped path, the stats Canvas input changes and receives a new deterministic cache key automatically.
5. Kept the command image contracts explicit: `crd profile` renders the target's Discord avatar URL, while `crd stats` renders the class-matched game avatar selected through `equipped_avatars`. Discord avatar fields were removed from stats render data so they cannot affect the stats image or its cache identity.
6. Registered the R2-only `tester_profile2.png` profile variant with a dedicated profile layout while retaining the existing tester stats layout. `profileLayoutAliases.js` now supports per-render-kind layout sources, so profile and stats can share a skin without being forced to share coordinates.
7. Added and tracked `assets/skins/testers/tester_profile2.layout.json`, uploaded it to `skins/testers/tester_profile2.layout.json`, and expanded the R2 skin regression suite to cover the dedicated-profile/shared-stats routing.
8. Centered the right panel on x=1033, moved the rank record into the available space at y=624, and placed the quote at y=712. The name, believer line, EXP text, progress bar, record, and quote share the right-panel center.
9. The first left-panel adjustment incorrectly moved the identity stack down by 30 pixels. The final correction restored the original vertical coordinates and changed only the avatar's optical x alignment: avatar x=220 and y=260 with size 250; class x=354 and y=550; combat EXP x=354 and y=580. This moves the avatar 10 pixels left from its original x=230 position while leaving the text centered and restoring the requested y positions.
10. Bumped `PROFILE_RENDER_REV` to 9 so deployment cannot reuse a profile card generated with the superseded layout. The final layout JSON is already live in R2; the code revision and routing changes still require deployment.

Loki passive completion included by the final all-worktree commit:

1. Raised Illusory Double's successful counter from 50% to 100% of the user's base ATK and synchronized the registry documentation, JavaScript updater, and transactional PostgreSQL description script.
2. Consumed the successful evade flag before applying the counter so a multi-hit action can trigger only one evasion and one counter for that turn roll.
3. Added deterministic coverage for the exact 25% proc boundary, the 100% base-ATK counter, and one-hit consumption during a two-hit attack.

Validation and handoff state:

1. `npm run selftest:skin-r2` passed after the avatar resolver and every tester2 layout correction.
2. `npm run selftest:patch` passed after the avatar and Loki changes.
3. JavaScript syntax checks, JSON coordinate validation, staged-diff inspection, and `git diff --check` passed.
4. The battle suite now completes at 262 passed and 0 failed. The final failure was a false negative in the `surviving boss attacks keep the Canvas status image` source assertion: its function extractor accepted LF only, while the committed Windows file used CRLF. The extractor now accepts both line endings and continues to verify the same Canvas status-image behavior.
5. The final tester2 profile was rendered from the authoritative R2 skin/layout using a Discord avatar source and visually verified before commit.
6. Existing ignored local assets, caches, previews, dependencies, environment files, and credentials were not staged. Nothing in this commit sequence was pushed.

## Session 2026-07-17/18 — Production memory follow-up (post-audit residual)

Railway RSS remained 670-850 MB after the 2026-07-16 audit build deployed. Production root cause is UNDETERMINED pending telemetry; see docs/production-memory-followup-2026-07-17.md for the full evidence classification, threshold-gated env experiments (MALLOC_ARENA_MAX=2, NODE_OPTIONS=--max-old-space-size=512, jemalloc — none applied), and the 24 h Railway monitoring procedure.

Code shipped (behavior-preserving, one commit each):
1. canvasCache.js — lastTouched Map bounded: unconditional delete in forgetMemory, stale prune past the touch-throttle window, hard cap at MEMORY_MAX (5000) evicting oldest timestamps; canvas URL cache untouched. (Confirmed unbounded-growth defect.)
2. Schedulers (battleReaper, bossScheduler, resetScheduler, seasonScheduler) — restart-safe guards: one timer, one stable stop fn, idempotent stop, start-after-stop creates exactly one new timer. Latent-bug insurance; call sites unchanged.
3. blackjack.js / crash.js — session wraps store channel + messageId instead of the full Discord Message; timeout edits via channel.messages.edit(id, payload) (same REST route/payload). Rules, payouts, cooldowns, text unchanged.
4. Telemetry: COMMAND_MEMORY_LOGS / CACHE_METRICS_LOGS / NETWORK_USAGE_LOGS sub-gates (default to RESOURCE_LOGS -> output unchanged), heapLimit (V8 heap_size_limit MB) added to [resource] summary+details, .env.example documented.
5. New scripts/analyze-resource-logs.js — parses [resource] lines from Railway logs, prints RSS decomposition table + trend verdict + which experiment threshold is met.
6. New scripts/lifecycle-guard-selftest.js (selftest:lifecycle, wired into selftest:full) — 17 checks: lastTouched bound + throttle preservation, scheduler start/stop contract for all four schedulers, casino wraps hold ids not Message objects.

Validation: selftest:full green (0 failures; help 183/183, casino 182/182, lifecycle 17/17, schema pass); memory soaks + preflight run this session (results in terminal log). docs/ and handoff.md remain gitignored per repo policy.

Validation addendum (2026-07-18): selftest:full green; casino soak 134 MB pass; integrated soak 165 MB idle pass; preflight pass. selftest:memory (profile/stats soak) FAILS at 506-512 MB idle with V8 external pinned at 360-365 MB — verified PRE-EXISTING: identical failure at main HEAD, d8bfd15, and the audit-fix commit f3fc615 with this session's changes stashed; selftest script unchanged since f3fc615; sharp/canvas binaries predate the audit. Not caused by, and not fixed by, this session. Documented as the top evidence-supported lead for the production residual (local idle ~512 MB parallels Railway 670-850 MB) in docs/production-memory-followup-2026-07-17.md, with the proposed investigation plan. Per scope instruction, no fix was attempted.

## Session 2026-07-18 — External-memory retention investigation (RESOLVED)

The profile/stats soak failure (506-512 MB idle, external 360-365 MB) was a MEASUREMENT RACE, not a leak. Controlled isolation proved it: profile-only, stats-only, and alternating-pair workloads all recover to 136-161 MB / external 2 MB; a verbatim replica of the soak reproduced the 505 MB / 365 MB plateau at exactly 1s idle, then collapsed to 137 MB / 2 MB by 2.5s with NO forced GC and 0 of 118 generated buffers reachable. Mechanisms: the quiescent canvas native-cache clear fires at 1s and V8's external-pressure GC collects canvas wrappers shortly after idle begins; the soak asserted at exactly 1000ms and read the pre-release plateau. Fix (commit 2b3fed4): scripts/memory-selftest.js idle phase now settle-polls every 500ms (15s cap) against the unchanged 350 MB target. Verified 3/3: steady 136-137 MB (better than the 295 MB in the 2026-07-16 audit table, which was itself a partial-release readout), external 2 MB, arrayBuffers 0. No renderer/production code changed.

Production implication: this REMOVES "profile/stats external retention" as a lead for the Railway 670-850 MB residual — the release mechanisms work when idle. Production root cause remains undetermined; the telemetry procedure and threshold-gated experiments in docs/production-memory-followup-2026-07-17.md are unchanged and still the next step.

Note: unrelated uncommitted changes were present in the working tree during this session (src/engine/battleEngine.js, src/engine/passiveRegistry.js, new src/engine/combatEffects.js, battle/weapon selftests) — not part of this work, left untouched, not committed.

## Session 2026-07-18 — Portable settle condition for memory selftest (Fable 5)

Follow-up robustness hardening on the memory-selftest settle fix (commit 2b3fed4). The prior fix polled only until RSS < 350 MB, which is not portable: some native allocators retain freed pages, so RSS can stay elevated after all renderer-owned external memory has been released, spinning the poll to the 15s cap and failing spuriously in CI.

Change (commit 1cad0ac, scripts/memory-selftest.js only): dual settle condition — a sample settles when external < 10 MB OR RSS < 350 MB. Two consecutive settled samples required so a single transient reading cannot pass. Timeout (fewer than two consecutive settled samples within 15s) always throws, independent of the final memory values. Settled snapshot and status:passed summary now report settleReason (external+rss / external / rss / timeout) and settleMs. No production code touched.

Validation: selftest:memory x3 all passed — steady 135-136 MB, external 2 MB, arrayBuffers 0, reachableGeneratedBuffers 0, settleReason external+rss, settleMs ~4.1-4.6s. selftest:full green (casino 182/182, all sections green). node --check clean. git diff --check clean. Commit 1cad0ac, not pushed.

Note: the unrelated battleEngine/passiveRegistry/combatEffects working-tree changes flagged in the prior entry are no longer present (handled separately outside this work).

## Session 2026-07-18 — Combat Effect Categories, Passive Corrections, and SQL Dashboard Fixes

**Model:** OpenAI Codex `gpt-5.6-sol` with extra-high reasoning.
**Branch:** `main`
**Completed:** 2026-07-18 03:16 TST

This entry covers the combat and passive-description work after the tester-avatar/profile entry above. The tester profile/avatar rendering, alignment, and Loki work is already recorded in that earlier entry and was not duplicated here.

Commit sequence:

1. `a246c80` — `fix: categorize combat effects and correct DOT passives`
2. `64de491` — `fix: make combat description SQL self-contained`
3. `920f777` — `docs: align deity passive wording`
4. `fa619cb` — `docs: simplify passive descriptions`
5. `51835a5` — `fix: make final passive SQL dashboard-safe`

Combat implementation completed:

1. Added `src/engine/combatEffects.js` as the authoritative stable-ID metadata for negative combat effects. Every active negative effect now has a `status` or `dot` category.
2. Classified Stun, Freeze, Petrify, Paralyze, Dizzy/Miss, Frostbite, Charm, Confuse, and stat reductions as `status`. Classified Bleed, Burn, Venom, Poison, Rot, and Thor's linked paralysis damage as `dot`.
3. Frostbite remains a status effect because its current mechanic is increased incoming damage rather than recurring damage.
4. Split Thor's mixed effect into a Paralyze status ID and linked paralysis DOT ID. Status immunity can block the action impairment without suppressing its damage-over-time component.
5. Corrected the canonical passive values: Cutlass 10% on attack/hit for 5% ATK Bleed; Pata 5% ATK Bleed per attack; Thyrsus 20% per turn for 5% ATK Bleed; Lamia 30% for 15% enemy-ATK Bleed; Chimera Serpent phase 20% enemy-ATK Burn.
6. Centralized Apolaki and Surt definitions. Echo Apolaki and Echo Surt now reuse the exact canonical handlers instead of old divergent every-third/every-fourth-turn hardcodes.
7. Restricted Alan's Reversed Hands to status immunity only. It removes/blocks status effects but does not block Bleed, Burn, or other DOTs.
8. Corrected Babaylan's Ritual Staff: each turn has a 50% cleanse check; a successful cleanse removes both status and DOT effects; +100% ATK is granted only if at least one debuff was removed; positive buffs are not represented as debuffs and remain intact.

Description and SQL work completed:

1. Added `scripts/update-combat-effect-descriptions.sql` for the scoped five weapon and two deity descriptions.
2. The first version used a temporary table across dashboard statements and failed with relation-not-found errors. Commit `64de491` moved its values into one self-contained `DO` block.
3. Updated `scripts/update-user-passive-descriptions.sql` with the five requested deity descriptions and exact verification.
4. Simplified wording in the three SQL update files: descriptions use natural phrases such as “Each attack,” and Frostbite says “taking 50% more damage” without internal terms such as “landed hit,” “all sources,” or “+50%.” Canonical JS/registry description mirrors were kept synchronized.
5. `scripts/final-passive-description-updates.sql` had the same temp-table dashboard failure. Commit `51835a5` now creates, consumes, and verifies all 38 deity plus 5 weapon updates inside one `DO` block, so it is safe to paste/run as a batch or as the block alone. Review-only queries that depended on the temp table after the block were removed.
6. No production database SQL was executed by Codex. The user manually runs the SQL scripts in the dashboard.

Validation:

1. Full `npm.cmd run selftest:full` passed after the combat implementation: battle selftest 276 passed, weapon-passive audit passed, requested-patch passed, plus telemetry, asset-cache, R2-skin, Canvas, schema, lifecycle, help, and casino suites.
2. `scripts/requested-patch-selftest.js` passed after each description/SQL follow-up.
3. Added regression coverage that requires `final-passive-description-updates.sql` to declare its `DO $passive_updates$` block before creating the temporary table and forbids a separate temp-table verification block.
4. `git diff --check` passed for each committed change.

Current handoff state:

1. Nothing from this combat/SQL session was pushed.
2. `handoff.md` is intentionally being updated locally at the user's request and remains separate from the committed code work.
3. An unrelated `scripts/memory-selftest.js` worktree modification remains outside this session and was not staged or committed here.

## Session 2026-07-19 — Casino Fairness and Enhancement-Aware Gear Resale

**Model:** OpenAI Codex `gpt-5` with extra-high reasoning.
**Branch:** `main`
**Completed:** 2026-07-19 TST

This entry follows the Combat Effect Categories, Passive Corrections, and SQL Dashboard Fixes entry above. The combat implementation and description/SQL work were left unchanged.

Casino implementation completed:

1. Audited all casino random paths and confirmed the live casino uses the crypto-backed `crypto.randomInt` wrapper, with no `Math.random` calls in casino engines or command wrappers.
2. Verified Crash odds by distribution: push 1 is 20%, push 2 is 22% conditional on reaching it, and cumulative crash probability by push 2 is 37.6%. The newer +2%-per-push curve was intentional and remains the active balance table.
3. Serialized concurrent Blackjack and Crash button actions so rapid or duplicate Discord interactions cannot consume multiple hidden actions before the message refreshes. Timeout handlers now defer while an action is pending.
4. Corrected Blackjack natural-21 settlement so the dealer cannot draw against a player natural and incorrectly manufacture a push.
5. Added the next Crash push's exact chance and locked multiplier to the active game display for clearer odds communication.

Gear resale implementation completed:

1. Added the canonical successful-enhancement cost accumulator: stored enhancement 8/display +7 counts the tier's +1 through +7 costs exactly once.
2. Revised weapon and armor resale to use `tier base sell price + floor(30% × successful enhancement costs)`. Failed attempts and historical Credux spending do not count.
3. Applied the same calculation to single-item sales, tier/all bulk sales, confirmation-time recomputation, and equipment-info Sell Value display.
4. Preserved tier-specific base prices and enhancement-cost tables: Common 100, Rare 1,000, Mythic 50,000, Legendary 100,000, Supreme 1,000,000.

Validation:

1. Full `npm.cmd run selftest:full` passed: battle 276/276, weapon passive audit passed, requested-patch passed, casino 187/187, plus telemetry, asset-cache, R2-skin, Canvas, schema, lifecycle, and help suites.
2. Added regression coverage for casino cumulative Crash odds, overlapping action guards, Blackjack natural settlement, all tier-specific +7 resale calculations, max enhancement resale, bulk totals, and equipment-info display.
3. `git diff --check` passed. No production database changes were executed.

Current handoff state:

1. The casino and gear-resale changes, their regression coverage, and this handoff entry were committed in this session and were not pushed.
2. Existing unrelated worktree changes were preserved and were not included unless already part of the staged session scope.
