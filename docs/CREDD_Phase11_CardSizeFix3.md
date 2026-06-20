# Phase 11 — Card Render: Size Fix, Iterate Until Correct (build-direct)

## Stop guessing percentages. Do this instead:

1. `console.log` the actual card canvas dimensions and the actual loaded PNG dimensions for both the number and symbol assets before any scaling.

2. Use this exact scaling logic — no other approach:

```js
// For the number (rank) — fills top half
const targetH_number = Math.floor(cardHeight * 0.5 * 0.85); // 85% of the top half height
const scale_number = targetH_number / numberImg.height;
const drawW_number = Math.floor(numberImg.width * scale_number);
const drawH_number = targetH_number;
const drawX_number = Math.floor((cardWidth - drawW_number) / 2);
const drawY_number = Math.floor((cardHeight * 0.5 - drawH_number) / 2); // centered in top half

// For the symbol — fills bottom half
const targetH_symbol = Math.floor(cardHeight * 0.5 * 0.85); // 85% of the bottom half height
const scale_symbol = targetH_symbol / symbolImg.height;
const drawW_symbol = Math.floor(symbolImg.width * scale_symbol);
const drawH_symbol = targetH_symbol;
const drawX_symbol = Math.floor((cardWidth - drawW_symbol) / 2);
const drawY_symbol = Math.floor(cardHeight * 0.5 + (cardHeight * 0.5 - drawH_symbol) / 2); // centered in bottom half

ctx.drawImage(numberImg, drawX_number, drawY_number, drawW_number, drawH_number);
ctx.drawImage(symbolImg, drawX_symbol, drawY_symbol, drawW_symbol, drawH_symbol);
```

3. Remove ALL other scaling calculations for these two elements. Do not mix this with any prior percentage or max-width logic — replace, don't append.

4. After implementing, generate a test card (e.g. `{ suit: 'pegasus', value: '7' }`) and `console.log` the final draw coordinates and sizes. Confirm in your reply that the number height equals ~85% of the top half and the symbol height equals ~85% of the bottom half.

5. If after one run the elements still appear small in Discord, increase `0.85` to `0.92` and test again. Keep iterating the multiplier upward until the rank and symbol visually fill their half. Do not stop and ask — just run it, check the output, adjust, and report what multiplier finally looked correct.

## The goal
Rank and symbol should each nearly fill their half of the card — bold and large like the reference screenshot 2. Not small icons. Not floating in empty space.
