# Phase 11 — Card Render: Symbol/Rank Size + Alignment Fix (build-direct)

## What to fix (card face renderer only)

Looking at the current output (screenshot 1), the number and symbol on each card are too small and not centered. The target is screenshot 2 — large, bold number and symbol that fill their respective zones, both horizontally and vertically centered within each half.

### Changes to the compositing layout in the card renderer:

**Number (rank) PNG — upper half:**
- Scale up so the number fills **70% of the card width** (maintaining aspect ratio, capped at 80% of the upper half height)
- Horizontally centered within the full card width
- Vertically centered within the upper half of the card

**Symbol PNG (and royal PNGs) — lower half:**
- Scale up so the symbol fills **65% of the card width** (maintaining aspect ratio, capped at 80% of the lower half height)
- Horizontally centered within the full card width
- Vertically centered within the lower half of the card

**Gap between the two elements:**
- Minimum 3% of card height gap between the bottom edge of the scaled number and the top edge of the scaled symbol — they must not touch or overlap

### Alignment rule (strict):
Both elements are centered on the **horizontal midpoint of the card canvas**. Not left-aligned, not offset — dead center. Use `(cardWidth - scaledWidth) / 2` for the x position of each.

### Nothing else changes:
- Do not touch card logic, deck, game rules, payout, or any file outside the card face renderer.
- Card back untouched.
- Fallback behavior (missing assets) untouched.
