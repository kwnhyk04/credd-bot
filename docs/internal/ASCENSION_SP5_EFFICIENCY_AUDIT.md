# SP5 §5.3 — Codebase efficiency audit (2026-07-11)

Status of the hunt categories from the blueprint, against the current code
(post June-2026 egress patches). §5.1 (recompression script) and §5.2
(ASSET_VERSION doc) are delivered separately.

## Already clean — no change needed

| Category | Finding |
|---|---|
| Redundant re-encodes | `src/utils/imageOutput.js` encodes exactly once per output (webp OR png OR jpeg, behind `withImageWorkSlot`); fallbacks only fire on encoder errors. `attachmentFromOptimizedImage` reuses the cache-path buffer without re-encoding. |
| Repeated remote fetches | `remoteAssetAvailable` (assets.js) HEAD-checks once per URL, positive results cached for process lifetime, negatives on a 10-min TTL. Asset buffers/images go through the LRU caches. Deity-info thumbnail candidate probing hits this cache, so repeat `crd deity info` costs zero HEADs. |
| Cache-bypassing renders | profile/stats (render-rev + memory signature), deities grid, summon, boss, battle frames all route through `getCachedCanvasUrl`. New SP3/SP4 surfaces (deity info embed, glossary) are text/emoji only — no canvas at all. |

## Remaining candidates — need the measured loop (test bot + visual diffs)

1. **PNG intermediate between canvas and sharp** (all `getCachedCanvasUrl`
   callers pass `canvas.toBuffer('image/png')`; sharp then decodes that PNG to
   re-encode WebP/JPEG). Passing raw RGBA (`sharp(buf, { raw: {width,
   height, channels: 4} })`) skips one encode+decode per cold render.
   Touches the cache interface + ~10 call sites — highest value, highest blast
   radius. Verify: byte-identical output for same pixels, RSS before/after,
   one visual diff per command (profile, stats, raid, battle result, summon, bag).
2. **Oversized intermediates**: no renderer was found rendering larger than
   final output by default (`maxWidth` env caps default to 0 = off), but raid
   battle frames should be re-measured after the §5.1 asset swap since source
   art dimensions drive canvas size in some skin paths.

## Measurement protocol (per change, per blueprint)

1. Baseline: run the render harness scripts (`buildProfilePreviewSheet.js`,
   `renderSkinDesignPreview.js`) + one live command per surface on the TEST
   bot; record `process.memoryUsage().rss` and the `image output bytes` /
   R2 PUT counts from `performanceLog`/`bandwidthLog` output.
2. Apply ONE change; `npm run selftest:full`.
3. Re-render the same fixtures; diff images (must be visually identical) and
   compare RSS / PUT counts.
4. Only then move to the next change.

No production code was changed under §5.3 in this pass: the two remaining
candidates cannot be verified without the live measured loop above, and the
blueprint forbids unmeasured optimization changes.
