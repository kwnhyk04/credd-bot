# CREDD — Supporter Shop + Skin System (first stage) — Claude Code instructions

Implement the supporter shop, the supporter-token economy, the skin render pipeline, the dev render commands, and one combat tweak (Bathala). Cosmetic-only: nothing here grants credux, items, or any combat advantage.

## Ground rules

1. **The human runs the SQL.** The DDL (`supporters`, `supporter_token_ledger`, `cosmetic_catalog`, `user_cosmetics`, `equipped_skins`, `stripe_events`) and the Bathala `blessing_description` update are already applied to the DB. Do **not** write migrations or edit those tables' structure. You may read/write their **rows** from code.
2. **You populate `cosmetic_catalog` via a seeder script** (below) that scans the asset directories — do not hand-write catalog rows, parse the real filenames.
3. **No gameplay tables touched.** Skins swap rendered art only; combat reads the underlying item/stat.
4. Use forward-slash paths in code; the spec lists Windows-style paths — normalize to `assets/skins/...`.

---

## 1. Asset directories & filename convention

```
assets/skins/
  supporters/base/                         base set, all tiers, auto-equipped on subscribe
      profile.png  battle.png  victory.png  defeated.png  ember_spark_flip.webp
  supporters/supporter_store/
      profile/                             tier_name_p<N>.png         e.g. c_divine_radiance_p1.png
      battle/                              tier_name_b<N>.png         e.g. c_champions_arena_b1.png
      battle/result/img/                   tier_name.png  (BLANK display preview, no result text)
      battle/result/                       tier_name_<victory|defeated>_r<N>.png
                                             e.g. c_laurel_crown_victory_r2.png
                                                  e_aurora_sovereign_defeated_r3.png
      card_flip/img/                       skin_name.png  (display preview)
      card_flip/                           tier_skin_name_s<N>.webp   e.g. e_aurora_ribbon_s2.webp
  testers/                                 beta default set (all accounts during beta)
      profile.png  battle.png  victory.png  defeated.png
  testers/<discord_id>/                    per-user custom set (4 ids today; future custom-skin tier)
  founder/                                 founder skin set (dev command preview)
```

**Convention parser (position-based — do NOT match by letter alone, because the believer tier code `b` collides with the battle category code `b`):**

- Split the basename (minus extension) on `_`.
- **First token = tier:** `b`→believer, `c`→chosen, `e`→eternal.
- **Last token = `<category-letter><increment>`:** `p`→profile, `b`→battle, `r`→battle_result, `s`→summon. The trailing digits are the roster increment.
- **Middle tokens = the skin name** (join with `_`, title-case for display: `champions_arena` → "Champion's Arena"; keep an apostrophe map if needed).
- **battle_result has two render files** (`..._victory_r<N>.png`, `..._defeated_r<N>.png`) plus a blank display preview in `result/img/`. Group them into one catalog row by their shared `tier_name_r<N>` key.
- **summon** has a display `.png` in `card_flip/img/` and the animated `.webp` in `card_flip/`.

---

## 2. Catalog seeder (`scripts/seedCosmetics.js`, idempotent)

Scan each store directory, parse filenames per §1, and **upsert** into `cosmetic_catalog`:

- `cosmetic_key` = the normalized basename key (e.g. `c_champions_arena_b1`; for results `c_laurel_crown_r2`).
- `category`, `tier`, `display_name` from the parse.
- `render_filename` (profile/battle png, or summon webp), `victory_filename`/`defeated_filename` (results), `display_filename` (the `img/` preview where one exists; for profile/battle the render file doubles as preview).
- `token_cost`: default by tier — **believer 2 / chosen 3 / eternal 4** (adjustable constant at top of seeder).
- Also seed the **base** set (`supporters/base/*`) as catalog rows: one per category, `tier`=null-equivalent handled by setting `is_base=true`, `token_cost=0`. Base profile/battle/result/summon keys e.g. `base_profile`, `base_battle`, `base_result`, `base_flip`.
- `has_top_label=true` for any profile skin whose canvas has the top word-space (start with base profile + flag per-skin as you verify in §8 testing).
- Re-running updates rows and flips `is_active=false` for catalog entries whose files no longer exist.

Run via `node scripts/seedCosmetics.js`. Log a summary (counts per category/tier).

---

## 3. Supporter-token economy

Tokens = the monthly stipend. Grant amounts:

- Believer **1 / month**, Chosen **3 / month**, Eternal **one-time 18** at purchase (= 6 × the 3-month window). _(Adjustable constants; flag if you'd prefer Eternal to drip 6/month for 3 months.)_

Implement:

- `grantTokens(userId, amount, reason, ref)` — atomic: insert `supporter_token_ledger` row **and** `UPDATE supporters SET token_balance = token_balance + amount` in one transaction.
- `spendTokens(userId, amount, reason, ref)` — transaction with `SELECT ... FOR UPDATE` on the supporter row; reject if `token_balance < amount`; write negative ledger delta + decrement balance.
- Monthly grant fires from the Stripe `invoice.paid` handler (skip the `subscription_create` first invoice if welcome already covered it — see entitlement layer). Eternal grant fires once on the founder purchase.
- Tokens are **never** written to `users_bag` or any credux column. No function reads both tokens and credux.

---

## 4. Base skin auto-grant on subscribe

On any successful subscribe/founder grant: insert the four base catalog rows into `user_cosmetics` (source `base`) if absent, and set the user's `equipped_skins` for all four categories to the base cosmetics **if they have nothing equipped yet**. Base flip = `ember_spark_flip.webp`.

---

## 5. Supporter Shop (`/shop` or `crd shop`)

Access: any active supporter (believer/chosen/eternal). Non-supporters get a "subscribe to unlock" embed.

- **Embed with a category dropdown:** Profile, Battle, Battle Result, Summon.
- Selecting a category lists that category's active catalog skins with **preview image** (`display_filename`; for results use the blank `result/img` preview), display name, tier, and `token_cost`. Show owned vs buyable, and the user's token balance.
- **Buy:** verify not already owned → `spendTokens` → insert `user_cosmetics` (source `shop`).
- **Equip:** verify owned → set `equipped_skins` for that category to the cosmetic (clear any `override_path`).
- **Tier gate (default):** a user may buy/equip skins of **their tier and below** (eternal→all, chosen→chosen+believer, believer→believer). _(Adjustable — flag if tokens should unlock any tier.)_
- All buttons/selects are per-user (check the interaction user owns the action); use ephemeral replies.

---

## 6. Render integration

Per category, resolve the skin to render with this precedence:
**`override_path` (dev/tester/custom) → equipped `cosmetic_id` → base (if subscriber) → free-player default template.**

- Load the resolved frame as the **bottom canvas layer**, then `ctx.drawImage(frame, 0, 0, LOCKED.w, LOCKED.h)` to **normalize to the locked size** (profile/battle/victory/defeated = 1536×1024). This guarantees fit regardless of source-asset drift.
- Register bundled **Inter** (+ Cinzel/JetBrains if used) at boot with `registerFont` before creating any canvas. **Use icon PNGs, not emoji** (Cairo can't render color emoji).
- **Profile top-label:** when the equipped profile skin has `has_top_label=true`, draw one word in the top space: `Founder <NNN>` (zero-padded founder_number) if the user is a founder, else their tier name ("Believer"/"Chosen"/"Eternal"). **The two developer accounts render `Founder 000`** — read a `DEV_ACCOUNT_IDS` config array (the human fills in the 2 dev Discord IDs).
- **Battle result:** render `victory_filename` on win, `defeated_filename` on loss. Both have a **reserved space below the result** to render the run's rewards/loot — draw the reward summary there. Verify the reward block fits inside that space for every result skin.
- **Summon flip:** for a supporter with an equipped summon skin, play their `.webp` as the flip animation, then reveal the deity. The webp is a complete pre-rendered animation — send it as the flip step; no per-pull compositing.

---

## 7. Tester / custom / founder skins (beta)

- **Beta default:** while a `BETA_MODE` flag is on, any account with no equipped skin renders from `assets/skins/testers/` (`profile/battle/victory/defeated.png`). This is the fallback for all current + new accounts during beta — implement as the resolution step just above "free-player default."
- **Per-user custom:** for the four ids with folders under `assets/skins/testers/<discord_id>/`, equip that folder's files via `equipped_skins.override_path` so those users render their custom set. (Preview of the future custom-skin tier.)
- **Founder set:** `assets/skins/founder/` — used by the dev command below.

---

## 8. Dev render commands (testing canvas fit)

Gate all of these behind a dev/owner check. They set the **invoking dev's** `equipped_skins.override_path` (or the target's, where an id is given) so the next `crd profile` / battle render shows the skin.

```
crd dev use profile  p1      → equip assets/skins/supporters/supporter_store/profile  skin with increment p1
crd dev use bskin    b1      → battle skin b1
crd dev use bresultskin r1   → battle_result skin r1 (resolves victory + defeated)
crd dev use summonskin s1    → summon flip skin s1
crd dev use founderskin      → equip ALL founder skins from assets/skins/founder/ (all categories)
crd dev use skin <discord_id>→ equip every skin in assets/skins/testers/<discord_id>/ onto that id
```

Resolve `<letter><N>` to the matching file in the right directory by the §1 convention. If multiple tiers share an increment, accept an optional tier prefix (`crd dev use profile c_p1`) and otherwise pick the first match + warn.

---

## 9. Bathala blessing change (combat)

In `/engine/passiveRegistry.js`, update `bathala_divine_vessel`:

- **Remove HP** from the ramp — it now buffs **ATK and DEF only**.
- Change the step from +15%/turn to **+20% per turn**, additive, **cap +100%** (5 stacks, reached turn 5). Applied at the start of each turn before attacking (start-of-turn step), as a self-buff (not cleansable). The DB `blessing_description` is already updated to match.

---

## 10. Canvas-fit testing (required before you call this done)

Write a test/preview script that, for **every** skin in every category and tier (base, store, tester, founder, the 4 custom folders):

- composites realistic sample data (long name, max stats, full combat record, a rewards block on results, the top-label word on profile) onto the real asset at the locked size, and
- saves the output to a `tmp/skin_preview/` folder for visual review, and
- asserts no text/content overflows the frame's content zones and that the result-reward space and profile top-label space are honored.
  Report any skin where content clips or a zone is misaligned. Do **not** assume fit — load the actual files and verify.

---

## 11. Change summon embed play to 4 seconds, before it will change to gacha results.

---

## Acceptance checklist

- [ ] `seedCosmetics.js` populates `cosmetic_catalog` from the directories (correct category/tier/name/files/cost), idempotent, deactivates missing files.
- [ ] Tokens: grant on sub (1/3) + Eternal one-time (18); spend is atomic and can't go negative; ledger + balance always agree; no token↔credux path exists.
- [ ] Base set auto-granted + auto-equipped on subscribe.
- [ ] `/shop`: dropdown (Profile/Battle/Battle Result/Summon), previews, buy with tokens, equip, ownership + tier gate enforced, ephemeral + per-user.
- [ ] Render precedence works; profile top-label shows tier / `Founder NNN`; **dev accounts show `Founder 000`**; results pick victory/defeated + fit the reward block; summon plays the equipped webp.
- [ ] Beta default (testers set) for unequipped accounts; 4 custom folders auto-equip; founder dev command works.
- [ ] All `crd dev use ...` commands equip + render the right asset.
- [ ] `bathala_divine_vessel` = ATK+DEF only, +20%/turn, +100% cap; matches the DB description.
- [ ] Canvas-fit preview script run; every skin verified to fit; no clipping.

## Open decisions to confirm

1. **Eternal tokens** — one-time 18 (default) vs 6/month across the 3-month window.
2. **Shop token costs** — default believer 2 / chosen 3 / eternal 4; adjust to taste.
3. **Tier gate** — buy your tier-and-below (default) vs tokens unlock any tier.
4. **DEV_ACCOUNT_IDS** — the human must supply the 2 dev Discord IDs that render `Founder 000`.
5. Sample profile image wasn't attached this round — validate the top-label spacing against the real base `profile.png` during §10 testing and report back if the word area needs adjustment.
