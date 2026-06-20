# CREDD — Supporter Shop ADDENDUM 3: Preview button + image preview view

Append to the supporter-shop prompt. Adds a **Preview** button to both the shop and the skin collection, and a per-skin image preview carousel. **No DB change.**

---

## 1. Preview button (shop + collection)
- Add a **Preview** button to the action row of **both** `crd skin collection` and the shop embeds (`crd dev supporter shop` and the real `crd shop`).
- **Position: far right** of the row, after the page `◀ ▶` buttons.
- **Emoji: reuse the exact emoji constant your existing drop-rates button uses** (the one on the category-display "?" drop-rates button). Import that same constant so the two stay visually identical — don't hardcode a new one.
- Clicking Preview opens the **image preview view** for the current category's skins, starting at the first skin on the current page.

## 2. Image preview view
Shows the actual skin art. **Discord constraint to respect:** a large embed image (`setImage`) always renders at the **bottom** of its embed — you cannot place text *below* it in the same embed. So the faithful, working layout is:

```
Title (header):   {emoji} Champion's Arena · `b1`     ← skin name + alias id (skin_code)
Description:      ──────────────────────────────
                  Buy: `crd buy b1`  ·  Equip: `crd use skin b1`   ← help commands for skins
                  ──────────────────────────────
Image (body):     [ the skin PNG, full-width ]        ← setImage(attachment://…)
Buttons:          ◀ Prev      Next ▶      ↩ Back to list
```
- **Header** = skin display name + its `skin_code` alias.
- **Body** = the skin image: attach the file and `setImage('attachment://<file>')`. Use `display_filename` (fall back to `render_filename`); for **summon** use the `card_flip/img/<skin>.png` display still; for **battle_result** show the blank `result/img` preview (optionally add a small toggle button to swap victory ⇄ defeated art).
- **Help** line sits in the description (above the image — that's the closest possible to your "help below image", given the image is pinned to the bottom).
- **Prev / Next** buttons cycle through the skins of the **current category** (wrap around). **Back to list** returns to the shop/collection embed at the same page.

> If you truly want header + image + help + buttons in strict top-to-bottom order, the only way is to bake the header/help text into a generated image and post that as the body — not worth it. The layout above is the standard Discord pattern; recommend it.

## 3. Behavior notes
- Preserve context: opening Preview from the **shop** keeps shop affordances (buy/equip help + lock/owned state in the header, e.g. `🔒` or `✅`); from the **collection** it shows owned/equipped state. Carry whether the viewer is the dev/shop-bypass so gating stays consistent.
- All buttons are per-user interaction-guarded and use ephemeral replies, same as the parent embed.
- Reuse the emoji map from `skins.txt` for the per-skin emoji in the preview header and the token/collection icons elsewhere.

## 4. Acceptance additions
- [ ] Preview button appears far-right on both shop and collection rows, using the **same emoji constant as the drop-rates button**.
- [ ] Preview view shows the skin PNG via `setImage`, header = name + `skin_code`, help line for buy/equip, Prev/Next cycling the current category, Back returns to the list.
- [ ] Summon previews show the card-flip display PNG; battle_result previews show the blank result art (optional victory/defeated toggle).
- [ ] Context (shop vs collection, dev bypass, owned/equipped state) is preserved into the preview.
