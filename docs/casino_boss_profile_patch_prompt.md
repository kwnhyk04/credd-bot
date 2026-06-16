# PATCH — Casino timing/assets · Greater Boss chest roll · Elite gold rate · Profile template

Continuing **Credd — The Last Believer**. Five changes across the casino, boss, and profile systems. Build-direct (no plan gate) EXCEPT the elite-mob drop change which is a constant. Untouchable: schema DDL, seeds, summonEngine.js, battle/casino engine RNG, .env, `// TODO Phase-rep`. Branch `master`. Patch the repo-root `CREDD_Master_Export_v4.md` for any rule change below, tag `[v4.6]`.

---

## 1. Coin Toss timing (casinoRender / coin command)
The coin GIF runs for **4 seconds**, then HOLDS on its final frame for **2 seconds**, then at **4.5 seconds** swap to the result PNG of the landed face. Net: GIF plays 0–4s, settle/reveal the static result PNG at 4.5s. (The PNG is the still coin of the winning face — confirm the result-PNG filenames in `assets/casino/coin/`; if only the GIFs exist, flag it. The backend outcome is unchanged — this is purely the reveal timing.) Settlement/balance update fires at the reveal, not before.

## 2. Dice Roll timing (casinoRender / dice command)
Each dice GIF rolls for exactly **2 seconds**, then reveal the result at **2.5 seconds**. Assets were replaced but keep the SAME filenames (`assets/casino/dice/dice_roll_{n}.gif`) — no asset-path change. Both dice still reveal simultaneously.

## 3. Card assets — NEW suits, PNG not GIF (cardDeck / baccarat / blackjack render)
The card set is replaced. **New suits: `pegasus`, `trident`, `laurel`, `hammer`** (these REPLACE the old Abyss/Tempest/Lunar/Solar suit slugs — update every reference: cardDeck suit map, baccarat/blackjack renderers, the suit legend row in the baccarat embed, and the Master §24 suit-mapping line). 
- **Filenames are now `.png`, not `.gif`:** `assets/casino/cards/{suit}_{rank}.png` — e.g. `pegasus_a.png`, `trident_10.png`, `laurel_j.png`, `hammer_k.png`. Update the asset-filename resolver and every card draw/reveal to load PNGs. Cards no longer animate — they're static images shown at reveal.
- `card_back` for the blackjack dealer hole card: confirm whether it's now `card_back.png` (likely already PNG) and keep it consistent.
- Decide the display name mapping for the four suits if the embeds show suit labels (you choose thematic names, or just title-case the slug) — flag your choice. Logic (rank values, baccarat/blackjack rules, uniform draw) is UNCHANGED; only the asset layer and suit slugs change.

## 4. Greater Boss chest — roll ONCE at spawn, not per-attacker (bossSystem / bossScheduler)
CHANGE the chest mechanic from the v4.4 behavior. Currently the chest type is rolled per attacker at defeat. New rule:
- **At spawn**, for a Greater Boss, roll the chest type ONCE: 80% → "2× Boss Treasure Chest" / 20% → "1× Boss Golden Chest". Store the rolled chest outcome on the spawn (in-memory boss state, alongside the greater flag — no schema change; if you want it durable across restart, put it in `boss_state.special_flags`-style memory or the existing in-memory boss record, your call — flag which).
- The spawn ANNOUNCEMENT shows the actual rolled chest for THIS boss (not "80%/20% chance"), so players know what's at stake: e.g. "Reward chest: 🗝️🗝️ 2× Boss Treasure Chest" or "🪙 1× Boss Golden Chest".
- At defeat, EVERY attacker receives that same pre-rolled chest outcome (all other Greater drops unchanged: 30,000 combat EXP — still flagged as lower-than-normal, 150,000 credux, 1,000 shards). Keep the reward computation in ONE place keyed off the stored spawn roll so announcement and payout never disagree. Normal (non-greater) bosses unchanged (1× Boss Treasure Chest).
- Patch Master §16 `[v4.6]`: Greater Boss chest is rolled at spawn (80/20) and fixed for that fight, shown in the announcement.

## 5. Elite mob gold chest drop 30% → 50% (raid loot config)
In the raid loot constants, raise the Elite-win Gold Chest drop rate from 30% to **50%**. Regular-mob silver chest (30%), shard amounts, credux, and EXP all UNCHANGED. Patch Master §13 loot table `[v4.6]`: Elite gold chest ~50%.

## 6. Profile redesign — template background (profile renderer)
The profile Canvas gets a background template. Assets are in `assets/profile/`.
- **Use `assets/profile/default_template.png`** as the base background for `crd profile`/`crd stats`: load it as the canvas base layer, then draw ALL existing profile text/elements (Believer header, avatar, combat EXP line, weapon, Active Deity/Blessing, stat icons, Combat Record block, footer quote) ON TOP of it, positioned to fit the template's layout.
- The other PNG templates in `assets/profile/` are for a future SUPPORTER system (planned after this phase) — **do NOT wire them up now.** Only `default_template.png` is used. Build the renderer so the template filename is a single swappable constant (so the supporter phase can select a template per user later without restructuring).
- Keep all the data/values identical to the current profile (this is a visual reskin onto a background, not a content change). Adjust text positions/sizes/colors as needed for legibility against the template art. If the template's dimensions differ from the current canvas size, resize the canvas to the template and re-layout.

---

## BUILD & VALIDATION
`node --check` on every touched file; casino-selftest still green (timing/asset changes don't alter outcomes — payout integrity and distribution unchanged; update any fixture that referenced old suit slugs or `.gif` card paths); confirm no `Math.random` introduced. Verify card filename resolver against the four new suit slugs.

Report: files changed; confirmation that game OUTCOMES/payouts are unchanged (1–3); the Greater Boss chest storage choice + where the single reward-source-of-truth lives (4); the suit display-name mapping you chose (3); whether result-PNGs exist for the coin reveal (1); the `[v4.6]` Master diff (§13, §16, §24); and any asset filename that doesn't resolve. Then STOP — I drop/confirm assets, restart, and live-test: coin reveal timing + result PNG, dice 2s/2.5s, baccarat & blackjack with the new PNG cards + suits, a Greater Boss spawn (announcement shows the fixed chest, defeat pays that chest to all), an elite raid for the 50% gold rate, and `crd profile` on the new template.
