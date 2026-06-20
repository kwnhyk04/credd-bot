# Phase 11 — Casino Card Render Overhaul (build-direct)

## Context
Currently card faces are rendered as flat color backgrounds with a drawn symbol + number. This caused inconsistent background colors across suits. The fix: assemble each card face on Canvas using pre-made PNG assets (canvas background + number PNGs + symbol PNGs), composited in the correct layout. No more programmatic background fills.

---

## Asset locations and filenames (exact paths)

### Card canvas backgrounds (one per suit)
```
assets/casino/cards/img/Card Canvas/pegasus_canvas.png
assets/casino/cards/img/Card Canvas/laurel_canvas.png
assets/casino/cards/img/Card Canvas/trident_canvas.png
assets/casino/cards/img/Card Canvas/hammer_canvas.png
```
These are the parchment/bordered card backgrounds. Each suit gets its own canvas.

### Number PNGs (per suit, per value)
```
assets/casino/cards/img/Pegasus/<value>.png
assets/casino/cards/img/Laurel/<value>.png
assets/casino/cards/img/Trident/<value>.png
assets/casino/cards/img/Hammer/<value>.png
```
Values: `A 2 3 4 5 6 7 8 9 10 J Q K`
Example: `assets/casino/cards/img/Hammer/2.png`
Number filenames are just the face value: `A.png`, `2.png` … `10.png`, `J.png`, `Q.png`, `K.png`

### Symbol PNGs (one per suit, shared across all number cards)
```
assets/casino/cards/img/pegasus.png
assets/casino/cards/img/trident.png
assets/casino/cards/img/laurel.png
assets/casino/cards/img/hammer.png
```

### Royal face PNGs (J, Q, K — replace symbol on face cards)
```
assets/casino/cards/img/<suit>_royal_j.png
assets/casino/cards/img/<suit>_royal_q.png
assets/casino/cards/img/<suit>_royal_k.png
```
Examples:
```
assets/casino/cards/img/pegasus_royal_j.png
assets/casino/cards/img/pegasus_royal_q.png
assets/casino/cards/img/pegasus_royal_k.png
assets/casino/cards/img/hammer_royal_j.png
... etc.
```

---

## Compositing layout (Canvas assembly)

Each card is assembled as a single Canvas PNG by layering:

### Layer order (bottom to top):
1. **Card canvas background** — draw at full card dimensions, origin (0, 0)
2. **Number PNG** — upper half of card, horizontally centered, with padding from top
3. **Symbol or Royal PNG** — lower half of card, horizontally centered, with padding from bottom

### Layout rules:
- Card dimensions: match the existing card canvas PNG dimensions (read from the loaded image, don't hardcode)
- **Number zone:** top 50% of the card. Center the number PNG horizontally. Add ~8% padding from the top edge.
- **Symbol zone:** bottom 50% of the card. Center the symbol PNG horizontally. Add ~8% padding from the bottom edge.
- Number and symbol must **not overlap** — each is confined to its respective half. Scale each PNG down proportionally if it would exceed 80% of its half-zone width or height.
- For **J, Q, K**: use the royal face PNG (`<suit>_royal_j.png` etc.) in the symbol zone instead of the generic suit symbol. The number PNG for J/Q/K still renders in the upper half as normal.
- For **Ace (A)**: use the symbol PNG in the symbol zone, same as number cards. The `A.png` number renders in the upper half.

### Spacing:
- Minimum gap between number bottom edge and symbol top edge: 4% of card height.
- Both elements horizontally centered relative to the card width.

---

## Implementation target

Modify the card face rendering function in the casino card renderer (wherever `drawCardFace` or equivalent currently lives — find it, do not assume the filename). Replace the current programmatic draw (background fill + drawn text/shapes) with the Canvas compositing approach above.

The function signature and return type stay the same (returns a Canvas buffer or image). All callers (Baccarat, Blackjack, any other card game) get the new faces automatically.

Card back (`card_back.png`) is untouched.

---

## Suit-to-folder mapping (explicit)
| Suit name in code | Canvas file | Number folder | Symbol file |
|---|---|---|---|
| pegasus | `pegasus_canvas.png` | `Pegasus/` | `pegasus.png` |
| trident | `trident_canvas.png` | `Trident/` | `trident.png` |
| laurel | `laurel_canvas.png` | `Laurel/` | `laurel.png` |
| hammer | `hammer_canvas.png` | `Hammer/` | `hammer.png` |

---

## Error handling
- If any asset PNG fails to load (file not found), fall back to the current programmatic card draw for that card only. Log the missing path to `dev_logs`. Do not crash the game.
- Do not throw on missing royals — fall back to the generic suit symbol for that face card if the royal PNG is absent.

---

## Nothing else changes
Do not touch: card game logic, deck shuffling, bet handling, payout, any engine file, schema, or any command outside the card renderer. This is a pure visual compositing change.
