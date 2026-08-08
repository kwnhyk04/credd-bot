# Railway Memory and Egress Audit

Date: 2026-07-16

## Conclusion

The roughly 800 MB Railway plateau was not a V8 heap leak. A controlled Canvas reproduction produced the same shape: RSS climbed from 67 MB to 396 MB while `heapUsed` stayed near 5 MB, `external` near 2 MB, and `arrayBuffers` near zero. Resizing completed canvases did not return the memory. Calling the installed `@napi-rs/canvas` runtime's `clearAllCache()` returned RSS to 68 MB. The retained high-water was therefore Skia/native Canvas cache memory that V8 could neither report as heap nor reclaim by collecting JavaScript wrappers.

Full-resolution casino source art and the profile/stats asset pipeline were the largest amplifiers of that native high-water. The live JavaScript caches were bounded and substantially smaller than RSS, but they repeatedly asked Skia and Sharp to decode large source images. The fixes now track and explicitly release every application Canvas, clear the process-wide native Canvas cache after one second of render quiescence, and resize casino source art before Canvas decodes it.

The recurring egress was dominated by generated image output, not R2 downloads. A cold raid legitimately produces its original opening battle frame, final battle frame, and separate result frame. Profile/stats cache misses and live boss status refreshes also PUT generated images to R2 or upload a Discord attachment fallback. R2 GET response bodies principally contribute ingress, which is consistent with Railway showing egress much higher than ingress.

The final no-forced-GC integrated stress test settles at 143 MB RSS after all 52 card faces plus 20 profile and 20 stats renders. The focused profile/stats stress test settles at 295 MB (311 MB burst peak). Both are below the requested 400 MB limit. A production claim still requires post-deploy snapshots because the Railway screenshot alone cannot apportion Discord gateway, PostgreSQL TLS, and allocator memory, but the code-level mechanism has been reproduced and removed.

## Top Three Memory Consumers

| Rank | Consumer | Measured evidence | Code and resolution |
| --- | --- | --- | --- |
| 1 | Skia's process-wide native Canvas cache/high-water | 100 sequential 1536x1024 canvases: RSS 67→396 MB with flat V8/external metrics; `clearAllCache()` returned it to 68 MB. With the fix, the final run starts at 66 MB, bursts to 82 MB, then settles at 70 MB without forced GC. | Canvas lifecycle tracking is in `src/utils/imageRuntime.js:20-180`; explicit surface release is in `src/utils/canvasEncode.js:23-35`; the quiescent native-cache flush is in `src/utils/imageRuntime.js:216-247`. |
| 2 | Profile/stats decoded assets plus Sharp sanitation/optimization scratch | Before the native-cache fix, the profile/stats stress run settled around 303–317 MB with 175–188 MB external and about 145 MB ArrayBuffers while the logical asset cache held about 34 MB. WeakRefs showed zero generated output buffers retained. The final run settles at 295 MB and zero generated outputs reachable. | The shared caches/coalesced promises are in `src/utils/assets.js:65-69`, `src/utils/assets.js:953-984`, and `src/utils/assets.js:1084-1123`; Sharp is bounded in `src/utils/imageRuntime.js:184-208`. |
| 3 | Casino full-resolution card backgrounds/glyphs decoded to draw 140x196 faces | Before source preprocessing, the all-card test settled around 319 MB despite only eight approximately 1 MB face canvases and about 39 MB of reported assets. After preprocessing, the same test settles at 130 MB. | Sources are now Lanczos-downsampled/trimmed before Canvas decode in `src/casino/casinoCanvas.js:54-90`; faces remain exact 140x196 in `src/casino/casinoCanvas.js:175-210`; the lease-aware eight-entry/4 MB cache is in `src/casino/casinoCanvas.js:214-327`. |

Material but bounded secondary consumers are the combined 40 MB shared asset cache (`src/utils/assets.js:26-39`), battle/result static bases (16 MB combined by default in `src/engine/battleLayoutRenderer.js:45-54` and `src/engine/resultLayoutRenderer.js:39-48`), casino processed media (24 MB in `src/casino/imagePad.js:25-34`), boss banners (8 MB in `src/engine/bossSystem.js:383-392`), deterministic-render URL metadata (8 MB in `src/utils/canvasCache.js:39-46`), and Discord emoji images (4 MB in `src/engine/renderBagItems.js:66-73`). These limits are ceilings, not a claim that all caches are simultaneously full.

## Top Three Egress-Producing Paths

| Rank | Path before the fix | Measurement and cause | Focused fix |
| --- | --- | --- | --- |
| 1 | Raid/battle delivery in `src/engine/battleRender.js` | A measured cold supporter raid sent 402,346 bytes across start, final, and result images. A 17-skin output survey had median battle frames of 172,268 bytes and result frames of 157,338 bytes, or roughly 502 KB for two battle frames plus one result; the upper survey cases were about 713 KB. Two nearby raids therefore explain 1.0–1.4 MB and upper cases approach the observed 1.7 MB spikes. | The original opening Canvas, final Canvas, and separate raid result Canvas are preserved in `src/engine/battleRender.js:908-1023`. Each deterministic state is rendered once, optimized as WebP, cached by URL, fully attributed in telemetry, and released immediately after delivery. No per-turn Discord frames exist between the opening and final edits. |
| 2 | Profile/stats deterministic-render cache misses | Measured first-state outputs were 294,738 bytes for profile and 293,112 bytes for stats. Each unique player-state signature legitimately renders once and PUTs once to R2; repeats use a URL. The miss path is `src/utils/canvasCache.js:123-227`, called by `src/commands/rpg/profile.js:255-286` and `src/commands/rpg/stats.js:283-301`. | Concurrent identical states already share `inflight`; output buffers are nulled after upload and only URLs remain. New telemetry now distinguishes misses, R2 bytes, attachment fallbacks, and duplicates, so invalid signatures or repeated misses are visible. Final image dimensions and quality are unchanged. |
| 3 | Live boss HP/status refreshes | Every surviving attack previously regenerated a status image and edited/reposted a message; frequency, rather than a single large file, made this the largest background-like image path. Spawn, scheduler reconciliation, retry, and final refreshes shared the same builder. | The required post-attack Canvas remains enabled, but nearby attacks now coalesce into one latest-HP refresh per 15-second window in `src/engine/bossSystem.js:1111-1248`. Refreshes are lifecycle-guarded, and final defeat waits for an in-flight progress edit at `src/engine/bossSystem.js:1488`. Existing local banners are retained by ID; recovery attaches one only when no reusable banner exists. |

Summon was a smaller confirmed duplicate path: a local suspense GIF could be attached initially and then reattached during the final edit. The final edit now retains the original Discord attachment by ID and reuses its CDN URL; remote R2 animations are also reused by URL. Both remain visible without a second upload.

## Egress Questions Resolved

- Battle delivery preserves its original opening Canvas and final Canvas. Raid completion also preserves the separate result Canvas. The engine does not send a Discord edit for each internal combat turn, so no additional turn-by-turn images were introduced.
- Existing battle messages are still edited without intermediate image attachments. A surviving boss attack intentionally replaces the status attachment with a newly rendered latest-HP Canvas after the debounce window; simultaneous attacks share that refresh. Its static banner is retained by attachment ID or remote URL and is not re-uploaded.
- Auto-raid is database/timer and component text only (`src/commands/rpg/autoRaid.js:109-205`); it does not call a renderer. Boss scheduler reconciliation may intentionally rebuild the current status Canvas when recovering a missing live message. Spawn and final defeat also intentionally produce one status image; after restart/deletion, recovery may upload one local static banner if no R2 or retained Discord URL exists.
- Identical deterministic renders use the in-memory/DB/R2 URL cache. Static R2 assets are linked directly when available. Concurrent source loads and deterministic renders are coalesced.
- A raid generates each of its original three visual states once: opening battle, final battle, and result panel. No personalized final Buffer is stored in a module cache.
- Permission/recovery paths preserve Canvas presentation. R2 URL payloads retry without Railway uploading image bytes; a rare direct-attachment failure may repeat an attempted upload so the command does not degrade to text-only, and telemetry identifies that retry.
- Prefix and slash cannot both dispatch one action. `index.js:211-216` routes chat-input interactions to slash and everything else to component handling; prefix commands originate only from `messageCreate` at `index.js:194-199`.

## Renderer and Retention Trace

| Area | Request-local objects | Long-lived objects and cleanup |
| --- | --- | --- |
| Raid, duel, ranked | Resolved simulation, snapshots, fighter arrays, render Canvas, encoded/optimized Buffer, attachment wrapper, cache promise | Raid/duel/ranked use the same battle renderer. Static skin/base caches are bounded. The final Buffer is released after R2/Discord completion. The five-minute log collector retains prepared text pages, not the full simulation or render result (`src/engine/battleRender.js:1037-1066`). |
| Auto-raid | Query rows and component builders | One DB row per active player; no Canvas, Image, render Buffer, image queue job, or attachment. |
| Boss | Status/banner Canvas and Buffer, component payload, reward rows | Guild/spawn Maps hold message IDs, compact logs, timers, and current state (`src/engine/bossSystem.js:112-128`). Refresh jobs coalesce to one timer/job per guild. Banner cache is byte/entry/TTL bounded; status output is not retained. Guild/spawn cleanup purges lifecycle-owned Maps. |
| Profile and stats | Assembly object, avatar/template Images, output Canvas, PNG/WebP Buffer, R2 PUT promise | Layout Maps contain at most 64 JSON metadata entries each. Source images share the 40 MB asset cache. Profile URL cache and deterministic canvas cache store URLs/signatures only, never personalized render Buffers. |
| Equipment, weapon, deity, quest, bag | Source Images, output Canvas/Buffer, attachment or R2 result | Source art uses the shared loader. Emoji art has a 256-entry/4 MB cache with an in-flight Map. Deterministic results store URLs. Deity's grid Canvas is explicitly released in `finally` (`src/commands/rpg/deity.js:1126-1239`). |
| Avatar and portrait | Download Buffer/Image, candidate arrays, probe Canvas, render Canvas/Buffer | Avatar downloads use bounded memory/disk loading; concurrent requests coalesce. Portrait's probe and output canvases are explicitly released (`src/engine/renderPortraitCard.js:194-295`). No avatar render result cache stores Buffers. |
| Summon | Result grouping Map, optional tester animation, result Canvas/Buffer, attachments | Grouping is request-local. Only tester sets may use full-size media: remote media stays URL-only and local media uploads once for suspense. The final edit omits it and clears local attachments. Every non-tester skin is header-emoji-only, so its source image is neither fetched nor uploaded. No personalized result image is retained. |
| Chests and runes | DB rows, component builders, small icon Images where rendered | Presentation is primarily components/text. Any item art flows through the same asset/emoji bounds; no independent unbounded image cache was found. |
| Casino | Preprocessed background/glyph Buffers and Images, face leases, strip/result Canvas/Buffer | Faces are eight entries/4 MB/10 minutes and use deferred release while borrowed. Processed GIF/PNG media is 12 entries/24 MB/10 minutes. Blackjack/crash session Maps and timers are cleared on settlement, timeout, send failure, and recovery. |
| R2 assets | Fetch `Response`, compressed Buffer, Sharp decode/sanitize Buffer, Image, in-flight promise | Buffer and Image caches share 256 entries/40 MB/30 minutes. In-flight entries are removed in `finally`; failed/consumed response bodies are canceled; disk cache is bounded separately. Negative availability/missing maps are bounded and expire. |

Every application `createCanvas()` site was checked. Request canvases finish through `encodeCanvas()`/`encodeOpaqueCanvas()` or an explicit `releaseCanvas()`; battle/result/face canvases intentionally retained in bounded caches are released on eviction. The runtime tracker is installed before renderer imports in `index.js:3-4`, so production counts include every Canvas even where a focused test imports a renderer directly.

Generated attachment Buffers remain alive only until the awaited R2 PUT or Discord REST request resolves. Discord attachment attribution uses a `WeakMap`, so instrumentation does not extend Buffer lifetime. Duplicate detection stores only a bounded 24-hex SHA-256 prefix, never image bytes or raw IDs.

## Native Library Findings

- `@napi-rs/canvas`/Skia owns memory outside V8's heap, `external`, and `arrayBuffers`; this is why `rss - heapTotal - external` was large. The audit labels this subtraction a native-gap estimate, not exact allocator accounting.
- `clearAllCache()` is used only as an idle native-cache release after application canvases have already been explicitly disposed. It is not forced V8 garbage collection and is not the primary lifecycle mechanism.
- Sharp is configured at runtime for an 8 MB memory cache, zero file cache, 20 items, and concurrency one. Its current cache, queue, counters, and concurrency are included in resource snapshots.
- Render concurrency defaults to one with 16 queued closures. Queue and active-job entries are removed in `finally`.
- Asset Image/Buffer loaders have explicit LRU/TTL/byte bounds and separate in-flight coalescing. No uncontrolled remote `loadImage(url)` path was found for managed R2 art.

## Production Telemetry

`RESOURCE_LOGS` defaults on. `src/utils/resourceMonitor.js:27-35` emits immediately and every five minutes; an older larger interval is clamped to 300,000 ms and diagnostic overrides cannot go below 60,000 ms. Each `[resource]` record contains:

- raw `process.memoryUsage()` bytes plus MB summaries for RSS, heap, external, and ArrayBuffers;
- V8 heap statistics and every heap-space statistic;
- every registered memory cache's entries, reported/estimated bytes, limits, and TTL where available;
- disk-cache files and bytes through the asset stats;
- active/peak Canvas counts, active/peak pixel bytes, explicit/finalized releases, and native-cache clears;
- Sharp cache/queue/counters/concurrency;
- active/queued render jobs and oldest ages;
- active battles, raids, collectors, boss refreshes, timers, PostgreSQL pool/socket counters, Discord manager counts, and active Node resource types;
- interval and cumulative R2 GET/HEAD requests/download bytes, R2 PUT bytes, and Discord attachment attempts/confirmed bytes grouped by command and phase.

Every queued render emits `[renderer-memory]` before/after/delta values for RSS, heap, external, ArrayBuffers, V8 physical/malloced/external memory, and the native-gap estimate. Every raw Canvas lifecycle emits the same prefix with allocation, release, and full-lifetime deltas plus dimensions and a sanitized renderer callsite. Together they bracket cache-disabled/direct-attachment fallbacks as well as normal queued paths. Events include command, phase, surface, and anonymized user/request correlation.

Every actual Discord REST attachment attempt emits one `[discord-upload]` event from `index.js:109`, implemented in `src/utils/networkTelemetry.js:320-400`. Fields include command, sanitized filename, bytes, upload index/count, per-process salted user hash, hashed interaction/message correlation, surface, initial/intermediate/final/background phase, sanitized route, method, retry count, HTTP status, success, and bounded duplicate fingerprint. The REST listener also catches untagged attachment paths, classifying them by active command and filename.

## Validation

| Test | Result |
| --- | --- |
| `npm run benchmark:canvas-memory` | 100 large canvases: 63–66 MB baseline, 79–82 MB burst, 67–70 MB after 1.5 seconds; no forced GC; zero active canvases and one native-cache clear. |
| `npm run selftest:memory` | 68 MB baseline; 311 MB burst peak; 295 MB steady after sequential/queued profile/stats work; 288 MB diagnostic forced-GC; zero reachable generated Buffers. |
| `npm run selftest:memory:casino` | 71 MB baseline; 130 MB final; external 43 MB; ArrayBuffers 39 MB; eight face entries/about 1 MB; shared assets 39 MB. |
| `npm run selftest:memory:integrated` | No forced GC. 70 MB baseline; 143 MB after all 52 faces; 143 MB idle after 20 profile + 20 stats renders; external 2 MB; ArrayBuffers 0 MB. Target: under 400 MB. |
| `npm run selftest:full` | 201/201 battle, requested-patch, telemetry, asset-cache, R2-skin, Canvas, schema, 181/181 help, and 171/171 casino checks passed. |
| `git diff --check` | Passed. |

The tests preserve renderer dimensions, card glyph bounds, image signatures, R2-only skin behavior, remote summon animation behavior, boss/battle attachment phases, and attachment retry behavior. No combat decisions, rewards, odds, cooldowns, or database schema were changed.

## Post-Deploy Acceptance

Restart the Railway process so the old process's native high-water cannot carry into the new deployment. Then retain at least six consecutive five-minute `[resource]` snapshots during representative light use.

Acceptance criteria:

1. idle/light-use RSS remains below 400 MB after native-cache quiescence;
2. `native.canvas.activeCanvases` returns to the bounded static-cache baseline and `activePixelBytes` does not grow monotonically;
3. queue, collector, battle, boss-refresh, and in-flight counters return to zero after their documented lifetimes;
4. `discordAttachmentsByCommandPhase` has zero intermediate `battle_frame` bytes; `boss_status` progress bytes occur at most once per completed coalesced refresh window (plus bounded failed REST attempts), and a `boss_banner` appears only once when recovering a missing local live message;
5. one successful raid correlation has at most one opening battle image, one final battle image, and one result image upload/PUT; extra attempts must correspond to a logged Discord failure/recovery;
6. R2/Discord duplicate fingerprints do not repeatedly appear for the same command/state;
7. cache entries/bytes remain within logged ceilings.

If deployed RSS still exceeds 400 MB while active Canvas pixels, external, ArrayBuffers, caches, and active work are low and stable, capture a native allocator profile on the Railway Linux build. That residual would be outside the application-owned object graph; the new telemetry now supplies the evidence needed to distinguish it.
