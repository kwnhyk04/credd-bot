# ASSET_VERSION bump — after re-uploading recompressed assets (§5.2)

## When

After you have:
1. Run `node scripts/recompress-assets.js --quality 72` (staging output in `assets/_recompressed/`, report in `recompress-report.txt`).
2. Visually approved the staging images.
3. Uploaded each staging file to R2 **over the same key** it mirrors (e.g. `assets/_recompressed/skins/supporters/base/battle.png` → bucket key `skins/supporters/base/battle.png`). Filenames/extensions stay as-is — every consumer sniffs magic bytes, not extensions.

## How

In the production environment (Railway → Variables), change:

```
ASSET_VERSION=<current value + 1, or today's date e.g. 20260711>
```

Then redeploy/restart the bot.

## What happens (expect this)

- Remote asset URLs get a new cache-busting query string (`src/utils/assets.js`), so Discord/CDN stop serving the old, larger files.
- Canvas cache keys include `ASSET_VERSION` (`src/utils/canvasCache.js`), so **every cached render regenerates once**: expect a one-time render + R2 PUT/egress spike, then permanently lower egress per render (source art is ~93% smaller at q72).
- Old `cache/canvas/*` objects go cold and are evicted by the normal `sweepCanvasCache()` pass — no manual cleanup needed.

## Recommendation

Do the R2 upload + version bump during low-traffic hours (early morning PHT), so the one-time regeneration spike lands when few players are rendering cards.
