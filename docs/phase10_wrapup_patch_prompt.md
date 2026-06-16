# PATCH — `crd cred` + render tweaks + embed cadence + cooldowns (Phase 10 wrap-up)

Continuing **Credd — The Last Believer**. Final tweaks for Phase 10, then COMMIT. Build-direct. Untouchable: schema, seeds, summonEngine, battle/casino engine RNG, .env, `// TODO Phase-rep`. Branch `master`. Patch repo-root `CREDD_Master_Export_v4.md` for the cooldown + cadence changes, tag `[v4.8]`.

---

## 1. `crd cred` — balance-only command, works WITHOUT a character
Implement `crd cred` as a lightweight Credux-balance check. Key difference from `crd bag`: **`crd bag` requires a created character, but `crd cred` works for any REGISTERED account even with no character** (a user can have Credux pre-character). So `crd cred` uses mw:'full' but requiresCharacter:false.
- **Text only** (no canvas/embed render needed — a short plain message is fine, or a minimal embed if it matches the style of other simple commands). Show the current Credux as **{credux icon} {amount}** (the credux emoji from game_items.txt before the number). One line of necessary context is fine (e.g. "Your Credux balance:").
- Reads `users_bag.credux` (the bag row exists from registration even pre-character — confirm; if the bag row is only created at character creation, fall back gracefully and flag it).

## 2. Daily attendance icon too big (Screenshot 1 — `crd daily` render)
Reduce the size of the big sun/check attendance icon — it's oversized. Scale it down so it's proportional to the card. Everything else (Day counter, Month/Overall, reward lines, quote) stays.

## 3. Greater Boss rewards — remove "(this fight)" text (Screenshot 2 — boss announcement)
In the participation-rewards block, remove the `(this fight)` qualifier after the chest line (e.g. `Boss Treasure Chest ×2 (this fight)` → `Boss Treasure Chest ×2`). It's redundant — players already understand the listed rewards are for the active boss.

## 4. Bestow — credux icon before the amount (Screenshot 3 — bestow embed)
In the bestow message line, add the credux emoji icon before the amount: `…bestows {credux icon} 1 Credux upon…`. Matches the icon-before-amount convention used elsewhere.

## 5. Quest embed — smaller font (Screenshot 4 — `crd quest` render)
Reduce the font size in the quest canvas render further (quest names, progress, rewards, status). It's still a touch large; tighten it for a cleaner, denser look. Visual only.

## 6. Battle render — wrap long skill text to next line (Screenshot 5 — battleRender)
The mob skill description line (e.g. Kapre's "Smoke Cloud — Every 4 turns, reduces the player's CRIT by 30%...") overflows the canvas and gets cut off (`...`). Implement word-wrap: if the skill text exceeds the canvas width, wrap it to the next line(s) instead of truncating. Adjust the card's vertical layout to accommodate the extra line(s) so nothing overlaps. Applies to the mob/enemy skill line in raid/boss/dev-battle renders.

## 7. Embed update cadence changes
- **Raid:** change snapshot/edit cadence from odd rounds (1,3,5,…) to rounds **1, 4, 7, 10, …** (every 3rd round starting at 1) + final state. This means FEWER edits — animation gets shorter, so it stays well under the reaper. Recompute and report the new worst-case raid animation duration.
- **Duel:** change from every round (1,2,3,4,5,…) to rounds **1, 4, 7, 10, …** + final state. Also fewer edits.
- Update the mode-keyed snapshot logic in the engine accordingly (boss mode unchanged — no animation). Update any self-test snapshot-cadence assertion to the new round tags. Patch Master §13/§14 `[v4.8]`: raid/duel embed updates on rounds 1,4,7,10,….

## 8. Per-command cooldowns
Adjust the cooldown values (keys remain per-command, buttons still not cooldown-gated):
- **`crd raid` → 25 seconds** (anti-spam).
- **All casino commands → 25 seconds** (coin toss, dice roll, baccarat, blackjack, slot machine, crash — anti-spam).
- **Everything else stays at 10 seconds** (bag, open, gacha/summon, weapon info, deity info, deity collection, equip, enhance, profile, cred, bestow, daily, quests, duel, etc.).
- Implement as a per-command cooldown config/map (so values are auditable in one place) rather than scattered literals. Patch Master `[v4.8]` wherever cooldowns are documented: raid 25s, casino 25s, all else 10s.

---

## BUILD, VALIDATE, COMMIT
`node --check` on touched files; selftest green (with updated snapshot-cadence assertions; casino payout integrity and outcomes unchanged — these are render/cadence/cooldown/new-read-only-command changes, no settlement math touched); confirm `crd cred` does not require a character and reads the balance correctly.

Report: files changed, the new raid worst-case animation duration, confirmation no settlement/outcome logic changed, whether the bag row exists pre-character (item 1), and the `[v4.8]` doc diff (§13, §14, cooldowns).

**Then COMMIT to `master` — Phase 10 is complete.** Use a clear commit message summarizing Phase 10 (full casino system: coin toss, dice roll, baccarat, blackjack, slot machine, crash) plus this wrap-up batch (crd cred, render tweaks, cadence 1-4-7-10, cooldowns raid/casino 25s). List the commit hash in your report.

I then restart and live-test: `crd cred` on a no-character account, the daily icon size, boss reward text, bestow icon, quest font, a raid with long-skill mob (Kapre) for the wrap, raid/duel cadence, and the 25s cooldowns on raid + a casino game.
