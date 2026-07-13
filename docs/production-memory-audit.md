# Production Memory Audit

Date: 2026-07-14

## Outcome

The production growth to roughly 1 to 1.2 GB was reproducible and was primarily native image memory, not JavaScript heap growth. The largest leak was the casino card renderer: it permanently cached decoded 1024x1536 card assets and one 1024x1536 Canvas for every rendered card face.

The application now has explicit entry, byte, or lifecycle bounds for every dynamic image cache and work queue. Request canvases are released immediately after encoding, R2 image bytes are not retained beside their decoded image when disk caching is enabled, and generated output buffers are not reachable after the send path completes.

Local stress tests now settle below the requested 350 MB target:

| Test | Baseline | Warm or final RSS | Forced-GC RSS | Result |
| --- | ---: | ---: | ---: | --- |
| 116 profile and stats images, including queued work | 71 MB | 310 MB idle | 300 MB | Pass; zero generated output buffers reachable |
| All 52 casino card faces | 73 MB | 328 MB | included in final sample | Pass; eight faces and about 1 MB retained |

These tests deliberately exercise far more image work than one to three concurrent users. RSS can remain elevated after a burst because native allocators retain reusable pages, but the retained object graph is bounded.

## Largest Consumers Found

| Rank | Consumer before the fix | Estimated retained memory | Finding and resolution |
| --- | --- | ---: | --- |
| 1 | Casino decoded card source images | 436.2 MB | Removed the private unbounded image cache and routed card assets through the shared 40 MB cache. |
| 2 | Casino composited card-face canvases | 311.8 MB for 52 faces | Faces changed from 1024x1536 to 140x196 and the cache is now eight entries, 4 MB maximum, and 10-minute TTL. The measured retained size is about 1 MB. |
| 3 | Duplicate renderer image caches | Workload dependent | Profile, weapon, quest, bag-local, summon-frame, battle-skin, result-skin, and battle-emoji duplicates were removed or converted to metadata-only caches. |
| 4 | Sharp native cache and parallel workers | About 50 MB cache plus worker scratch space | Sharp is configured for an 8 MB memory cache, zero file cache, 20 items, and one worker. |
| 5 | Casino processed GIF and PNG buffers | Unbounded before | Combined padded-media and reel cache is now 12 entries, 24 MB maximum, and 10-minute TTL. R2 production prewarming is disabled. |
| 6 | Discord message and manager caches | 25 messages per channel plus default manager caches | Messages are limited to five per channel and swept after five minutes. Unused reaction, presence, voice, sticker, event, invite, and similar managers are disabled. Users, members, and emojis are bounded. |
| 7 | Battle and result base canvases | Previously allowed a 48 MB static cache and duplicate decoded skins | Combined configured ceiling is 16 MB with eight entries per side and 10-minute TTL. Skin caches retain metadata promises only. |
| 8 | Boss banners and battle logs | Banner buffers were permanent and cached simulations contained snapshots | Banners are limited to four entries, 8 MB, and 10 minutes. Logs retain only names, winner, seed, and capped event text. |

A single-suit casino reproduction increased RSS by about 231 MB before the fix. Rendering the full deck approached 0.9 GB locally, which explains the observed 1 to 1.2 GB production process after native overhead and other bot state.

## Long-Lived Holder Inventory

### Dynamic caches and queues

| Area | Holders | Current bound and cleanup |
| --- | --- | --- |
| Shared R2 assets | `bufferCache`, `imageCache` | Combined 256 entries, 40 MB minimum and default, 30-minute TTL, proactive expiry sweep, LRU eviction. |
| R2 loads in progress | `bufferInflight`, `imageInflight` | One promise per asset key; every entry is removed in `finally`. |
| R2 availability | `remoteAvailability` | 1,000 entries; negative results expire after 10 minutes. |
| Deterministic canvas URLs | `memory`, `inflight`, `lastTouched` | 5,000 URL entries and 8 MB; dependent touch entries are deleted with URLs; in-flight promises are removed in `finally`; database and R2 objects sweep after 14 days. |
| Profile output URLs | `cache` | 50 entries and 60-second TTL. Stores URLs only, never PNG or WebP buffers. |
| Selection pools | `pools` | 50 entries and 5-minute TTL; expired row arrays are swept during snapshots and access. |
| Mob roster rows | `mobRosterCache` | 32 entries with expiry and proactive snapshot sweep. |
| Profile and stats layouts | two `layoutCache` maps | 64 metadata entries each; no decoded image or Canvas values. |
| Battle and result layouts | `skinCache`, `battleBaseCache`, `resultBaseCache`, warning sets | Eight entries per cache, combined 16 MB canvas ceiling, 10-minute TTL, and 200 warning keys. |
| Battle runtime | `battleFrameCooldowns`, collectors | 5,000 timestamp entries; collectors expire after five minutes and retain prebuilt log pages instead of the full simulation. |
| Bag and battle emoji images | `iconCache` | 256 entries, 4 MB, and 30-minute TTL. Local R2 art uses the shared asset cache. |
| Casino faces | `faceCache`, `bboxCache`, missing-key set | Eight faces, 4 MB, and 10-minute TTL. The bounding-box cache is a WeakMap and cannot keep images alive; missing keys are capped at 200. |
| Casino processed media | `cache`, `stripCache`, `durCache` | Output buffers share a 12-entry, 24 MB, 10-minute bound; durations are capped at 64 small entries. |
| Casino sessions | blackjack and crash session maps and timers | One entry per active user; all reply, render, timeout, settlement, and error exits now clear the timer and map entry. |
| Boss runtime | live-message, log, spawn, refresh, redirect, URL, chest, development, banner, lore, and lookup holders | Runtime state is scoped to a guild or active spawn and purged on spawn replacement, completion, or guild removal. Logs cap attackers at 50 and events at 20 each. Refreshes coalesce to one active job per guild. Banner bounds are listed above. |
| Middleware | cooldown and activity-write maps | 10,000 entries each, with time-based sweep and insertion-order eviction. |
| Guild configuration | `cache` | One small record per configured guild; deleted on `guildDelete`. See the fixed-cardinality exceptions below. |
| Image work | queue array and active-job map | One active renderer by default and at most 16 queued closures. Jobs are removed in `finally`, with oldest-job ages logged. |
| Discord.js | manager caches | Five messages per channel; 100 members per guild; 200 users; 500 emojis per guild; unused managers set to zero; five-minute message sweeper. |
| Memory instrumentation | source registry map | One callback per loaded application module; callbacks expose counts only and never cache contents. |

### Holders without TTL or numeric maximum

The remaining holders without a TTL or numeric maximum have fixed source cardinality or explicit lifecycle ownership; none holds generated media:

- Slash-command definitions, command lookup maps, configuration sets, rarity sets, emoji registry indexes, and other module constants are derived from finite source files or code.
- Global font registrations live for the process lifetime by design and are shared by every renderer.
- Deity and glossary mythology arrays, supporter schema sets, and boss lore maps are immutable snapshots of small database or text-file vocabularies.
- Guild configuration contains one small object per configured server and is removed when the bot leaves a guild. Its size is logged as `guild.config`.
- Boss live-message, current-spawn, chest, development-spawn, redirect, and status-URL records are keyed by an active guild or spawn and are purged through the boss lifecycle and `guildDelete`.
- Discord guild, channel, role, and application metadata are library-owned identity caches needed for bot operation. Their counts are included in every memory snapshot.
- PostgreSQL owns a pool of at most ten clients; total, idle, and waiting counts are logged.
- Request-local Maps, Sets, Arrays, Buffers, Images, and Canvases in battle simulation, command assembly, and rendering functions are not reachable after their request or collector lifecycle ends.

## Renderer and Image-Loader Audit

| Renderer or loader | Retained state after completion |
| --- | --- |
| Battle and raid frames | Only bounded static base canvases and shared asset images. Every generated frame canvas is resized to 1x1 immediately after encoding. |
| Battle result | Only bounded static base canvases and layout metadata. Generated output is request-local. |
| Profile and stats | Layout JSON metadata and shared asset images only. Templates are no longer duplicated in renderer-local caches. Generated canvases are released after encoding. |
| Equipment and weapon result | Shared asset images only. The old renderer-local image caches were removed. |
| Portrait and deity views | Shared asset images only. The equipped-deity grid releases its canvas in `finally` and nulls its temporary PNG after R2 upload or Discord fallback construction. |
| Summon | Shared asset images only. The formerly permanent frame image is no longer held separately. All generated grids and cards release their canvases after encoding. |
| Quest and bag | Quest/local item images use the shared cache; Discord emoji art uses the bounded 4 MB icon cache. Output canvases are released. |
| Boss | Shared source image cache, capped banner buffers, and request-local status canvases. Full battle snapshots are no longer cached. |
| Casino | Shared source image cache, eight small face canvases, bounded processed-media buffers, and request-local panel canvases. Alpha-scan canvases are explicitly released. |
| Avatar and remote URL loaders | Download buffers are local to the load promise and are not inserted into a renderer cache. |
| Sharp output optimization | Temporary PNG, JPEG, WebP, GIF, raw-frame, and composite buffers remain inside the active operation; Sharp's own cache and concurrency are bounded. |

## R2 Buffer Lifecycle

R2 source downloads pass through a single shared loader. Concurrent requests for the same key share one in-flight promise. The in-flight entry is deleted in `finally`, including error paths.

When a remote image is decoded, the cache stores the decoded Image under the combined 40 MB ceiling. If disk caching is enabled, the compressed download Buffer is removed from the memory cache immediately, because the disk copy can satisfy a later decode. Callers that explicitly require file bytes may cache those bytes, but they share the same entry, byte, and TTL ceiling.

The deterministic-render cache uploads a generated buffer to R2, stores only its URL in memory and PostgreSQL, then clears its local image reference. Profile output caching also stores only URLs. The two intentional generated-buffer caches are casino processed media at 24 MB and boss banners at 8 MB.

## Scheduler, Listener, Collector, and Queue Audit

- Battle reaper, boss tick, reset cron, and season cron now return stop functions. Startup records them and graceful shutdown invokes every stop function.
- Casino and canvas sweep intervals, resource instrumentation, schedulers, Discord, and PostgreSQL are all stopped or drained during shutdown.
- Boss image refreshes cannot overlap for one guild. Requests arriving during a render set one coalesced rerun instead of creating more timers or promises.
- Blackjack and crash sessions are removed on initial reply failure, render failure, timeout, settlement, and final-render failure.
- Bestow and duel collectors have fixed 60-second windows. Battle collectors have fixed five-minute windows. Collector counts are instrumented.
- Battle collectors no longer close over the full simulation object; they retain the much smaller prebuilt log pages.
- The image queue rejects beyond 16 waiting jobs and releases active-job records in `finally`.
- Discord and process listeners are installed once at startup. Their total count and active Node resource types are logged.

## Generated Buffer Garbage Collection Verification

Every request-local Canvas output path uses a shared encoder that performs `toBuffer` and then immediately resizes the Canvas to 1x1 in `finally`. This releases the large native surface without waiting for V8 to notice heap pressure.

PNG, JPEG, and WebP output buffers remain referenced until the Discord reply/edit or R2 upload promise resolves. Commands do not put those buffers into a module-global collection. Discord message objects retain attachment metadata and URLs rather than the original upload buffer.

The memory self-test creates weak references for every generated profile and stats output. After 116 outputs and forced collection, zero generated buffers remained reachable. `arrayBuffers` can remain elevated because decoded native image objects and allocator pools are intentionally warm; it is not proof that the generated upload Buffer objects are reachable.

## Instrumentation

`RESOURCE_LOGS=true` starts a snapshot immediately and then every 600,000 ms by default. Each `[resource]` record includes:

- `heapUsed`, `heapTotal`, `rss`, `external`, and `arrayBuffers` in MB.
- Native gap, RSS delta, process peak, CPU, uptime, PostgreSQL pool counts, image queue state, active Node resource types, and Discord cache and listener counts.
- Entry, byte, maximum, TTL, active-job, and oldest-job counters for every registered cache.

Important cache names include `assets.decoded-and-buffers`, `assets.inflight`, `assets.remote-availability`, `battle.layout`, `battle.results-layout`, `battle.runtime`, `boss.runtime`, `casino.card-faces`, `casino.processed-media`, `casino.blackjack-sessions`, `casino.crash-sessions`, `canvas.urls`, `canvas.inflight`, `images.discord-emojis`, `images.work-queue`, `layouts.profile`, `layouts.stats`, `middleware.runtime`, `native.canvas`, `native.sharp`, `profile.urls`, and the database snapshot caches.

Warnings are emitted once when RSS crosses 450 MB and 600 MB and reset after RSS falls below 450 MB.

## Recommended Production Settings

Use the values in `.env.example`, especially:

```dotenv
RESOURCE_LOGS=true
RESOURCE_LOG_INTERVAL_MS=600000
IMAGE_RENDER_CONCURRENCY=1
IMAGE_RENDER_QUEUE_MAX=16
SHARP_CACHE_MEMORY_MB=8
SHARP_CACHE_FILES=0
SHARP_CACHE_ITEMS=20
SHARP_CONCURRENCY=1
ASSET_DISK_CACHE_ENABLED=true
ASSET_MEMORY_CACHE_MAX_MB=40
ASSET_CACHE_TTL_MS=1800000
BATTLE_STATIC_LAYER_CACHE_MAX=8
BATTLE_RENDER_CACHE_MAX_MB=16
CASINO_CARD_FACE_CACHE_MAX=8
CASINO_CARD_FACE_CACHE_MAX_MB=4
CASINO_MEDIA_CACHE_MAX=12
CASINO_MEDIA_CACHE_MAX_MB=24
BOSS_BANNER_CACHE_MAX=4
BOSS_BANNER_CACHE_MAX_MB=8
EMOJI_IMAGE_CACHE_MAX=256
EMOJI_IMAGE_CACHE_MAX_MB=4
```

Do not lower the decoded asset cache to 24 MB. Its common profile and stats working set is about 34 to 36 MB, so a 24 MB cap continuously evicts and re-decodes native images. Stress runs with that setting briefly reached about 1.1 to 1.25 GB. The loader now treats values below 40 MB as invalid and falls back to 40 MB, but the production variable should still be corrected for clarity.

After deployment, restart the process and review at least six 10-minute snapshots. With one to three users, the expected steady RSS is below 350 MB. If it remains above 350 MB while every logged cache is within bounds, compare `external`, `arrayBuffers`, and `nativeGap`: a rising `external` or `arrayBuffers` value points to image work, while only a rising native gap points to allocator or library-native memory that needs a heap/native profile on the production runtime.

## Validation

- `npm run selftest:memory`: passed at 310 MB idle RSS, 300 MB after forced GC, and zero reachable generated buffers.
- `npm run selftest:memory:casino`: passed at 328 MB final RSS, eight cached faces, about 1 MB of face canvases, and 36 MB of shared assets.
- `npm run selftest:full`: 186 battle tests, requested-patch test, schema drift test, 181 help and command tests, and 171 casino tests passed with zero failures.
- JavaScript syntax checks and `git diff --check`: passed.

The memory changes do not alter commands, combat decisions, rewards, odds, or other gameplay behavior.
