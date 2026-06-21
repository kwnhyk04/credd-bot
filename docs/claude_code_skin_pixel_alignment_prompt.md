# CREDD — Per-Skin Canvas Configs + Pixel-Alignment Loop (Claude Code)

Your job: make text/content placement on every supporter skin **pixel-accurate against a reference image**, and give **each skin its own canvas layout config**. There is no universal layout — every skin's art puts panels, ornament, and the top-label in different places, so a single shared config is wrong by definition.

## Hard rules

1. **One config per skin, never one-for-all.** Each renderable skin (profile / battle / battle_result) gets its **own** `<asset_basename>.layout.json` colocated with its art. The renderer is generic and reads that file; it must contain **zero hardcoded coordinates**.
2. **Iterate until it matches the reference**, per skin. "Close enough" is not done — keep adjusting and re-rendering until alignment is within the tolerance below.
3. Touch code + config files only. Do not change combat or DB schema.

## What "aligned" means (acceptance tolerance)

For each skin, compare your rendered output to its reference image and meet **all** of:

- Every text element's top-left anchor within **±2 px** of the reference for that element.
- No glyph crosses a frame's gold border or leaves its intended content zone.
- Color of each element matches the reference (exact hex from the design tokens).
- For `battle_result`: the reward block sits fully inside the skin's `reward_zone` with no overflow.
- For `profile`: the top-label word sits in the skin's designated empty slot, not over ornament.

## The alignment loop (run this per skin, automated)

Build a script `scripts/alignSkins.js` that, for each skin:

1. **Inputs:** the skin art (`render_filename`), its reference image (`assets/skins/_reference/<skin_key>.png` — the intended final look), and its current `<basename>.layout.json` (create from the category default if absent).
2. **Render:** composite realistic sample data (long name, max-width stats, full combat record, a top-label word, a full reward block for results) onto the art at the locked size (1536×1024) using the config.
3. **Measure the gap:** diff render vs reference. For each element, detect its actual drawn position (text bounding boxes / the colored stat chips / bar rects) and compute the pixel offset from where the reference shows it. Also flag any pixels where drawn text overlaps gold-border pixels.
4. **Auto-correct:** nudge that element's `x`/`y` (and size if the box is wrong) in the JSON by the measured offset; for overflow, shrink/wrap. Write the JSON back.
5. **Re-render and re-measure.** Loop until every element is within ±2 px and nothing clips, or 25 iterations — then stop and report the residual for that skin so a human can finish it.
6. **Save artifacts:** write `tmp/align/<skin_key>/iterN.png` and a final `diff.png` (heatmap of remaining difference) so the result is reviewable.

Process **every** skin in every category and tier: base, store, tester, founder, and the 4 custom `testers/<discord_id>/` sets. Print a summary table: skin, iterations used, max residual px, pass/fail.

## Per-skin config requirement (restate)

- The config is the **single source of truth** for that skin's placement and styling (positions, fonts, weights, sizes, colors, anchors, bar/box rects, stat columns, record columns, `top_label`, and `reward_zone` for results). Use the provided `base_profile.layout.json` as the schema + clone-template.
- A new skin = "drop the art + its own layout.json + its reference image," then run the loop. No engine edits, ever.
- If a skin has no config, fall back to the category default **and log a warning** — but the goal is that every shipped skin has its own tuned config committed.
- Only touch everything in the skins folder. Config json files are there, I give you permission to rename the image canvas since they have their own folder like for the tester folder, there are profile named there, rename everything to avoid confusion.
- The 4 folders in tester folder is named after discord id's, they own those skins to make sure include it in their skin collection as their owned.
- The base skins in the tester folder should be owned by everyone in skin collection as the bot is currently in testing phase, those are the tester skins.
- Moving forward, everyone that will create account will be using the tester skins
- Create a config that after the deployment on hosting, all new accounts there will have the base skins (See screenshots) mark those designs as base skins for open beta users assets\profile\default_template.png
- Include the skins in founders in skins owned by the developer, they should appear in the skin collection. But they won't be shown at supporter shop due to they are limited, founder skins will be used for the first 50 founder support subscriptions.

## Reference handling

- If a reference image for a skin doesn't exist yet, generate a first-pass render, save it to `tmp/align/<skin_key>/proposed_reference.png`, and flag it for human approval instead of blindly converging on nothing.
- Never assume fit from the prompt — always load the actual files, render, and measure pixels.

## Deliverables / acceptance

- [ ] `scripts/alignSkins.js` exists and runs the loop per skin to ±2 px or 25 iterations, saving iter + diff artifacts.
- [ ] Every renderable skin has its **own** committed `<basename>.layout.json`; renderer has no hardcoded coordinates.
- [ ] Summary table shows each skin's residual; all passing skins ≤ 2 px and no clipping; any non-converging skin reported with its residual + diff image.
- [ ] `battle_result` rewards inside `reward_zone`; `profile` top-label in its empty slot; colors match hex.
- [ ] Re-running the loop is idempotent (already-aligned skins converge in 0–1 iterations).
