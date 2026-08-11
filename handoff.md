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

**Model:** OpenAI Codex `gpt-5.6-sol` with extra-high reasoning.
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

## Session 2026-07-19 — Crash Chance Rebalance

**Model:** OpenAI Codex `gpt-5.6-sol` with extra-high reasoning.
**Branch:** `main`
**Completed:** 2026-07-19 TST

This entry follows the Casino Fairness and Enhancement-Aware Gear Resale entry above. The casino action guards, Blackjack correction, gear-resale calculation, and all other casino payouts remain unchanged.

Crash balance update completed:

1. Reduced the first Crash push chance from 20% to 15%.
2. Preserved the +2 percentage-point increase per climb: pushes 1 through 10 now use 15%, 17%, 19%, 21%, 23%, 25%, 27%, 29%, 31%, and 33%.
3. Updated the shared payout table and engine documentation. The active Crash UI continues to read the shared table, so it now displays the revised chance automatically without a duplicate hardcoded value.
4. Preserved every multiplier, the 10-push gameplay cap, crypto-backed randomness, settlement behavior, and button-action serialization.

Validation:

1. Focused `node scripts/casino-selftest.js` passed at 187/187.
2. Full `npm.cmd run selftest:full` passed: battle 276/276, weapon passive audit passed, requested-patch passed, casino 187/187, plus telemetry, asset-cache, R2-skin, Canvas, schema, lifecycle, and help suites.
3. Regression expectations now enforce the 15% start, +2% progression, 29.45% cumulative crash probability by push 2, 33% final gameplay push, and the unreachable 75% formula cap.
4. `git diff --check` passed. No production database changes were required or executed.

Current handoff state:

1. The Crash chance rebalance, updated tests, and this handoff entry were committed in this session and were not pushed.
2. Pre-existing handoff-only formatting/model edits present at the start of this session were preserved.

## Session 2026-07-19 — Bestow Confirmation Controls

1. Fixed `crd bestow` Confirm and Cancel buttons being handled by the global interaction fallback before Bestow's message collector could receive them, which produced “This control is no longer active.”
2. Marked only `bestow_confirm` and `bestow_cancel` as collector-owned controls; the existing Bestow validation, transfer, expiry, and message behavior are unchanged.

Validation:

1. Verified the interaction router now returns before its stale-control fallback for both Bestow button IDs.

## Session 2026-07-19 — Crypto-Backed RPG Randomness

Implementation completed:

1. Added a shared `crypto.randomInt` RNG utility with integer, inclusive-range, probability, unit-interval, and weighted-index helpers.
2. Removed every production `Math.random` reference from deity summons, chest and gear drops, enhancement success, rune bags and values, roster selection, quests, bosses, and default raid-loot rolls.
3. Preserved injectable RNG parameters for deterministic tests and preserved the seeded raid combat/reward stream used for replay consistency.
4. Corrected the deity gacha table to Epic 64.5%, Mythic 34%, Legendary 1%, and Supreme 0.5%, totaling exactly 100%.
5. Updated regression coverage for the revised gacha rates, crypto-backed helper boundaries, and the absence of `Math.random` in all converted production files.

Validation:

1. Loaded the complete command handler and ran 2,000 iterations across deity, chest, gear, rune, boss, raid-loot, and shared selection RNG paths successfully.
2. Requested-patch, casino (187/187), lifecycle (17/17), help (183/183), weapon-passive, telemetry, schema, asset-cache, R2-skin, and Canvas self-tests passed.
3. The battle self-test reached 285 passing checks, including every new RNG check, but retains three pre-existing stale Legendary ascension-cost expectations from before commit `6d0e32a`; those unrelated assertions were not changed in this RNG session.
4. Source syntax checks and `git diff --check` passed. No production database operations were required or executed.

Current handoff state:

1. This RNG conversion and handoff entry are ready to commit and have not been pushed.

## Session 2026-07-20 — Genesis Update Phases 0-5 (Rewards, Compensation, CRD Shop, CRD Bag, crd use)

**Model:** Claude Fable 5 (`claude-fable-5`).
**Branch:** `main`
**Specs:** `specs/spec_document_1.txt` (S1-13), `specs/spec_document_2.txt` (S14-16), `specs/genesis_tier_weapons.md`. Plan pauses after each phase for owner review.

Phase 0 — Discovery:

1. Full codebase/schema inspection recorded in `docs/discovery_notes.md` with 12 explicit assumptions (relic ids `sr`/`supr`; Diamond/Genesis chests and `change_class` existed as emojis only; no gender column; PHT convention; no class-change logic; content-addressed canvas cache).
2. Owner decisions locked: gender derives from equipped avatar; Genesis avatar = token-shop style at 15 tokens; Genesis Chest = 100% Genesis weapons, Diamond Chest = 50% Mythic / 50% Legendary; shop command `crd shop`; full Genesis weapon passives in this update; NO level-1 reward (live and compensation both start at level 2); Celestial takes the rotating exclusive season title.

Phase 1 — Manual SQL pack (NOTHING executed; owner runs by hand after the patch):

1. `scripts/migrations/20260720_01..09`: level-reward tracking tables (PK discord_id+level, levels 2-50), `crd_shop_purchases` (PHT period keys: daily YYYYMMDD / weekly phtWeek int / monthly YYYYMM), users_bag columns (`change_class`, `diamond_chest`, `genesis_chest`), bag-category documented no-op with validation queries, ranked_reward CHECK + Celestial reward row (copied from Divine, marked TUNE ME), avatar_catalog genesis style + 10 seeded rows (15 tokens), the five Genesis weapons (ids 78-82, guarded, sequence bumped), and a reverse-order rollback script with previews/snapshot instructions.
2. Every script: purpose comment, preview query, BEGIN/COMMIT, duplicate guards, validation queries, rerun-safety note.
3. `src/db/schemaGuard.js` now requires the new tables/columns and names the exact pending migration file at boot (fail-fast if code deploys before SQL).
4. `assets/data/game_items.txt`: five weapon emoji rows appended with `<EMOJI_ID_HERE>` placeholders (loader skips non-numeric ids safely; replace after uploading emojis).

Phase 2 — Reward engine:

1. New `src/config/levelRewards.js` (combat + believer bracket tables, per-level math, formatters) and `src/utils/grantLevelRewards.js` (exactly-once grants via INSERT..ON CONFLICT DO NOTHING RETURNING; credit + tracking + game_logs commit or roll back together; set-based Many variant for bosses with sorted bag locks).
2. Hooks: `awardCombatExp`/`awardCombatExpMany` attach `rewards` (raid/autoRaid/boss get grants inside their existing transactions); `summonEngine.awardReputation` grants believer rewards (summon + relic paths); `awardBelieverExp` restructured with an unlocked fast path (common 3-exp case unchanged), bag-lock-first slow path, stale-probe retry, returns `{awarded, levelUp}`.
3. Surfaces: raid footer + auto-raid claim card reward lines, boss kill announcement grouped level-reward line, fire-and-forget believer level-up channel notices (commandHandler, interactionCreate, summon, relic open) that can never affect the committed grant.

Phase 3 — Compensation:

1. `scripts/level-reward-compensation.js` + npm `compensate:levels:dry` / `compensate:levels` (refuses without exactly one flag). Dry run never issues BEGIN. Execute reuses the live grant functions per-user (bag lock → grants → COMMIT), isolated failures, keyset pagination (200/batch, scalar totals only), full report (checked/compensated/skipped/failed + Credux/Gold/BTC/BGTC totals), source='compensation' rows for surgical reversal.

Phase 4 — CRD Shop:

1. New `src/config/crdShop.js` (7 products, ids 1-7; PHT periodKey/nextReset verified against Monday-night boundary) and `src/commands/rpg/crdShop.js` (pvpShop structural clone: container listing with price/limit/bought/cap/reset countdown/balance; atomic buy: bag FOR UPDATE → tracking FOR UPDATE → cap-guarded upsert → single deduct+grant → game_logs → COMMIT; strict integer id/qty validation pre-DB).
2. `commandHandler.js` `shop` entry repointed to the CRD Shop; `crd shop supporter` forwards to the legacy supporter shop unchanged.

Phase 5 — CRD Bag categories + crd use:

1. `src/engine/bagViews.js`: Chests view now sc/gc/btc/bgtc/supc/dmc/gnc (relics removed); new Items view (`crd bag items`) listing cc/sr/supr with `crd use` hints; overview gains an Items row; `getChestCounts` reads the three new columns.
2. `src/config/crdBagItems.js`: the sole `crd use` resolution registry (cc/sr/supr, ids unchanged).
3. `src/commands/rpg/use.js`: `crd use <id>` — registry-only resolution with distinct rejections (numeric shop ids, chest codes, rune-bag codes, unknown); `use sr|supr` delegates to the exported `openRelic` transaction (effect-before-consume preserved); `use cc` ownership pre-check then hands off to the Phase-6 Change Character flow (item consumed only inside its confirm transaction). `crd use skin` unchanged.
4. `src/config/dropRates.js` + `src/commands/rpg/open.js`: Diamond Chest (`dmc`, 50/50 Mythic/Legendary) and Genesis Chest (`gnc`, 100% Genesis, weapon-only, maxOpen 1) wired through the existing open machinery; GENESIS_STATS fixed 1600 ATK / 20% crit / 50 bonus_dmg_pct (the spec's "+50% Crit Damage" carried by the same damage-rider stat Supreme uses — flagged for owner review); Genesis native sockets fixed at 2; `chestOpen.js` gif/emoji/flavor entries + genesis-first tier order.
5. `help.js`: bag items / crd use / crd shop entries added.

Validation:

1. All modified files pass `node --check`; command handler + use/bag/open load clean.
2. Reward bracket math, formatters, and PHT period-key/reset math verified by inline tests; help self-test 183/183 green.
3. No production database operations were executed; all SQL remains manual per the owner's instruction (owner will run the pack after the full patch lands).

Phase 6 — Character Class Change flow (`crd use cc`):

1. New `src/commands/rpg/changeClass.js` — fully independent copy of the Create Character configuration (own brand constant, payload builders, `chgclass:*` custom-id namespace, `change-class-preview-card` cache key). Header "## ⚒️ Change Character"; current class marked and its button disabled (plus server-side guard); preview shows current → new class with an explicit warning; Confirm (Danger) / Go Back / Cancel.
2. Confirm transaction (all-or-nothing, lock order bag → character): change_class ≥ 1 FOR UPDATE → class FOR UPDATE (≠ current, valid) → `UPDATE user_character SET class` only (progression/inventory/equipment untouched; stats are runtime-derived) → avatar policy → battle-skin replacement → conditional `change_class - 1` decrement LAST (0 rows ⇒ full ROLLBACK; guards concurrent confirms and button retries) → game_logs 'Class Change' → COMMIT. Cancel/Go Back/timeout/current-class/invalid/DB failure consume nothing.
3. Avatar policy (owner-specified): purchased styles of the old class refunded at the CURRENT shop token price via `grantTokensTx` (ledger reason 'avatar_refund'; skipped when no supporters row), ownership removed, unequipped; founder/tester remapped to the new class row of the same style (same-gender preferred), equip follows; battle skins — old class default replaced by new class default (ownership + equip repoint only when it was equipped); other skins untouched.
4. `src/handlers/interactionHandler.js`: `chgclass` namespace block mirroring `create` + INTERACTION_COMMANDS entry (`chgclass` → 'use'). Success container reports old → new class, passive, consumed 1 / remaining, refunded tokens, remapped styles.

Phase 7 — Genesis avatar assets:

1. `src/engine/avatarSystem.js`: registered the `genesis` avatar style — `STYLE_COST.genesis = 15` (token-shop purchasable, same price as webtoon per owner decision), `STYLE_LABEL.genesis = 'Genesis'`, and shop ordering position 4 (after webtoon). Short ids resolve to `gm`/`gf`, matching the `<class>_gm`/`<class>_gf` catalog keys seeded by migration 07, so `crd avatar buy gm` and the equip/collection views work with no further changes.
2. New export `genesisAvatarAssetPath(className, gender)` builds the spec path `skins/avatars/genesis/{gender}/genesis_{class}_{gender}.png`. Inputs are trimmed and lowercased, then matched against whitelist sets (the five class names and male/female); anything else — unknown classes, empty values, and traversal attempts such as `../x` or `mage/../../etc` — returns null, so no user-controlled text ever reaches the path. The formula is byte-identical to the seed formula in migration 07, so catalog rows and code can never disagree. `canonicalAvatarAssetPath` routes genesis rows through it (the store `{gender}/{class}/{class}_{style}.png` layout is never applied to genesis), and the relative path is passed to the existing `assetPath()` resolver, keeping the R2/CDN base URL in one place.
3. `src/engine/avatarImageLoader.js`: after all candidates fail, a concise `[avatar] missing asset: <relative path>` warning is logged alongside the existing telemetry. The default class-art fallback and every cache limit/TTL are unchanged, and a missing file never substitutes a different class or gender.
4. Class-change integration: genesis is a purchased style, so the Phase-6 policy applies (refund at the current 15-token price, ownership removed, unequipped) and the renderer falls back to the new class's default art.

Validation:

1. Resolver verified over all 10 class/gender combinations, normalization cases (`'  MAGE '`, `'FEMALE'`), and 9 invalid/traversal inputs — all rejected to null. Row routing verified for genesis, webtoon, and grant-only founder rows.
2. `node --check` clean on both engine files; command handler and change-class flow load clean; `npm run selftest:skin-r2` passed.

Phase 7b — Genesis weapon passives (battle engine):

1. `src/engine/passiveRegistry.js` gained the five Genesis keys, all randomness drawn from the engine-injected `bs.rng()`: `kiri` (attack-bound +20% ramp capped at +120% plus a 25% double-strike roll, so crowd control cannot burn a stack), `moira` (one def_down source ramping -10% to -50% through the normal immunity gate, the conditional pierce flag, and sticky `tyrfing_no_miss`), `sophia` (+75% damage / +20% damage taken, rising to a sticky +150% once the wielder drops below 30% HP), `atlas` (+50% ATK, guaranteed crit every 3rd round, on-crit ATK-cut flag), and `titan` (30% lifesteal, 50% below half HP, plus the once-per-battle reprieve arm).
2. `src/engine/battleEngine.js` gained four small flag-gated hooks, each a no-op unless a Genesis passive set its flag: a 50% pierce clause in `effDef` that fires only while the defender's own per-round DEF multiplier is positive (the "defense buff active" signal); a Titan lifesteal heal in the existing landed-hit heal block; a Titan lethal-damage reprieve modeled on the Sidapa block (survive at 1 HP, no heal, `titan_atk_bonus = 1.00` folded back in by the registry each round); and an on-crit `atk_down` 0.30 for 2 engine ticks applied through the normal `tryApplyDebuff` immunity gate.
3. `src/config/sellPrices.js`: Genesis base sell price 2,000,000 (above Supreme), tier name and alias registered, and Genesis added to `ALL_EXCLUDED_TIERS` so `crd sell all` can never bulk-dump a First Arm. Enhancement cost tables and `rollWeaponStats` already carried Genesis support; drops are fixed 1600 ATK / 20% crit / +50% damage rider with 2 native sockets.
4. Documentation and tests: the five keys were added to `assets/data/passive_registry_keys.md`, the battle-selftest key-count expectation moved 171 → 176, and five explicit audit contracts were added to `scripts/weapon-passive-selftest.js` covering the ramp cap, double-strike roll, shred cap and immunity gating, no-miss, the sticky Sophia awakening, the Atlas crit cadence, and Titan's lifesteal tiers and once-per-battle reprieve.

Validation:

1. `npm run selftest:weapons` — 71 passives + none audited, all checks passed (this suite also resolves a full deterministic battle for every catalogued key, including the five Genesis weapons).
2. `npm run selftest` — 285 passed, 3 failed. The three failures are the pre-existing stale Legendary ascension-cost expectations carried from before commit `6d0e32a` (documented in the RNG session entry above) and are unrelated to this work; the key-count check now passes.
3. `npm run selftest:patch`, `node scripts/help-selftest.js` (183/183) green.
4. `npm run selftest:schema` fails by design with `required schema is missing users_bag.change_class, ... apply scripts/migrations/20260720_03_crd_inventory_columns.sql` — schemaGuard's fail-fast working as intended while the manual SQL is still pending. It will pass once migrations 01-03 are applied.

Current handoff state:

1. Phases 0-7b implemented and uncommitted; nothing pushed. Phases 8-10 (Celestial rank, remaining selftests, deliverables) remain — see `todo.md`.
2. Genesis avatar images must be uploaded to R2 at `skins/avatars/genesis/{gender}/genesis_{class}_{gender}.png` (10 files), and the five weapon images plus their emoji ids are still pending. Until then the loader logs the missing relative path and renders the default class art.
3. The bot will refuse to boot and `selftest:schema` will fail until migrations 01-03 are applied — intentional.
4. Deploy order: run migrations 01-03 → deploy code → run 05-08 → upload emojis + replace placeholder ids → compensation dry run → review → execute.

## Phases 8-10 Completion

Timestamp: 2026-07-21 +08:00

Phases 8, 9, and 10 are complete. Nothing was staged, committed, pushed, or executed against a production database.

### Phase 8 - Celestial rank

1. `src/config/ranked.js` now has six ordered, non-overlapping brackets. Divine is 10,000-19,999 and Celestial is 20,000-Infinity.
2. All existing PvP displays, matchmaking bands, result embeds, leaderboard formatting, weekly rewards, and seasonal rewards already resolve through the central ranked config, so no scattered point checks were added.
3. `src/config/titles.js` now exposes the Celestial rotating-title configuration. Existing `divine_*` catalog codes are retained for database compatibility, with backward-compatible exports for out-of-tree callers.
4. `src/engine/seasonEngine.js` grants the rotating exclusive only to Celestial. Divine and every lower bracket use the generic `season_<id>_<bracket>` title path.
5. `crd dev setrating`, season administration, and production preflight have no five-bracket cap or enum assumption. The `ranked_reward` database CHECK and Celestial reward row remain manual migrations 05 and 06.
6. No Celestial rank icon, emoji, badge, or role-assignment system exists in this repository. Current text-only rank rendering is the safe fallback.

### Phase 9 - Test completion

Added and wired into `package.json`:

- `scripts/level-rewards-selftest.js`
- `scripts/compensation-selftest.js`
- `scripts/crd-shop-selftest.js`
- `scripts/crd-bag-use-selftest.js`
- `scripts/class-change-selftest.js`
- `scripts/genesis-avatar-selftest.js`
- `scripts/celestial-rank-selftest.js`
- `npm run selftest:genesis-update`

Additional test updates:

1. `scripts/battle-selftest.js` now contains explicit Kiri, Moira, Sophia, Atlas, and Titan contracts.
2. The three stale Legendary expectations were aligned with the already-live reduced configuration: 47 total Sigil essence, 20 ascension essence, 67 combined.
3. `scripts/schema-drift-selftest.js` now builds its success fixture from every `schemaGuard.REQUIRED_COLUMNS` entry and checks migrations 01-03. It remains database-free.
4. `scripts/level-reward-compensation.js` is safe to import in tests through a `require.main` guard and exports its pure/batch helpers. CLI behavior is unchanged.
5. `src/commands/rpg/use.js` exports `useItem` for direct contract testing; command behavior is unchanged.

Final validation:

- `npm.cmd run selftest:full`: PASS.
- Battle self-test: 293 passed, 0 failed.
- Weapon passive self-test: 71 passives plus `none`, all passed.
- Eight Genesis update suites, including Genesis enhancement: all passed.
- Requested patch, network telemetry, asset disk cache, skin R2, canvas runtime, schema drift, and lifecycle suites: all passed.
- Help self-test: 183 passed, 0 failed.
- Casino self-test: 187 passed, 0 failed.
- `git diff --check`: passed; only expected CRLF conversion warnings were printed.
- Edited/new JavaScript files pass `node --check`.

### Phase 10 - Deliverables

Implementation file groups:

1. Reward and compensation: `src/config/levelRewards.js`, `src/utils/grantLevelRewards.js`, `src/utils/awardCombatExp.js`, `src/utils/awardBelieverExp.js`, raid/auto-raid/summon/boss callers, and `scripts/level-reward-compensation.js`.
2. CRD Shop and bag/use: `src/config/crdShop.js`, `src/commands/rpg/crdShop.js`, `src/config/crdBagItems.js`, `src/engine/bagViews.js`, `src/commands/rpg/bag.js`, `src/commands/rpg/use.js`, `src/commands/rpg/open.js`, drop/chest configs, command routing, interactions, and help.
3. Class/avatar: `src/commands/rpg/changeClass.js`, `src/engine/avatarSystem.js`, `src/engine/avatarImageLoader.js`, and interaction routing.
4. Genesis gear: `src/engine/passiveRegistry.js`, `src/engine/battleEngine.js`, `src/config/sellPrices.js`, `src/engine/enhancement.js`, data registries, and passive tests.
5. Celestial: `src/config/ranked.js`, `src/config/titles.js`, `src/engine/seasonEngine.js`, migrations 05-06, and the Celestial self-test.
6. Safety and verification: `src/db/schemaGuard.js`, `package.json`, the seven new self-tests, and updated battle/schema/weapon tests.

Manual SQL pack, in order:

1. `20260720_01_level_reward_tracking.sql` - Combat/Believer exactly-once tracking tables.
2. `20260720_02_crd_shop_tracking.sql` - database-backed period purchase totals.
3. `20260720_03_crd_inventory_columns.sql` - `change_class`, `diamond_chest`, `genesis_chest` bag columns.
4. `20260720_04_crd_bag_category_updates.sql` - category validation/documented no-op while preserving quantities.
5. `20260720_05_pvp_celestial_rank.sql` - expand `ranked_reward` CHECK to Celestial.
6. `20260720_06_pvp_celestial_rewards.sql` - guarded Celestial row copied from Divine and marked `TUNE ME`.
7. `20260720_07_genesis_avatar_catalog.sql` - Genesis style and ten class/gender catalog rows.
8. `20260720_08_genesis_weapons.sql` - five guarded Genesis weapon rows.
9. `20260721_10_genesis_enhancement_cap.sql` - widen the stored weapon ceiling for Genesis display +20.
10. `20260721_11_genesis_dev_avatar_grants.sql` - grant all ten Genesis avatars to each configured dev account without changing shop eligibility.
11. `20260721_12_genesis_post10_stats.sql` - backfill existing Genesis +11..+20 ATK to the +10-based growth curve.
12. `20260720_09_rollback.sql` - reverse-order rollback, validation, and compensation recovery guidance.

Compensation commands:

```powershell
npm.cmd run compensate:levels:dry
npm.cmd run compensate:levels
```

Always run dry mode first, review totals and failed IDs, then execute. Reruns are idempotent. For recovery, rerun after correcting a failed user; for reversal, follow the source-filtered `source = 'compensation'` snapshot/reversal procedure in migration 09 instead of broad balance updates.

CRD Shop reset behavior uses Asia/Manila (PHT, UTC+8, no DST): daily at 00:00, weekly Monday at 00:00, monthly on the first at 00:00. Period keys are `YYYYMMDD`, PHT ISO `year*100+week`, and `YYYYMM` respectively.

Final CRD Shop registry:

1. Character Class Change (`1`): 5,000,000 Credux, no cap, grants `cc` / `change_class`.
2. Lesser Bag (`2`): 1,000,000, maximum 10 monthly.
3. Greater Bag (`3`): 5,000,000, maximum 5 monthly.
4. Divine Bag (`4`): 10,000,000, maximum 3 monthly.
5. Silver Chest (`5`): 5,000, maximum 10 daily.
6. Gold Chest (`6`): 50,000, maximum 5 daily.
7. Diamond Chest (`7`): 2,500,000, maximum 1 weekly.

Final CRD Bag Items registry:

- `cc`: Character Class Change.
- `sr`: Sacred Relic.
- `supr`: Supreme Relic.

Final CRD Bag Chests registry:

- `sc`: Silver Chest.
- `gc`: Gold Chest.
- `btc`: Boss Treasure Chest.
- `bgtc`: Boss Golden Chest.
- `supc`: Supreme Chest.
- `dmc`: Diamond Chest.
- `gnc`: Genesis Chest.

Genesis resolver:

```js
function genesisAvatarAssetPath(className, gender) {
  const cls = String(className || '').trim().toLowerCase();
  const g = String(gender || '').trim().toLowerCase();
  if (!GENESIS_AVATAR_CLASSES.has(cls) || !GENESIS_AVATAR_GENDERS.has(g)) return null;
  return `skins/avatars/genesis/${g}/genesis_${cls}_${g}.png`;
}
```

Registered Genesis avatar object paths (manual upload required):

- `skins/avatars/genesis/male/genesis_archer_male.png`
- `skins/avatars/genesis/female/genesis_archer_female.png`
- `skins/avatars/genesis/male/genesis_fighter_male.png`
- `skins/avatars/genesis/female/genesis_fighter_female.png`
- `skins/avatars/genesis/male/genesis_knight_male.png`
- `skins/avatars/genesis/female/genesis_knight_female.png`
- `skins/avatars/genesis/male/genesis_mage_male.png`
- `skins/avatars/genesis/female/genesis_mage_female.png`
- `skins/avatars/genesis/male/genesis_swordsman_male.png`
- `skins/avatars/genesis/female/genesis_swordsman_female.png`

Final assumptions/owner decisions:

1. Level 1 is the starting state and is not compensated or granted; rewards begin at level 2.
2. PHT is the existing reset convention.
3. Character gender is derived from equipped avatar data because `user_character` has no gender column.
4. Genesis avatar style costs 15 supporter tokens and purchased old-class avatars are refunded/removed on class change; founder/tester styles remap.
5. Genesis `+50% Crit Damage` uses `bonus_dmg_pct = 50`, the engine's existing Supreme-style damage rider; owner review remains open.
6. Migration 06 copies Divine rewards because no authoritative Celestial values were provided; the owner must tune the row before launch.
7. Rotating title codes retain their existing `divine_*` catalog identifiers for data compatibility even though Celestial now earns them.
8. Active duel/boss simulations use already-built snapshots. A class change affects future stat assembly and render signatures without mutating an in-progress battle or clearing global caches.

Unrelated behavior confirmation:

- Quest reward logic was reused as a transaction pattern and not changed.
- Existing balances and inventory quantities are preserved by guarded additive SQL and the category no-op migration.
- Existing lower PvP thresholds, rating math, progression curves, public command names, Discord intents, and non-Genesis skin tiers were not changed.
- No production SQL was executed and no automatic migration/compensation startup routine was added.

Remaining owner rollout actions:

1. Review backups and manually run migrations 01-03 before deploying the code.
2. Deploy code, then manually run migrations 04-08 after reviewing/tuning migration 06.
3. Upload ten Genesis avatars and five weapon images to R2.
4. Upload five weapon emojis and replace `<EMOJI_ID_HERE>` in `assets/data/game_items.txt`.
5. Optionally upload `diamond_chest.gif` and `genesis_chest.gif`; missing GIFs use the existing results-only flow.
6. Run compensation dry mode, review totals/failures, then execute production compensation.

## Genesis +20 Enhancement Addendum

Timestamp: 2026-07-21 +08:00

The updated Genesis enhancement rule is implemented. Nothing was staged, committed, pushed, or executed against a database.

1. Genesis weapons now cap at display +20 (stored enhancement 21). Supreme and every other weapon tier still cap at +10; armor still caps at +10.
2. Each Genesis attempt from +10 to +20 costs 3,000,000 Credux and has a 10% success chance, matching Supreme +10.
3. Genesis +11 through +20 each add 10% of the weapon's +10 ATK. This is a fixed additive step from the +10 baseline, not 10% of +0/base ATK and not compounding. A 1,600-base Genesis weapon is 3,200 at +10, 3,520 at +11, and 6,400 at +20.
4. The public forge and developer enhancement command use the tier-specific ceiling. Sell refunds now include every successfully reached Genesis level through +20.
5. Manual migration `20260721_10_genesis_enhancement_cap.sql` widens the `user_weapons` stored-value CHECK from 11 to 21. The application transaction path enforces that only Genesis may exceed stored 11 because a PostgreSQL CHECK cannot join `weapon_roster`.
6. Migration 12 idempotently backfills Genesis weapons already above +10 to the clarified curve. Migration 09 includes both the stat-curve rollback and the guarded script-10 ceiling rollback; the latter refuses to restore the old ceiling while any weapon remains above stored 11.
7. `scripts/genesis-enhancement-selftest.js` covers caps, +11 through +20 cost/chance, stat behavior, refund totals, command guards, and migration contents. It is included in `selftest:genesis-update` and `selftest:full`.

Updated rollout action: review and manually run migration 10 immediately before deploying the tier-aware enhancement code, then run migration 12 in the same maintenance window to repair any Genesis weapons already above +10. No SQL was run by Codex.

Developer tooling follow-up: `crd dev givechest @user genesis <count>` now grants `users_bag.genesis_chest`; the `gnc` alias is also accepted. The existing transaction, row lock, amount validation, confirmation guard, and developer audit log path are reused unchanged.

Validation audit follow-up: the earlier Claude results (`285 passed, 3 failed` and a failing schema self-test) are no longer current. Commit `6d0e32a` intentionally reduced Legendary Sigil/Ascension essence to 47 + 20 = 67; the three old assertions were stale, and the remaining stale configuration comment has now been corrected. `npm run selftest` passes 293/293. `selftest:schema` is a database-free contract test and should pass: it now explicitly proves that pre-migration fixtures are rejected with migration 01/02/03 hints, while a complete fixture passes. The real startup `schemaGuard` remains fail-fast against the configured database until migrations 01-03 are manually applied. Production preflight now imports the boot guard requirements so its required tables/columns cannot drift from startup checks.

Developer Genesis avatar grant: manual data script `20260721_11_genesis_dev_avatar_grants.sql` grants all ten active Genesis catalog avatars to both configured developer accounts using `source='dev'`. It aborts if either account is unregistered or migration 07 has not produced exactly ten active Genesis rows, and it is idempotent. It does not modify the catalog, token prices, supporter balances, character classes, or shop code. The supporter shop and buy/equip lookup remain filtered to the user's current character class.

Fighter balance follow-up: Dizzy's one-attack miss chance is now 25% instead of 15%. The stun bands remain unchanged at 15% for one turn and 10% for two turns. Deterministic tests cover a 20% miss roll and the non-miss boundary at exactly 25%.

Genesis weapon migration follow-up: `20260720_08_genesis_weapons.sql` now stores the exact passive registry mappings (`Kiri/kiri`, `Moira/moira`, `Sophia/sophia`, `Atlas/atlas`, `Titan/titan`) and uses a collision-safe upsert. Rerunning it repairs an expected Genesis row whose `passive_key` or other canonical data is stale instead of silently skipping the row. It also expands the checked-in `weapon_roster` tier/type constraints for `Genesis` and `Greatsword`, aborts on unrelated id/name collisions, and validates every key before commit. No SQL was run by Codex.

Genesis developer grant follow-up: `20260721_11_genesis_dev_avatar_grants.sql` no longer depends on a statement-scoped CTE or transaction-scoped temporary target table. Both validation and the ownership INSERT carry the two developer IDs directly, preventing PostgreSQL 42P01 (`genesis_dev_grant_targets` does not exist) even when the grant statement is executed independently. The insert remains idempotent and does not change supporter-shop class filtering.

Genesis presentation follow-up: the Weapons glossary now ranks Genesis above Supreme, so the five available Genesis weapons appear first, and renders their fixed `GENESIS_STATS` values (1,600 ATK, 20% CRIT, +50% damage rider) with their database passive names/descriptions. The CRD Shop now uses the registered `credux_coin` custom emoji for its heading, prices, balance, and purchase receipt instead of the Unicode coin glyph.

Bag Items presentation follow-up: the general `crd bag` category list now labels the usable-item category as **Bag Items** and uses the uploaded `bag_items` registry emoji (`1528895769480921218`). The `crd bag items` page uses that same custom emoji in its header. Character Class Change, Sacred Relic, and Supreme Relic retain their individual row emojis and existing `crd use` ids.

Chest presentation follow-up: `crd bag chests` now orders progression chests as Silver, Gold, Diamond, Supreme, and Genesis, followed by a visual separator and then Boss Treasure and Boss Golden. The two boss-earned chests remain adjacent as a distinct group.

Bag id presentation follow-up: `crd bag chests` and `crd bag items` no longer use disabled right-side buttons for chest/item codes. Each row now begins with its id as inline code (for example, `` `sc` `` or `` `cc` ``), followed by the custom emoji, name, and quantity, matching the tap-to-copy pattern used by equipment inventories. The functional Drop Rates button remains unchanged.

Equipment inventory ordering follow-up: `crd bag weapons` and `crd bag armors` now share one strongest-first tier ranking: Genesis, Supreme, Legendary, Mythic, Rare, then Common. Enhancement remains the descending tie-breaker within each tier, followed by the existing acquisition-order fallback. Genesis is currently weapon-only, but the shared ranking keeps both queries aligned.

CRD Shop balance follow-up: current prices are Lesser Bag 1,000,000, Greater Bag 5,000,000, Divine Bag 10,000,000, Gold Chest 50,000, and Diamond Chest 2,500,000 Credux. Character Class Change and Silver Chest prices, all purchase limits, reset periods, inventory grants, and transaction behavior are unchanged.

Genesis post-+10 stat clarification: the prior flat 3,200 ATK behavior was removed. Every successful +11..+20 enhancement now adds a fixed 10% of the weapon's +10 ATK; forge previews, successful public writes, and developer enhancement all resolve through the same computation. Manual migration 12 repairs already-enhanced live rows without changing enhancement levels, costs, chances, or other weapon stats.

Genesis enhancement constraint follow-up: a forge can preview +11 correctly but PostgreSQL will reject the successful write with `user_weapons_enhancement_check` if migration 10 was not applied. Startup `schemaGuard` now validates that the named CHECK contains both `enhancement >= 1` and `enhancement <= 21`; a stale `<= 11` or missing constraint fails fast with the exact migration-10 path. The forge transaction already rolls the attempted charge back, so this failure spends no Credux. Manually run migration 10, then restart the bot; no SQL was run by Codex.

Genesis battle-log follow-up: Kiri now logs each real +20% damage-stack increase through +120% and separately logs a successful 25% double-strike proc. Sophia, Atlas, and Titan log their persistent passive activation or meaningful state transitions without repeating static text every round; Moira retains its DEF-stack and no-miss events. Evasion proc text for Sigbin, Loki, and Valkyrie is now emitted only when the evade actually stops a hit, preventing false "evaded" lines against Moira. Regression battles prove Moira still cannot bypass absolute damage negation.

Deity tier-emoji follow-up: the four uploaded `game_deities.txt` tier icons now replace Unicode rarity symbols across the shared deity text renderer: `epic_icon` for Epic/Remnant, `mythical_icon` for Mythic/Awakened, `legendary_icon` for Legendary/Undying, and `supreme_icon` for Supreme/Primordial. This covers `crd deity collection`, grouped summon result rows, summon rarity summaries, and other consumers of the shared rarity mapping. Individual owned-deity emojis and essence emojis remain unchanged.

Battle-log pagination follow-up: raid/battle and boss logs now open as one ephemeral embed page at a time with Previous/Next controls. Normal pages contain up to eight complete turns, beginning with turn 1 and continuing chronologically; a 3,800-character safety limit can shorten a page, and an exceptionally large single turn continues on explicitly labeled pages without dropping event text. The old multi-embed batches and ephemeral followups were removed, avoiding Discord's combined embed-content limit. Page controls expire after five minutes and are handled by the originating ephemeral collector. `npm run selftest` passes 306/306 and the complete `npm run selftest:full` chain is green.

## Venom Rune Rebalance

Timestamp: 2026-07-23

Venom Rune percentage ranges were lowered. `src/config/runes.js` `RUNE_VALUE_RANGES.venom` changed from `Rare [5,10] / Mythic [11,15] / Legendary [16,20] / Supreme [25,30]` to `Rare [1,2] / Mythic [3,5] / Legendary [5,8] / Supreme [9,10]`. This is the single authoritative range: `rollRuneValue` (generate/roll), `runeDescription` (display), and combat all derive from it. Values remain whole-number percents stored on `user_runes.rolled_value`; combat divides by 100 and applies venom once (`Math.max` highest-wins refresh in `battleEngine.applyRunes`). No other rune, and no venom duration/trigger/stacking/immunity logic, was touched. New ranges apply only to Venom Runes generated after the patch.

Existing owned Venom Runes are normalized by a manual DBA script, `scripts/venom-rune-normalize.sql` (not executed — owner runs it). Owned venom values live in exactly one active table, `user_runes.rolled_value`, keyed to venom via `rune_id -> rune_roster.effect_key='venom'`; socketed runes are the same rows, and no marketplace/trade/loadout/equipped-slot table denormalizes the value. The script sets fixed representative values by tier — Rare=1, Mythic=4, Legendary=6 (lower-middle integer of each new band) — via `UPDATE user_runes ... FROM rune_roster`. Supreme is excluded (none exist). It includes a preview query, pre-update counts by rarity, a transaction-wrapped `CASE` update, post-update validation plus a zero-row guard, and a snapshot-based rollback block. Idempotent/rerun-safe (fixed values), restricted to `effect_key='venom'` and the three rarities. Rerolls are lossy: run the rollback snapshot `CREATE TABLE` before the update if reversibility is needed. `rune_roster.value` (venom template rows) still holds old numbers but is only a `COALESCE` fallback for `NULL rolled_value`, which the script eliminates for all venom and new rolls never produce.

## Glossary Passive Descriptions and Lifesteal Battle Logs

Timestamp: 2026-07-24 +08:00

Glossary passive-description truncation and Lifesteal battle-log visibility are fixed. Nothing was staged, committed, pushed, or executed against a production database.

1. The exact Glossary truncation source was the local `clip()` helper in `src/commands/rpg/glossary.js`, which capped descriptions at 180 characters and appended an ellipsis. The roster columns are PostgreSQL `TEXT`, and the existing queries returned their complete values; the database and authoritative description wording were not changed.
2. The fixed `LIMIT 10/OFFSET` gear and rune pagination was replaced with pagination based on the final formatted character count. Pages retain a maximum of ten entries as a secondary guard, but fewer entries are shown whenever their complete text requires more room.
3. Glossary page bodies use a 3,600-character safety limit below Discord's 4,000-character Components V2 Text Display limit. The static header remains in a separate short Text Display, and the existing container uses no Discord embeds or embed fields, so embed title, field-name, field-value, total-embed-character, and ten-embed message limits are not consumed.
4. Complete entries stay together whenever they fit. If one passive or blessing description is too large, only its description is split at paragraph, sentence, whitespace, or punctuation boundaries when available. Continuation pages repeat the entry identity and use `Passive Description — Continued`; rune fallback text uses `Rune Description — Continued`. No ending is replaced with `...` or silently omitted.
5. Deity Glossary pages remain grouped by mythology and only gain extra pages when complete blessing text requires them. `crd deity collection` pagination and code were not changed.
6. Glossary Previous/Next controls still use modulo wrapping. Previous on page 1 opens the final dynamically generated page, Next on the final page opens page 1, both controls remain enabled when multiple pages exist, and page indicators use the post-split page count.
7. Lifesteal healing still uses the existing applied attack damage, source percentage, floor operation, shared HP setter, maximum-HP clamp, lethal-hit timing, and reflection-death guard. No combat formula, class passive, rune value, proc rate, or battle outcome behavior was changed.
8. Every damage-based healing passive uses one compact battle-log line: `Passive name: Healed <number> HP`. This covers Vital Siphon, Soul Drain, Echo Soul Drain, Vampiric Rune, and Forgefire Veins.
9. The full battle-log renderer already preserves all round event strings and paginates them below its 3,800-character description safety limit, so the new multiline Lifesteal events appear in the existing ephemeral full-log carousel without changing its bounded navigation behavior.

Validation:

- `npm.cmd run selftest`: 328 passed, 0 failed.
- `npm.cmd run selftest:weapons`: all 71 weapon passives plus `none` passed.
- `npm.cmd run selftest:patch`: passed.
- Targeted checks cover dynamic Glossary page density, 3,600-character page safety, complete description endings, continuation labels, word-boundary splitting, backward/forward carousel wrapping, uncapped Lifesteal, and max-HP-capped Vampiric Rune healing.
- `node --check` passed for `src/commands/rpg/glossary.js` and `src/engine/battleEngine.js`.
- `git diff --check` passed with only the repository's expected CRLF conversion warnings.

## Swordsman, Archer, and Fighter Passive Rebalance

Timestamp: 2026-07-24 +08:00

The class-passive balance update is implemented through the shared combat resolver and centralized class configuration. Existing handoff entries were preserved, and no production SQL or database operation was run.

1. `src/config/classes.js` now owns the affected mechanic values in `CLASS_PASSIVE_VALUES`: Swordsman Bleed 4% per eligible hit with a 20% maximum, Archer 25% DEF ignore plus a 25% Double Attack chance, and Fighter 25% Stun for exactly 1 turn with the existing 50% Bash damage.
2. Swordsman Bleed changed from 5% per application and a 30% cap to 4% per application and a 20% cap. Its existing two-tick duration, tick timing, ATK base, successful-hit trigger, reserved deterministic RNG draw, cleanse rules, and immunity rules remain unchanged. The value is explicitly clamped to 20%, including repeated and multi-hit applications.
3. Archer retains exactly 25% DEF ignore through the existing highest-wins armor-pierce lane; no second 25% source was added.
4. Archer now rolls one seeded 25% Double Attack chance after the first complete regular attack instance, only while the target remains alive. On success the engine calls the same `playerAttack` resolver again with `isBonusAttack: true` and `allowArcherDoubleAttack: false`, preventing recursion.
5. The second Archer attack receives a fresh crit roll, variance, current DEF calculation, attack-bound proc rolls, landed-hit hooks, Lifesteal, rune effects, status effects, death handling, and fresh chance-based block/evade checks. Durable one-shot defenses and next-attack guarantees remain consumed according to their existing rules.
6. Archer's second attack stays inside the same turn. It does not increment the round, rerun the passive/start-turn phase, tick DOT twice, expire buffs twice, or apply sudden death twice. The log places `🏹 <name>'s Double Attack activated!` between two separate normal attack lines.
7. Fighter's old split was 15% for one turn plus 10% for two turns, totaling 25%. It is now one exact 25% roll that always produces a one-turn Stun. The centralized no-refresh and post-Stun recovery guard remains unchanged.
8. Fighter Bash is still exactly 50% of the triggering hit and uses the existing defender/reaction pipeline. Its calculation, DEF interaction, crit behavior, and Jarngreipr interaction were not changed.
9. Fighter Dizzy remains visible through its `dizzy_pending` state, `💫` icon, application text, and skipped-turn text. It now expires with the one stunned action so it cannot add a second missed action; the target acts normally on its next eligible turn.
10. Character creation and class-change displays consume the updated centralized passive names/descriptions. The runtime Glossary has no class-passive collection, so no unrelated gear, deity, or rune Glossary content was changed.
11. The previously requested Mage Overcharge charge log remains intact and was not altered by this passive rebalance. Knight, Mage formulas, class stats, runes, equipment formulas, Lifesteal formulas, and unrelated battle behavior were left unchanged.
12. All production battle surfaces use the same resolver: normal/elite/dev battles and raids use `raid`, bosses use `boss`, and regular/wager/ranked PvP use `duel`.

Validation:

- `npm.cmd run selftest:full`: passed the complete repository chain.
- Combat self-test: 352 passed, 0 failed.
- Seeded 4,000-battle samples measured Archer Double Attack at 25.0% and Fighter Stun at 25.0%; no two-turn Fighter Stun occurred.
- Targeted coverage proves Swordsman 4%/8% accumulation and 20% multi-hit cap; Archer independent normal/critical combinations, no recursion, first/second-hit death handling, independent Lifesteal/on-hit/evade rolls, one-turn DOT timing, and raid/boss/duel routing; Fighter one skipped turn, visible Dizzy, unchanged 50% Bash, immunity, and anti-refresh behavior.
- Weapon-passive audit: all 71 passives plus `none` passed.
- Class-change, requested-patch, help, schema, lifecycle, renderer, telemetry, asset-cache, and casino self-tests passed.
- `node --check` passed for `src/config/classes.js` and `src/engine/battleEngine.js`.
- `git diff --check` passed with only the repository's expected CRLF conversion warnings.

## Standardized Additional Attacks and Mage–Labrys Interaction

Timestamp: 2026-07-24 +08:00

Additional attacks are now resolved as complete regular attack instances through the shared battle engine. The change is limited to attack context, generator ordering/gating, the explicitly requested Mage multiplier, and the affected Archer/Labrys descriptions. No production SQL or database operation was run.

1. Every attack now has explicit primary/additional context. Additional attacks rerun attack-bound hooks and receive independent crit, variance, defense, chance-based defensive checks, Lifesteal, runes, landed-hit equipment effects, class attack passives, status application, reactions, and death handling.
2. Additional-attack generators are primary-only. Labrys, Glacial Bow, and Archer cannot trigger themselves or one another from a generated attack, preventing recursive chains.
3. When Archer and Labrys activate together, the deterministic order is primary attack, Labrys additional attack, then Archer additional attack. The turn therefore has at most three attacks. Labrys killing the target prevents the queued Archer attack; a primary kill prevents every queued additional attack.
4. Labrys retains its authoritative 70% ATK damage scale and activates after the primary attack on every third eligible turn. It does not increment the round, repeat turn-start processing, or copy the primary attack's final damage. Its additional attack receives its own complete calculation and can crit independently.
5. The illustrative “normal 100%” Labrys wording in the second attachment conflicted with the first attachment's explicit instruction and the existing implementation to preserve 70%. The preserved 70% value is treated as a normal independent attack calculation at a 0.70 ATK scale.
6. Mage Overcharge was 250% before this task. The second attachment explicitly defines and tests 275%, so the primary attack on rounds 3, 6, 9, and so on now uses the existing Overcharge lane at a 2.75 base multiplier and cannot crit. Labrys and every other additional attack remain normal, independently crit-eligible attacks and never inherit Overcharge.
7. Swordsman applies its existing 4% Bleed stack independently on each successful primary or additional hit, still capped at 20%. Fighter gets one independent 25% Stun/Bash roll per attack while the existing no-refresh guard preserves exactly one skipped turn and the visible Dizzy feedback. Knight's existing +30% outgoing multiplier is applied once inside each attack calculation; its 25% damage reduction is unchanged.
8. Turn-indexed weapon effects do not repeat on additional attacks. Hephaestus Hammer's fourth-turn strike, Apollo's fourth-turn guaranteed crit, Mjolnir's third-turn +200% rider, and Trident's even-turn Tidal Wrath remain primary-only. Mjolnir's ordinary +30% per-attack bonus remains eligible on additional attacks.
9. Battle logs identify the source activation before each generated attack, so Labrys, Glacial Bow, and Archer attacks are visually separated while their normal damage, crit, passive-healing, status, and HP lines remain intact.
10. Archer's public passive wording now says “additional attack.” The checked-in Labrys registry description now states that every third eligible primary attack is followed by one 70% ATK additional strike and that both attacks can crit and trigger eligible attack effects.
11. The local manual description patch in `scripts/patch_descriptions.sql` was updated with the same Labrys wording but was not executed. The owner must review and run the existing patch process if the live database description should be synchronized.

Validation:

- `npm.cmd run selftest:full`: passed the complete repository chain.
- Combat self-test: 380 passed, 0 failed.
- Weapon-passive audit: all 71 passives plus `none` passed.
- Targeted coverage includes Labrys on rounds 3 and 6, 70% scaling, independent crits, Archer/Labrys three-attack order and maximum, generator recursion prevention, primary/Labrys kill short-circuiting, Swordsman/Fighter/Knight/Mage interactions, per-attack Lifesteal, turn-indexed passive isolation, Glacial Bow composition, and one sudden-death application per turn.
- `node --check` passed for `src/engine/battleEngine.js`, `src/engine/passiveRegistry.js`, `src/config/combat.js`, and `src/config/classes.js`.
- `git diff --check` passed with only the repository's expected CRLF conversion warnings.

## Evasion and Damage-Absorption Log Distinction

Timestamp: 2026-07-24 +08:00

Battle-log presentation now distinguishes a successfully evaded attack from a zero-damage absorption or ignore effect. Combat calculations, proc chances, defensive ordering, and landed-hit behavior were not changed.

1. The shared defender result previously exposed only `negated`, which correctly suppressed landed-hit effects but combined true evasion with full damage negation. Both outcomes were therefore rendered as `0 DMG (evaded)`.
2. The result now carries a presentation-only `evaded` marker while retaining the existing `negated` mechanic flag. Shadow Step, Tailwind, Illusory Double, and Chooser's Grace set both flags when they actually evade.
3. A successful evasion now renders as `⚔️ <Attacker> attacks — **Evaded!**` or the matching enemy/multi-hit form. It contains no `0 DMG` text. The existing passive-specific event remains visible so players can identify which evasion activated.
4. Full damage absorption or ignore effects do not set `evaded`. Ironhide, Shieldmaiden's Guard, Stone Skin, and other genuine zero-applied-damage paths retain their `0 DMG` attack line and existing passive feedback.
5. The compact action summarizer recognizes the new evasion-only attack format and continues to display `Attack evaded`.
6. No HP, damage, crit, defense, evasion, absorption, counterattack, class passive, rune, weapon, deity, or battle-order behavior changed.

Validation:

- `npm.cmd run selftest:full`: passed the complete repository chain.
- Combat self-test: 380 passed, 0 failed.
- Weapon-passive audit: all 71 passives plus `none` passed.
- Targeted coverage proves Tailwind and Loki evasion lines contain `Evaded!` without `0 DMG`, multi-hit evasion still consumes only one Loki proc/counter, the following hit resolves normally, and Gridr absorption retains its zero-damage line.
- `node --check src/engine/battleEngine.js`: passed.
- `git diff --check` passed with only the repository's expected CRLF conversion warning.

## Deity Font, Blessing Channels, Cooldowns, Comparison Ids, and Gear Tier Icons

Timestamp: 2026-07-30 +08:00
Model: Claude Opus 5

Five independent display and configuration defects were fixed. No combat formula, pagination, carousel, sorting, equipment, or boss behavior changed. No production SQL or database operation was run.

1. `crd deities` rendered boxed characters for new users. `src/commands/rpg/deity.js` was the only canvas renderer in the repository that never registered a font, so every `ctx.font` requested the generic `sans-serif` family and depended entirely on the container having system fonts. Both it and `src/engine/renderSummon.js` now register the bundled `DejaVuSans.ttf` and `DejaVuSans-Bold.ttf` under the single family `DejaVu Sans`, matching the pattern already used by every other renderer. All ten generic font declarations across the two files were converted; sizes, weights, positions, colors, and canvas dimensions are unchanged.
2. The broken image was pinned for every new account because the deities grid is cached cross-user. Every brand-new character has identical empty slots and identical lock state, so all new users hash to one `canvas_cache` key. `DEITY_RENDER_REV` was raised from 3 to 4 to evict the poisoned entry.
3. `crd stats` renamed `Divine Blessing` to `Primary Blessing` and `Echo Blessing` to `Secondary Blessing`. These labels denote the combat channel, not the Divine or Echo blessing type: an Echo-type deity equipped in slot 1 still supplies the primary channel, so the label is never derived from `DIVINE_BLESSING_DEITIES` membership.
4. The blessing resolution was extracted from `src/engine/statAssembly.js` into a new pure `resolveBlessingSlots()` helper in `src/config/blessings.js`, which both combat and the stats display now call. The extraction preserves the original branch order and resolved keys exactly. `blessingName` is carried through alongside `key` so the two surfaces cannot disagree about which deity supplies each channel.
5. The stats query previously built the secondary blessing by concatenating the slot-2 and slot-3 blessing names with no ascension gate, no slot gate, and no reference to `active_echo_deity_id`, so it advertised passives that never fire. It now resolves the canonical echo deity through `active_echo_deity_id` with `user_deities` and `deity_roster` joins.
6. Both blessing lines always render. Display states are `Locked` when the believer-level slot gate is unmet, `None` when no deity supplies the channel, `Deity not ascended` when the deity exists but its blessing is dormant, and otherwise the actual blessing name. The secondary gate order checks the slot-2 requirement before checking whether an echo deity is selected, so an early-progression character reads `Locked` rather than `None`. A stale `active_echo_deity_id` matching neither slot 2 nor slot 3 reads `None`.
7. `STATS_RENDER_REV` was raised from 17 to 18. The renamed label lives in the renderer rather than in the cached data object, so without the bump any user whose blessing name was unchanged would have continued receiving the old image.
8. Every command cooldown category in `src/config/cooldowns.js` was set to 15 seconds. `DEFAULT_COOLDOWN_MS`, `LONG_COOLDOWN_MS`, `RAID_COOLDOWN_MS`, and `COMBAT_COOLDOWN_MS` remain four separate constants and `PER_COMMAND_MS` and `cooldownMs()` keep their existing structure. Boss respawn timing, boss redirects, battle render throttles, session timers, and window timers were not touched.
9. Weapon and armor comparison rows now lead with the item id in inline code, then the tier icon, then the equipment icon, then the name. The id is normalized with the same lowercase token the existing lookup uses. Deity comparison output is unchanged.
10. A `GEAR_TIER_EMOJI_NAMES` map and `gearTierEmoji()` resolver were added to `src/utils/emojis.js`, mirroring the existing `deityTierEmoji()` validation. The database tier is `Mythic` even though the registry display text reads `Mythical`. Common intentionally has no icon because it does not drop from chests. Unknown, malformed, missing, or differently cased tiers return an empty string and never `undefined` or a malformed tag.
11. The tier icon was applied before the equipment icon in chest-drop results, weapon and armor collections, both glossaries, and both comparisons. Spacing is built conditionally so a tier without an icon produces no doubled or trailing space. Pagination, carousel cycling, sort order, tier order, stat lines, passive lines, equipped and lock indicators, enhancement display, and the existing chest tier-summary line are unchanged.
12. Two static assertions in the combat self-test pinned the blessing gate text to `statAssembly.js` by regular expression. They were retargeted to the helper's new location and a third assertion was added confirming `statAssembly` still delegates to it.

Validation:

- Combat self-test: 381 passed, 0 failed.
- A differential harness compared the extracted `resolveBlessingSlots()` against the original inline logic across 6,480 input combinations of deity name, blessing key, and ascension state, with 0 mismatches.
- Eleven blessing display states were verified, including an ascended Echo-type deity in slot 1 resolving to `Primary Blessing` rather than the reverse, the slot-2 gate taking precedence over selection, a slot-3 lock, and a stale echo pointer.
- `gearTierEmoji` returns the correct tag for all five mapped tiers and an empty string for `Common`, `Mythical`, `mythic`, `Uncommon`, empty string, `null`, and `undefined`. Rendered rows for every case contain no `undefined`, no doubled spacing, and no malformed emoji syntax.
- Font registration was verified with the bundled face: the family registers, and every deities-grid string including the em dash measures non-zero width and diverges from the unregistered-family fallback.
- Help self-test: 183 passed, 0 failed. Weapon-passive audit: all 71 passives plus `none` passed. `node scripts/production-preflight.js`: 0 failures, 1 warning.
- `node --check` passed for all fourteen modified files.
- `scripts/requested-patch-selftest.js` was not run to completion; it hangs with no output and was confirmed to hang identically on a clean tree with all changes stashed, so the failure is pre-existing and environmental.

## Thorn Rune Value Ranges, Shop Repricing, and Mob Reward Rebalance

Timestamp: 2026-07-30 +08:00
Model: Claude Opus 5

The first inspection pass of a ten-part armor and weapon passive rework was completed and the three unambiguous configuration parts were applied. Parts 1, 2, 6, 9, and 10 are not started, and Parts 4 and 8 are blocked pending owner confirmation. No production SQL or database operation was run, and nothing was committed.

1. Thorn Rune is keyed `thorns` in `src/config/runes.js`, not by display name. Its tier keys `Rare`, `Mythic`, `Legendary`, and `Supreme` match the requested structure. The per-instance rolled reflect value bands were changed from `[2,4]`, `[5,7]`, `[8,13]`, and `[15,20]` to `[5,10]`, `[12,15]`, `[18,20]`, and `[25,30]`. No rune-bag tier weight, rune selection probability, or other drop-rate field was changed.
2. Shop prices are hardcoded in `src/config/crdShop.js` and are not stored in the database, so no SQL was required. Greater Bag moved from 5,000,000 to 2,000,000, Divine Bag from 10,000,000 to 5,000,000, and Diamond Chest from 2,500,000 to 500,000. All three are reductions; the Diamond Chest change is an eighty percent cut and was flagged for confirmation.
3. Three expectations in `scripts/crd-shop-selftest.js` were derived from the old prices and were rebased: the expected price array, the insufficient-funds fixture balance of 2,499,999 which no longer failed against the cheaper chest, and the concurrency-guard remainder of 17,500,000 which became 19,500,000.
4. Mob rewards are defined per tier in `src/config/raidLoot.js`, not per mob, so no bulk per-mob update was needed. The tier keys are `regular` and `elite`, not `normal` and `elite` as the request assumed; the mapping is unambiguous and the edit was applied. Regular win rewards moved to credux 500 to 1,000, exp 200 to 300, and shards 5 to 10. Elite win rewards moved to credux 1,500 to 2,000, exp 400 to 600, and shards 15 to 20. The `chest`, `chestChance`, `shardChance`, and `loss.exp` fields were left untouched because the request did not mention them.
5. Greater Boss work was stopped before editing. The requested `Golden Treasure Chest` does not exist; the registry defines `Boss Treasure Chest` and `Boss Golden Chest`, and the latter is already the Greater Boss golden drop. The owner asked to be told rather than have a name guessed.
6. A two-stage Greater Boss variant system already exists in `src/config/bosses.js`, so the request is a re-tune rather than new construction. `GREATER_SPAWN_CHANCE` is 0.20 against a requested 0.30, `GREATER_CHEST_GOLDEN_CHANCE` is 0.20 against 0.25, `GREATER_TREASURE_HP_MULTIPLIER` is 1.5 against 2, and `GREATER_GOLDEN_HP_MULTIPLIER` is 2 against 3. `GREATER_REWARD` is a single reward object and must be split into per-variant values.
7. The glossary rune split was not applied, pending owner sign-off on the classification. `src/config/runes.js` already exports a clean, non-overlapping partition of all ten runes: `OFFENSE_KEYS` covers `sharpness`, `precision`, `vampiric`, `piercing`, and `venom`, and `DEFENSE_KEYS` covers `vitality`, `bulwark`, `thorns`, `warding`, and `aegis_rune`. These should be reused directly rather than a new classification being invented. The separate `COMBAT_EFFECT_KEYS` list does overlap `DEFENSE_KEYS`, but it describes a different axis, namely stat-pipeline versus combat-hook family, and is not the offensive and defensive split.
8. The passive handler was identified as `src/engine/passiveRegistry.js`, a single flat object keyed by passive, blessing, and skill key, with its contract in `docs/ENGINE_HOOKS.md` and key coverage asserted both ways by the combat self-test. Registry functions are pure state mutations that never deal damage or end a battle, and `Math.random` is statically forbidden there in favor of the seeded `bs.rng()`. The remaining passive work must extend this registry rather than introduce a parallel system.
9. Magwayen was confirmed to be an Echo Blessing deity keyed `echo_magwayen`, and Bathala a Divine Blessing deity, both in `src/config/blessings.js`. The Bathala deity is distinct from the Mantle of Bathala armor, which retains its own specification.
10. A tracking section covering all ten parts, the applied changes, the inspection findings, and the environment caveats was appended to `todo.md` so the outstanding work survives a session limit.

Validation:

- CRD shop self-test: passed after the three price-derived expectations were rebased.
- Combat self-test: 381 passed, 0 failed. Help self-test: 183 passed, 0 failed.
- `node --check` passed for `src/config/runes.js`, `src/config/crdShop.js`, and `src/config/raidLoot.js`.
- Runtime inspection confirmed the applied values: regular rewards `[500,1000]`, `[200,300]`, `[5,10]`; elite rewards `[1500,2000]`, `[400,600]`, `[15,20]`; and shop prices 2,000,000, 5,000,000, and 500,000.
- Self-test scripts are gitignored under `scripts/*selftest.js`, so the expectation rebases are local-only and are not part of any commit.

## Armor/Weapon Rework Completion and Prompt Audit

Timestamp: 2026-07-30 +08:00

The current five display/config requests and all unblocked sections of the attached
Parts 1-10 prompt were cross-checked against the worktree, `todo.md`, and this handoff.
No commit, deployment, production SQL, or database write was performed.

1. The deity grid and summon canvas now register the bundled DejaVu Sans regular and
   bold faces, and the affected cache revisions were advanced. Stats now display
   Primary/Secondary Blessing channels with ascension and slot gates. All four separate
   command cooldown constants are 15 seconds. Comparison rows lead with equipment ID.
   Weapon gacha, collection, glossary, and comparison rows place the new tier emoji
   before the weapon icon; armor tier icons were kept only in comparison as requested.
2. The combat defender path now sums damage reduction once, caps it at 70%, applies
   Brokkr's per-hit cap afterward, resolves non-recursive reflect after the hit, and
   then processes on-hit armor state. All requested Mythic, Legendary, and Supreme
   armor mechanics were implemented in the existing registry/engine.
3. Battle logs expose stacking, block, evade, cleanse/expiry healing, reflect, Stone,
   Unseen, cap, and other reactive triggers. Reflect, Cursed Edge, Death Charm, and
   lethal DOT causes are carried through the battle result and end-summary surfaces.
4. The glossary now has Offensive Runes (Sharpness, Precision, Vampiric, Piercing,
   Venom) and Defensive Runes (Vitality, Bulwark, Thorns, Warding, Aegis), using the
   existing config partition and preserving tier sort and carousel pagination.
5. Magwayen's primary and echo registry keys both heal 30% of damage dealt. Soul Drain
   covers attacks, additional attacks, Bash, counter, reflect, Rupture, Hemorrhage, and
   sourced DOT damage, with max-HP clamping and an activation log.
6. Bathala's deity passive now stacks +10% ATK and +4% DEF per turn to +100%/+40%.
   Mantle of Bathala remains a distinct armor passive with the requested max-HP and
   reduction behavior.
7. All requested Legendary weapon mechanics were reconciled, including semantic bleed
   tags for Hemorrhage/Rupture/Venom, shared boss immunity for prohibited procs,
   boss-allowed Badiang Venom, attack/stack values, and kill attribution. The existing
   literal `bleed` DOT remains untagged because the attachment requires owner
   confirmation before adding an existing effect to Bloodhunter's trigger set.
8. Thorn ranges, hardcoded shop prices, and per-tier raid reward ranges match Parts 3,
   5, and 7. The code's normal-mob key is `regular`, not `normal`.
9. Part 8 remains blocked exactly as requested: `Golden Treasure Chest` does not exist.
   The existing item is `Boss Golden Chest`. The current boss engine computes
   level-scaled HP first and applies the Greater variant multiplier second, which also
   conflicts with the requested base-HP-first order. No Greater Boss constants or
   rewards were changed.
10. `assets/data/passive_registry_keys.md`, the existing tracked description-update
    source, `todo.md`, and local ignored description SQL were reconciled with the new
    mechanics.

Validation:

- `npm.cmd run selftest:full`: passed the complete repository chain.
- Combat self-test: 382 passed, 0 failed, including explicit reflect-kill attribution
  and 70% reduction-cap contracts plus 2,000 fuzz battles.
- Weapon passive audit: all 71 passives plus `none` passed.
- Requested-patch, help (183), casino (187), schema, lifecycle, renderer, telemetry,
  asset-cache, shop, class, and Genesis suites passed.
- `node --check` passed for all affected JavaScript modules.
- Targeted runtime checks passed for all four 15-second cooldown constants, five gear
  tier emoji mappings, Echo-type primary blessing resolution, and bundled font glyph
  measurement.

## Follow-up: armor tier icon approval

The owner approved equipment tier icons for both weapons and armor. Armor collection
rows, armor glossary entries, and armor results from mixed gear chests now use the same
ordering as weapons: item id where applicable, tier icon, equipment icon, then item
name. Common and unknown tiers still omit the tier icon without adding extra spacing.

## Follow-up: Thorn Rune field correction

The owner clarified that 5-10 / 12-15 / 18-20 / 25-30 are Thorn Rune reflect-value
ranges, not drop rates. The worktree already placed them only in
`RUNE_VALUE_RANGES.thorns`; no drop-rate rollback was needed. A Thorn value is rolled
once during rune-bag opening, inserted into `user_runes.rolled_value`, and subsequently
read by inventory, equipment, socketing, and combat. No runtime path rerolls it.

A read-only database check confirmed the unchanged rune-bag tier weights: Lesser
Rare 100%; Greater Mythic 85% / Legendary 15%; Divine Legendary 85% / Supreme 15%.
Each tier currently contains ten selectable runes and exactly one Thorn Rune, so the
total Thorn chance remains 10% per bag. Existing owned Thorn instances have non-null
stored values from the former ranges; they were not rewritten or rerolled.

## Follow-up: Greater Boss Part 8 completed

The owner confirmed that Part 8's `Golden Treasure Chest` wording means the existing
Boss Golden Chest (`boss_golden_chest`). The existing Greater Boss system was retuned
without creating another chest item, column, alias, or config:

- Greater spawn chance: 20% to 30%.
- Nested variant roll: Twin Chest 75%, Boss Golden Chest 25%.
- Twin variant: base HP x2, two Boss Treasure Chests, 150,000 Credux, 30,000 Combat
  EXP, and 1,500 Belief Shards.
- Golden variant: base HP x3, one Boss Golden Chest, 200,000 Credux, 40,000 Combat
  EXP, and 2,000 Belief Shards.
- HP order: `base_hp * variant + hp_per_level * level`. ATK and DEF formulas are
  unchanged.
- Spawn announcements name Twin Chest or Boss Golden Chest and show the base-HP
  multiplier.

Variant choice is cached by spawn and recoverable from persisted max HP after restart.
Recovery also recognizes the former 1.5x/2x formula for any pre-change active spawn.
A read-only database check found no active Greater spawn during this update.

## Follow-up: inventory tier line and avatar component fix

In `crd bag weapons` and `crd bag armors`, the item id, equipment icon, name,
enhancement, and badges remain on line one. The equipment tier icon now begins line
two immediately before the tier name, followed by the existing stats and socket count.
Collection pagination and sorting are unchanged.

`crd avatar` failed for a one-page collection because the wrapped Previous and Next
targets were both page zero, producing duplicate Discord component custom ids even
though both buttons were disabled. Avatar button ids now retain the target page in the
same segment and append `prev` or `next`, making them unique without changing handler
parsing or carousel behavior. Existing messages using the old id shape remain valid.

## Follow-up: equipped Genesis avatar stats rendering

The reported account correctly had `swordsman_gm` equipped for its active Swordsman
class, and the catalog pointed to
`skins/avatars/genesis/male/genesis_swordsman_male.png`. A read-only signed R2 check
confirmed that exact object exists and is a valid 1024x1536 PNG after the repository's
existing C2PA metadata sanitization path.

`crd stats` previously erased the equipped path whenever its advisory public-CDN HEAD
probe returned false, so the renderer never attempted the real image GET and always
used class art. The path is now preserved. The HEAD result is stored separately in the
Canvas cache input: a transient HEAD failure cannot hide valid art, while a genuinely
missing object still receives a new cache key after the availability probe later
succeeds. `STATS_RENDER_REV` is 19 so existing fallback cards cannot be reused.

## Final passive release audit

Timestamp: 2026-07-30 +08:00

The final pre-commit audit covered every passive family in the shared registry:
class passives, runes, weapon and armor passives, primary and secondary deity
blessings, and mob/boss skills. The registry contains 176 unique keys including the
shared `none` handler. A read-only production roster comparison covered 68 weapons,
24 armors, 41 deities, and 38 mobs (171 live rows) and found no null passive keys, no
live key without a handler, and no live key absent from the authoritative ledger.

Confirmed defects fixed during the audit:

1. Zeus and several attack/on-hit effects were evaluated during the passive phase,
   allowing false procs on crowd-control skips or leaking an armed proc to a later
   attack. Zeus now rolls independently for each real attack and applies its DEF
   shred only after a landed hit. Echo Habagat also rolls per attack. Echo Vidar and
   Echo Idiyanale queue their next-attack effects durably and consume them only when
   an attack actually starts.
2. Amalanhig, Dark Elves, and Lamia now roll only after the mob lands a hit. Harpy
   and Cyclops cadence skills arm the next real attack, survive a skipped cadence
   turn, and apply their attached debuff only if that attack lands.
3. Soul Drain could heal from calculated overkill rather than target HP actually
   removed. Its inputs are now overkill-safe for primary/additional attacks, Bash,
   Thunder Grip's Bash, and Loki counters. Reflect, Rupture, Hemorrhage, and sourced
   DOT paths were also rechecked. Japanese Bo, Vampiric Rune, and Titan were left on
   their existing behavior because they are outside the requested Soul Drain change.
4. Reflect damage could be amplified a second time by Frostbite or Petrify, making
   a configured 12% reflect exceed 12%. Reflect now uses the exact percentage of the
   triggering hit's final damage and remains non-recursive.
5. The `rupture` effect already existed with the canonical bleed tag but Badiang did
   not apply its marker, so Bloodhunter could not detect Rupture. Badiang now applies
   that marker while retaining separate boss-blocked Rupture and boss-allowed Venom.
6. Mob attack-hook log lines were emitted before the attack that triggered them.
   They are now buffered until after the first attack line and before reactions.

Validation:

- `npm.cmd run selftest:full`: passed the complete repository chain.
- Combat: 398 passed, 0 failed, including 100-seed determinism and approximately
  2,000 seeded fuzz battles across the registry.
- Weapon passive audit: all 71 passives plus `none` passed.
- Requested patch, help (183), casino (187), schema, lifecycle, renderer, telemetry,
  asset-cache, shop, class, avatar, and Genesis suites passed.
- `node --check`: all 24 modified JavaScript files passed.
- `git diff --check`: no whitespace errors (only Git's CRLF conversion warnings).
- Read-only production preflight: 0 failures, 1 existing warning that the configured
  database connection is not using TLS.

No commit, deployment, production SQL, or database write was performed. The mechanics
are commit-ready. A final read-only text check found six live roster descriptions that
still advertise old values: Magwayen, Gungnir, Thunderbolt of Zeus, Katana, Lamia, and
Chimera. The tracked transactional description sync was expanded from 43 to 51 rows to
include all six (Magwayen was already targeted) and normalize Kiri, Amalanhig, and Dark
Elf to the owner's requested `Each attack` wording. Zeus uses the same wording through
the separate tracked deity sync. These updates must be applied manually during
deployment. Bathala, Odin, Zeus, and Hydra already matched their audited mechanics.

## Follow-up: Juru Pakal recognizes ordinary Bleed

Timestamp: 2026-07-30 +08:00

The reported battle log showed Sleipnir taking both Poison and ordinary Bleed damage,
but Juru Pakal never emitted its Bloodhunter trigger. The passive hook and log placement
were correct; `combatEffects.js` classified ordinary `bleed` as a recurring DOT without
the canonical bleed tag, so `enemyHasEffectTag('bleed')` returned false. The earlier
owner decision had tagged only Hemorrhage, Rupture, and Badiang Venom.

The owner has now explicitly confirmed that visible ordinary Bleed should activate
Bloodhunter. The `bleed` effect retains its DOT/recurring-damage behavior and now also
carries `BLEED_TAG`. Juru Pakal therefore keeps its unconditional +10% outgoing damage
and gains the additional +50% whenever the target has Bleed, Hemorrhage, Rupture, or
Venom. The existing log line appears immediately after the triggering attack:
`Bloodhunter — target is bleeding, +50% damage.` Poison from the Venom Rune remains the
separate `poison` effect and is not newly classified as a bleed.

The tracked description-sync source now covers 52 rows (38 deity, 10 weapon, 4 mob),
including explicit Juru Pakal wording. No production SQL was executed.

Validation: combat self-test 400 passed, 0 failed, including an engine-level battle in
which a Swordsman's ordinary Bleed is active on the next Juru Pakal attack and the
Bloodhunter +50% log is emitted.

## Follow-up: complete weapon and armor passive log audit

Timestamp: 2026-07-30 +08:00
Patch name: Complete weapon and armor passive log audit
Commit: pending

The exhaustive 71-key weapon audit and the 20 distinct armor-key audit were rerun
against the real battle engine. Juru Pakal was proved numerically with a fixed damage
roll: neutral dealt 100, Bloodhunter dealt 110 before Bleed, and 160 after ordinary
Bleed became active. The shared modifier lane is additive, so the live totals are
1.10x and 1.60x rather than 1.65x.

Silent persistent and stacking effects now have battle-log coverage. Persistent
bonuses announce once per battle; stack lines appear only when a stack grows; reactive
and chance effects still announce only when they actually fire. Added visibility
covers Katana, the six generic ATK ramps, Egyptian Asa, Vatican Aspis, Dipylon Shield,
Juru Pakal's base 10%, Gram's base pierce, the base lanes of Jarngreipr/Gridr/Alan/
Death Charm/Laevateinn Staff, Harpe, Sword of Damocles, Hephaestus Hammer, Apollo's
Silver Bow, Gungnir, Kalasag, Hoplite Panoply, and Mail of Brokkr. Existing proc,
block, evade, reflect, heal, execute, DOT, and on-hit lines remain conditional.

Validation: `npm.cmd run selftest:full` passed the complete repository chain. Weapon
self-test passed all 71 passives plus `none`; its integration section also forced and
found a visible event for every armor key. Combat self-test passed 400/400, including
the seeded fuzz and determinism contracts. Read-only production preflight completed
with 0 failures and the existing non-TLS database warning. No database write was performed.

## Follow-up: Surt balance, class scaling, and combat audit fixes

Timestamp: 2026-07-31 +08:00
Patch name: Surt balance, class scaling, and combat audit fixes
Commit: included with this handoff entry

Requested balance changes:

- Surt and Echo Surt now add 3% base-ATK Burn per landed hit, cap at 15%, and
  reach the cap on hit five. Duration, refresh behavior, existing-burning +50%
  damage, and the DOT damage formula are unchanged.
- Swordsman, Fighter, Mage, Knight, and Archer now use the approved base/scaling
  table in `src/config/classes.js`, the shared source used by every combat mode.
- Fighter Bash now deals 100% of its triggering hit. Its 25% proc chance,
  one-turn Stun, and Dizzy lifecycle are unchanged.
- Skjaldmaer's 10% full-negation proc now reflects 60% of would-be damage instead
  of 75%. Its ordinary 20% reflect remains unchanged and cannot double-dip.

Audit corrections:

- Deferred combat hooks can declare event priority independently of passive source.
  Damage modifiers remain under their weapon/blessing category while landed status
  applications use the shared status lane. This fixes generic combinations such as
  Pata plus Surt without adding name-based ordering exceptions.
- A lethal Fighter Bash no longer applies or logs Dizzy after the target dies.
- A lethal DOT that expires on the killing tick no longer invokes Tribal Ward,
  revives the target, or emits a post-death heal.
- Thunderbolt and Zeus damage-modifier lines are separated from their status lines
  while preserving their original proc, evasion, and damage behavior.
- Canvas renderers no longer re-quote the complete CSS font fallback stack. Default
  profile/stats rendering now runs glyph diagnostics too, and diagnostics distinguish
  primary-font fallback use from glyphs unsupported by the entire configured stack.

Database and documentation:

- `20260731_01_surt_muspells_flame_balance.sql` is an idempotent transactional
  migration that updates and verifies exactly one Surt roster description. The
  numeric cap is runtime configuration, not a database column.
- The passive ledger and description synchronization sources advertise Surt's
  3%/15% values. A separate idempotent migration records Skjaldmaer's 60% proc
  reflection.
- The combat, combat-log, and font regression suites are explicitly tracked instead
  of being silently excluded by the local self-test ignore rule.

Validation includes exact 3/6/9/12/15 Surt progression and cap retention, all five
class tables, 100% Bash, 60% Skjaldmaer reflection, Pata/Surt ordering, lethal Bash,
lethal expiring DOT plus Tribal Ward, and full-stack font construction.

- Combat self-test: 408 passed, 0 failed.
- Combat-log ordering: 36 passed, 0 failed.
- Font rendering: 30 passed, 0 failed.
- The full repository chain passed through combat, EXP, weapon, bestow, and all
  Genesis suites, then stopped in the ignored local-only requested-patch test on an
  existing Tyrfing ledger/sync wording mismatch already present at `HEAD`. Tyrfing
  was intentionally left unchanged as unrelated. All remaining telemetry, cache,
  skin, Canvas, schema, lifecycle, help, and casino suites passed when run directly.
- `git diff --check` reported no whitespace errors.

## Follow-up: combat rewards, summon display, daily limits, and battle assets

Timestamp: 2026-08-07 +08:00
Patch name: Combat reward and asset rendering follow-up
Implementation commits: `5a7fefe`, `5152268`, and `5407e8c`

The combat reward and summon quality-of-life updates were carried into the
pre-event baseline. The implementation now includes:

- Combat raid quest reward tracking and reward-limit persistence, with the
  production consolidated schema, Credd schema v4, and general schema source
  kept aligned with the migration.
- Raid and quest reward rendering updates, including the daily Sacred Relic
  reward, equipment-tier icons for chest rewards, and the third `Daily Reward
  Limits` embed with belief-shard, Silver Chest, and Gold Chest tracking.
- Summon reward output aligned to the body embed with compact reward rows and
  safe handling for Discord component text-size limits.
- The raid flow returned to its lower-load behavior by removing the daily-limit
  lookup from the post-battle response. Daily tracking is available separately
  through `crd daily limits`.
- Weekly quest footer text was removed while unrelated reward and battle-result
  footers were preserved.
- Battle and avatar asset resolution was updated for the class-specific
  `battle_<class>.png` naming convention, including R2/public asset URL handling
  and the default battle-render fallback.

Validation and deployment notes:

- Focused combat-reward, summon-QOL, battle-render, schema-drift, and Genesis
  avatar self-test coverage was added or updated with the implementation.
- The event migration remains a source-of-truth deployment artifact; no
  production database write is implied by the code or schema changes.
- The pre-event baseline is intended to remain free of the active monthsary
  event changes.

## Follow-up: pre-event class, combat, reward, summon, shop, and boss rotation update

Timestamp: 2026-08-11 +08:00
Patch name: Pre-event gameplay and combat update
Commit: included with this handoff entry

The pre-event baseline now includes the requested gameplay and display updates:

- Summon duplicate rows retain the compact `icon count, tier, deity` format with
  no literal `Essence` label. The invocation summary now counts actual pull
  results by rarity, rather than confusing new-versus-duplicate status with
  Remnant/Awakened categories. Duplicate-compressed body rows still contribute
  their full raw pull quantity.
- Raid Silver and Gold chest drop chances are 20% and 50%. Daily caps remain
  enforced at 20 Silver Chests, 5 Gold Chests, and 10,000 Belief Shards, while
  capped portions are silently omitted and other rewards continue.
- Knight regeneration is 1.5% maximum HP per turn. Fighter attacks gain +50%,
  with additive +50% Bash damage on a successful 30% one-turn Stun proc and a
  one-attempt 15% Dizzy miss check. Archer extra attacks are 35%, capped at two
  attacks through the normal same-turn pipeline without recursion. Swordsman
  ATK stacking now caps at +30%.
- `crd class passives` displays all five current classes from centralized
  configuration. Dedicated Archer, Swordsman, Knight, Mage, and Fighter emoji
  rows are registered in `assets/data/game_items.txt`.
- `crd shop` is grouped as Unlimited, Monthly, Daily, and Weekly, with one
  dynamic reset countdown per limited category and unchanged IDs, prices,
  purchase behavior, and usage caps.
- Natural boss selection preserves the 70%/25%/5% tier weights and uses a
  restart-reconstructable shuffled bag from existing boss history. The former
  `chance(1)` boolean-as-roll bug was corrected. Queued and current direct dev
  spawns remain excluded where existing state can identify them; an old direct,
  non-queued dev spawn cannot be distinguished after `boss_state` is overwritten
  because `boss_attack_log` has no spawn-source field, and no schema change was
  introduced to solve that edge case.

No database table, column, migration, player-data migration, or production SQL
execution was added. Boss rotation reads existing history only.

Validation:

- `npm.cmd run selftest:full` passed, including 433 battle checks, 51 summon-QOL
  checks, class-passives coverage, boss-rotation coverage, and all remaining
  repository suites.
- Golden C1/C2/C3/C4 harnesses passed: 150 battle simulations, 5 renders, 8
  module surfaces, 56 commands, and 32 slash definitions.
- Direct summon validation confirmed a mixed 23 Remnant / 7 Awakened batch
  summarizes to 30 total pulls. `node --check` and `git diff --check` passed.

## Follow-up: daily attendance rewards and consecutive streak milestones

Timestamp: 2026-08-11 +08:00
Patch name: Daily attendance reward and streak update
Commit: included with this handoff entry

The normal 30-day attendance cycle now grants the requested higher Credux and
Belief Shard amounts while retaining the existing Silver/Gold Chest schedule:

- Days 1-6 grant 50,000 Credux and 100 Belief Shards; Day 7 grants 250,000
  and 250; Days 8-13 grant 75,000 and 150; Day 14 grants 400,000 and 350.
- Days 15-20 grant 100,000 Credux and 200 Belief Shards; Day 21 grants
  600,000 and 500; Days 22-27 grant 150,000 and 250.
- Days 28, 29, and 30 grant 750,000/600, 1,000,000/750, and
  1,500,000/1,000 respectively. The complete base cycle totals 6,750,000
  Credux, 7,650 Belief Shards, 24 Silver Chests, and 6 Gold Chests.

The persisted `users.overall_streak` value is now presented and rewarded as the
current consecutive attendance streak. Existing `last_daily_claim_date` checks use
PostgreSQL PHT calendar dates: yesterday advances the streak, an older or missing
date resets it to 1, and a same-day claim remains blocked without another reward or
increment. The rolling monthly reward cycle still wraps after Day 30 and preserves
its existing missed-day reset behavior, but it never determines milestone eligibility.

Streak 15 adds one Boss Treasure Chest. Streak 30 and every further multiple of 15
(45, 60, 75, and onward) add one Boss Golden Chest. Eligibility is calculated from
the newly reached streak, so 14-to-15, 29-to-30, and 44-to-45 are correct. The bonus
chest is granted and logged with the regular reward under the existing row locks and
transaction, remains outside raid daily caps, and becomes earnable again after a
broken streak. Player and dev output now say `Streak`, show the bonus with existing
item emoji definitions, and the active economy, gacha, and inventory documentation
reflects the new values.

No database table, column, migration, schema file, duplicate attendance state, or
production/test database write was added or executed.

Validation:

- `npm.cmd run selftest:daily-attendance` passed exact reward brackets, required
  milestone days, PHT midnight rollover, same-day duplicate protection, missed-day
  reset and milestone re-earning, restart reconstruction, and a 45-claim sequence.
- `npm.cmd run selftest:full` passed the complete repository chain, including 433
  battle checks, schema drift, lifecycle, help (183), casino (187), and all other
  package verification suites.
- Golden C1/C2/C3/C4 harnesses passed separately: 150 battle simulations, 5 renders,
  8 module surfaces, 56 commands, and 32 slash definitions remained byte-identical.
- A rendered Day 15 / Streak 45 card showed the regular Silver Chest plus the
  additional Boss Golden Chest with the registered icon.
- `node --check` passed for the modified JavaScript, and `git diff --check` found no
  whitespace errors; Git emitted only the existing Windows LF-to-CRLF notices.
