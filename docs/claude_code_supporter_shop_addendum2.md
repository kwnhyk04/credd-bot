# CREDD — Supporter Shop ADDENDUM 2: shop UI, buy/use/collection commands

Append to the supporter-shop prompt. Mirror the **existing deity collection embed** for visual consistency (same component style: paginated, locks, emoji icons, equipped indicator). One small DB change (`skin_code`, run separately); everything else is code.

---

## 0. Skin codes & emoji
- Each shop skin has a short **`skin_code`**: letter = category (`p`=profile, `b`=battle, `r`=battle_result, `s`=summon) + increment (`p1`, `b2`, `r3`, `s2`). Globally unique. The seeder fills `cosmetic_catalog.skin_code` from each filename's trailing token. Commands resolve skins by this code; **category is inferred from the leading letter**, so no category arg is ever needed.
- **Emoji:** the repo has `skins.txt` mapping each skin (and the token + the collection icon) to a custom Discord emoji, e.g. `p1=<:champions_arena:123…>`, `token=<:supporter_token:123…>`, `skins=<:skin_collection:123…>`. Load it at boot into an emoji map and render these as icons in all embeds. *(skins.txt wasn't attached to this request — read it from the repo; if a code is missing from the map, fall back to a neutral emoji and log it.)*

## 1. `crd dev supporter shop` — dev bypass shop (deity-collection style)
Dev/owner-gated. Opens the full shop **bypassing the subscription gate and tier gate**; every skin visible. Embed layout, one **category per page** (4 pages):

```
Header:      🛒  Supporter Shop                         (author/footer: "DEV MODE — access bypassed")
Message:     Browse all supporter skins. Spend tokens to claim a skin, then equip it.
Sub-header:  Page 1/4 · Profile Skins
──────────────────────────────  (separator)
Skin list:   {emoji} **Champion's Arena** · `p1` · {token} 3 · ✅ owned / 🔒 locked
             {emoji} **Divine Radiance**  · `p2` · {token} 3 · 🔒
             ...
──────────────────────────────
{token} Tokens: 12
──────────────────────────────
Buy: `crd buy p1`   ·   Your skins: `crd skin collection`
```
- Pages: 1 Profile, 2 Battle, 3 Battle Result, 4 Summon. `◀ ▶` buttons flip pages (per-user interaction guard).
- Recommended header: keep the title short (`Supporter Shop`) with a `DEV MODE — access bypassed` marker in the author line — cleaner than stuffing "DEV" into the title.
- For DEV_ACCOUNT_IDS every skin shows as owned (see §4).

> The real, non-dev shop (`crd shop` from the base prompt) uses this same embed **without** the DEV marker and **with** the access + tier gates enforced.

## 2. Buy commands
- **`crd buy <skin_code>`** — supporters only. Resolve `skin_code` → catalog row; verify active supporter + tier gate + not already owned + enough tokens; `spendTokens`; insert `user_cosmetics` (source `shop`). Confirm with the skin emoji + new balance.
- **`crd dev buy <skin_code>`** — dev/owner-gated; same grant but **free** (no token spend, bypass gates) for testing.

## 3. `crd use skin <skin_code>` — equip by id (category inferred)
- e.g. `crd use skin p1`, `crd use skin b2`, `crd use skin r1`, `crd use skin s2`.
- Infer category from the leading letter → resolve `skin_code` → verify owned (or dev, §4) → set `equipped_skins` for that category (clear `override_path`). Confirm with the skin name + emoji.
- This is the **user-facing** equip; it replaces needing the `crd dev use ...` forms for normal play (keep the dev forms for raw directory/tester/founder files).

## 4. Developer accounts own everything
For the two `DEV_ACCOUNT_IDS`, the ownership resolver returns **owned = true for all active catalog skins**, so they can `crd use skin <any>` and see every skin marked owned in shop + collection without buying. Implement in the ownership check (no DB rows needed); buys by devs are free no-ops.

## 5. `crd skin collection` — open to everyone (deity-collection style)
- Available to **all users**, supporter or not (only the *shop* is gated). Non-supporters can browse + see locks but can't equip/buy.
- Mirror the deity collection embed exactly: paginated by category (Profile / Battle / Battle Result / Summon), each skin shown with its **emoji icon**, display name, `skin_code`, and a **lock 🔒 for unowned** vs owned.
- **Equipped indicator per category:** like the weapon/deity collection marks the active one, mark the currently-equipped skin in each category (e.g. ✅ or `「Equipped」`). Read from `equipped_skins`; resolve per the render precedence so dev/tester overrides show correctly.
- Show the user's **token balance** (with token emoji) in the footer, and a help line: `Equip: crd use skin p1`.

## 6. Acceptance additions
- [ ] `skin_code` seeded and unique; all commands resolve skins by code with category inferred from the leading letter.
- [ ] `crd dev supporter shop` opens the paginated, deity-style shop with gates bypassed and DEV marker; `◀▶` paging works; token count + help lines render.
- [ ] `crd buy` (supporter, spends tokens, enforces gates) and `crd dev buy` (free, bypass) both work.
- [ ] `crd use skin <code>` equips the right category by prefix; ownership enforced (dev = all).
- [ ] `crd skin collection` works for non-supporters too; locks for unowned; **equipped marker per category**; emoji icons; token balance shown.
- [ ] Token + skin emoji loaded from `skins.txt` and rendered; missing codes fall back + log.
- [ ] DEV_ACCOUNT_IDS see all skins owned in shop + collection.
