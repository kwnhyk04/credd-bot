# Production Memory Follow-up — 2026-07-17

Follow-up to `docs/production-memory-audit.md` (2026-07-16). Context: Railway RSS
still reports 670–850 MB with 1–5 concurrent users **after** the 2026-07-16
audit build was deployed. This document records the remaining code fixes shipped
today and the evidence-gated procedure for the environment-level investigation.

**Production root cause status: UNDETERMINED pending production telemetry.**
No subsystem is claimed as the production root cause in this document.

## Evidence classification

### Confirmed code defects (fixed this session)

1. **`src/utils/canvasCache.js` `lastTouched` Map was unbounded.** `touch()`
   inserted a timestamp for every cache key (including DB hits), but deletion
   only happened via `forgetMemory()` for keys present in the `memory` Map.
   Keys touched from DB hits, then never memory-cached (or evicted), leaked
   ~200 B each forever. Small, real, could not alone explain 670–850 MB.
2. **Casino stateful wraps retained the full Discord `Message` object**
   (`blackjack.js`, `crash.js`) for the session lifetime (≤ ~60 s bounded by
   auto-timeout). Retention reduction, not a leak.
3. **Schedulers had no internal double-start guard** (`battleReaper`,
   `bossScheduler`, `resetScheduler`, `seasonScheduler`). Latent only — each is
   called exactly once from `client.once('ready')` — but a future re-init path
   would have leaked intervals silently.

### Evidence-supported hypotheses (local measurements, NOT production-confirmed)

- Skia/native canvas memory dominated RSS-minus-heap **locally** (2026-07-16
  audit: RSS 67→396 MB with flat heap; `clearAllCache()` returned it to 68 MB).
  Fixes landed. Whether the production native gap now plateaus or grows is
  unknown without logs.
- **RESOLVED (2026-07-18, commit 2b3fed4): the soak failure below was a
  measurement race, not retention.** Isolation proved profile-only, stats-only,
  and pair workloads all recover to 136–161 MB / external 2 MB; a verbatim soak
  replica showed the 505 MB / 365 MB plateau at exactly 1 s idle collapsing to
  137 MB / 2 MB by 2.5 s with no forced GC and 0/118 generated buffers
  reachable (quiescent native-cache clear fires at 1 s; V8 external-pressure GC
  collects wrappers just after idle). `scripts/memory-selftest.js` now
  settle-polls (500 ms, 15 s cap, unchanged 350 MB target); 3/3 runs pass at
  136–137 MB steady. This removes profile/stats retention as a production
  lead — the original entry is kept below for the audit trail.
- **SUPERSEDED (2026-07-18): the focused profile/stats soak no longer reproduces the
  audit's 295 MB settle.** `npm run selftest:memory` idles at 506–512 MB with
  V8 `external` pinned at 360–365 MB (arrayBuffers 0) after the 100-sequential
  + 16-queued-concurrent phases. Verified identical at the current working
  tree, at main HEAD, at d8bfd15, and at the audit-fix commit `f3fc615`
  itself; the selftest script is unchanged since `f3fc615`; sharp 0.35.3
  (installed 2026-07-02) and @napi-rs/canvas 1.0.0 (2026-06-10) predate the
  audit. Therefore this is NOT a post-audit code regression and NOT caused by
  this session's changes — either the profile/stats pipeline pins
  canvas-registered external memory under heavy queued load, or the audit's
  295 MB was measured under different local conditions. `selftest:memory:casino`
  (134 MB) and `selftest:memory:integrated` (165 MB idle, external 15 MB) still
  pass near documented values, so release does occur under lighter workloads.
  This local idle signature (~512 MB) parallels the production 670–850 MB
  residual, making it the current top lead. Proposed investigation (not
  implemented, per scope instruction): rerun the soak with
  `COMMAND_MEMORY_LOGS=true`, correlate canvas-lifecycle explicit/finalized
  releases and quiescent `clearAllCache` flush counts in the failing phases,
  add a diagnostic forced-GC phase to separate "wrappers not collected" from
  "native memory truly retained", and audit `canvasEncode` release paths under
  queued-concurrent load.

### Unverified environment-specific explanations (no action until threshold met)

- glibc malloc arena retention on Railway's many-core hosts.
- V8 heap self-sizing against host RAM (no `--max-old-space-size` set; the repo
  has no Dockerfile/nixpacks/railway config — pure nixpacks defaults).
- Higher library baseline on the production build than locally.

## Changes shipped (each in its own commit; `git revert <sha>` to roll back)

| Change | File(s) | Behavior impact |
| --- | --- | --- |
| `lastTouched` stale prune + hard cap (`MEMORY_MAX`=5000); unconditional delete in `forgetMemory` | `src/utils/canvasCache.js` | None. A pruned stale timestamp is semantically identical to absence; hard-cap eviction of a fresh entry only allows one extra `last_used_at` DB touch. The canvas URL cache itself is untouched. |
| Restart-safe scheduler guards (one timer, one stable stop fn; stop idempotent; start-after-stop works) | `src/schedulers/battleReaper.js`, `bossScheduler.js`, `resetScheduler.js`, `seasonScheduler.js` | None. Same start call sites, same schedule timing, same stop-fn shape returned to `index.js`. |
| Casino wrap slim: store `channel` + `messageId` instead of full `Message`; timeout edit via `channel.messages.edit(id, payload)` | `src/commands/casino/blackjack.js`, `crash.js` | None. Same REST route (PATCH /channels/:id/messages/:id), byte-identical payload, same rules/payouts/cooldowns/messages. |
| Telemetry sub-gates + `heapLimit` in `[resource]` summary/details | `src/utils/runtimeLogs.js`, `resourceMonitor.js`, `imageRuntime.js`, `imageWorkQueue.js`, `.env.example` | Log-only. All sub-gates default to the `RESOURCE_LOGS` master gate → identical output unless explicitly disabled. |
| Log-analysis helper | `scripts/analyze-resource-logs.js` (new) | None (offline tool). |
| Regression selftest | `scripts/lifecycle-guard-selftest.js` (new), wired into `selftest:full` as `selftest:lifecycle` | None (test only). |

## Telemetry environment variables

| Var | Default | Meaning |
| --- | --- | --- |
| `RESOURCE_LOGS` | `true` | Master gate: 5-min `[resource]` snapshots + renderer telemetry. |
| `RESOURCE_LOG_INTERVAL_MS` | `300000` | Snapshot cadence (clamped 60 s–300 s). |
| `COMMAND_MEMORY_LOGS` | falls back to `RESOURCE_LOGS` | `[renderer-memory]` per-render/canvas lifecycle deltas. |
| `CACHE_METRICS_LOGS` | falls back to `RESOURCE_LOGS` | `caches`/`cacheEstimates` blocks inside `[resource]` details. |
| `NETWORK_USAGE_LOGS` | falls back to `RESOURCE_LOGS` | `network`/`postgresNetwork` blocks inside `[resource]` details. |

To quiet verbose telemetry after validation: set `COMMAND_MEMORY_LOGS=false`
first (highest volume), then optionally the other two. Keep `RESOURCE_LOGS=true`
until the RSS question is settled.

## How to read the logs

- `[resource] ... details={...}` — every 5 min. Key summary fields (MB): `rss`,
  `heapUsed`, `heapTotal`, `heapLimit` (new: V8 self-sized ceiling), `external`,
  `arrayBuffers`, `nativeGap` (= rss − heapTotal − external, native estimate).
- `[renderer-memory]` — before/after/delta per queued render and per canvas
  lifecycle.
- `[discord-upload]` — one event per actual Discord attachment upload with
  command, phase, bytes, retry, duplicate fingerprint.
- Digest a log capture with:
  `railway logs | node scripts/analyze-resource-logs.js` (or pass a file path).
  The script prints a table + trend verdict and states which experiment
  threshold (below) is met, if any.

## Environment experiments — DOCUMENTED ONLY, NOT APPLIED

Decision procedure: collect ≥ 24 h of `[resource]` snapshots on the deployed
build, run `scripts/analyze-resource-logs.js`, then apply AT MOST ONE change,
observe 24 h, and only then consider the next.

1. **`MALLOC_ARENA_MAX=2`** (Railway env var). Threshold: `nativeGap` is the
   dominant term (> 50 % of RSS) AND plateaus after render bursts (not
   monotonic) AND canvas/cache counters stay near baseline. Rollback: remove
   the variable.
2. **`NODE_OPTIONS=--max-old-space-size=512`**. Threshold: telemetry shows
   excessive heap reservation — `heapTotal` ≫ `heapUsed` (e.g. > 250 MB total
   with < 120 MB used) AND `heapLimit` shows multi-GB self-sizing. Start at
   512 MB; consider 384 MB only if measured production heap peaks prove
   sufficient margin. Rollback: remove the variable.
3. **jemalloc via `LD_PRELOAD`** (needs nixpacks.toml/Dockerfile — larger
   change). Threshold: experiment 1's threshold was met, applied, observed
   ≥ 24 h, and residual native gap remains > 200 MB.
4. **If `nativeGap` GROWS monotonically with flat cache/canvas counters** →
   potential new code-level native leak: correlate with `[renderer-memory]`
   bursts and report; do NOT apply env experiments.

Honest floor (unverified estimate): node + discord.js + @napi-rs/canvas +
sharp + pg TLS typically idles at ~150–250 MB RSS. The 300–450 MB target's
feasibility depends on which hypothesis the telemetry confirms.

## Validation results (2026-07-18)

| Check | Result |
| --- | --- |
| `selftest:lifecycle` (new) | 17/17 passed |
| `selftest:full` | exit 0, zero failures (help 183/183, casino 182/182, schema pass) |
| `selftest:memory:casino` | passed — 134 MB final (audit table: 130 MB) |
| `selftest:memory:integrated` | passed — 165 MB idle, external 15 MB (audit table: 143 MB; under 400 MB target) |
| `preflight` | 0 failures, 1 pre-existing warning |
| `selftest:memory` (profile/stats) | **FAILED — 506–512 MB idle, external 360–365 MB** (target 350 MB; audit table: 295 MB). Pre-existing: identical at HEAD, d8bfd15, and audit commit f3fc615 with this session's changes stashed. See NEW hypothesis above. |
| `git diff --check` | clean |

## Railway monitoring procedure (next 24 h after deploy)

1. Restart/redeploy so the old process's native high-water doesn't carry over.
2. Confirm the first `[resource]` line shows the new `heapLimit` field (proves
   the new build is live).
3. Watch: `rss` trend, `nativeGap`, the 450/600 MB warning lines, Railway's
   egress graph vs `[discord-upload]` + R2 PUT interval counters.
4. After ≥ 24 h, export logs and run `scripts/analyze-resource-logs.js`.
5. Apply at most one env experiment only if its threshold is met; observe 24 h;
   revert (remove the var) if RSS worsens or behavior regresses.

## Egress status

No new egress code paths were changed this session. The 2026-07-16 fixes
(battle `start_and_final`, canvasCache render-once→R2 URL, boss refresh
coalescing, summon attachment reuse) remain in place; `[discord-upload]`
attribution and duplicate fingerprints are the evidence stream for any
remaining spikes. If egress spikes persist, tabulate `[discord-upload]` by
command/phase over the same 24 h window before changing anything.
