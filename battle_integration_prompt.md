# TASK: Integrate battle.js — this embed design becomes the battle system UI

I dumped `battle.js` in the **project root**. Move it into the correct folder for this project (detect the existing structure first — commands/, handlers/, utils/, src/ — and follow the same convention used by other modules), then fix its imports/relative paths to match the new location.

## What battle.js is
The new presentation + flow layer for the battle commands:
- `simulateBattle(p1, p2, seed)` — resolves the ENTIRE fight up-front and returns per-turn logs + snapshots every 3 turns. Contains placeholder formulas (variance, DEF mitigation, crit, weapon proc/debuff).
- `renderBattlePanel(sim, snapIdx, { mirror })` — Canvas render of the two fighter cards: name · class, weapon | deity line, HP text, HP bar, ATK/DEF/CRIT row. `mirror: true` flips fighter 2's card (name/loadout on the RIGHT, HP on the LEFT, bar drains from the opposite side).
- `runBattle(channel, { mode, p1, p2, userId })` — sends the embed at full green HP, EDITS it with a snapshot every 3 turns (`UPDATE_MS`), final edit shows Victory/Defeat + **Battle Log** and **Replay** buttons.

## Integration rules
1. **This replaces the current battle UI.** Wire the EXISTING battle commands to `runBattle`:
   - `crd raid ...` → `mode: 'raid'` (player vs monster, both cards left-aligned)
   - `crd duel @user` → `mode: 'duel'` (PvP, fighter 2 mirrored). Build p2 from the mentioned user's saved loadout; reject self-duels and duels against users with no profile.
2. **Use the PROJECT'S battle formulas, not mine.** If this project already has damage/crit/proc/debuff logic, port it INTO `simulateBattle` (or have `simulateBattle` call the existing engine) so backend math stays the single source of truth. My formulas are placeholders — the existing engine wins on any conflict. The contract that must remain: the whole fight is resolved BEFORE any message is sent, with per-turn event logs and snapshots every `SNAPSHOT_EVERY` (3) turns.
3. **Fighter objects**: map the project's real player/monster data into `{ name, cls, weapon, deity, hp, atk, def, crit, procChance }`. Pull equipped weapon + deity names from the user's saved loadout; monsters come from the existing mob/raid tables.
4. **Embed behavior** (already implemented — do not break):
   - Embed updates every 3 turns from full green HP; bar/HP-text color: >50% green, >25% orange, else red. Embed side-bar color: gold in progress, green victory, red defeat.
   - Every edit passes `attachments: []` (required to drop the previous panel image).
   - **Battle Log** button → ephemeral reply with EVERY turn's events (auto-paginates at ~3800 chars). All per-turn formula detail lives here, since the embed itself only shows every 3rd turn.
   - **Replay** button → re-animates the SAME simulation. Must never re-roll. Initiator-only.
5. **Canvas setup**:
   - Detect which canvas package the project uses (`canvas` vs `@napi-rs/canvas`) and adjust the single require in battle.js.
   - Register a font at startup and set `FONT` in battle.js to that family. CRITICAL: color emoji (⚔️ 💀 🏹 🌊) do NOT render in node canvas on Linux — they become empty boxes. Either register an emoji-capable font that's confirmed working in this project's existing renders, or replace canvas-drawn emoji with safe glyphs (⚔ ☠ ➹ ≋) / small PNG icons from assets. Embed TEXT emoji are fine — this only concerns text drawn inside the canvas panel.
6. **Rate limits**: keep `UPDATE_MS` ≥ 1500ms (each snapshot is an edit with a fresh attachment). If existing config defines battle animation speed or max turns, use it instead of the constants in battle.js.
7. Reuse the project's existing win/lose consequences untouched (loot drops, XP, shard rewards, cooldowns) — trigger them from the simulation result (`sim.winner`), not from anything UI-side.

## Acceptance checklist
- [ ] battle.js moved to the proper folder; imports/paths fixed; old battle UI code removed or bypassed
- [ ] `crd raid` and `crd duel @user` both run through `runBattle`; duel renders fighter 2 mirrored
- [ ] Fight fully resolved backend-first using the PROJECT'S formulas; embed animates every 3 turns with correct HP colors
- [ ] Battle Log shows all turns (paginated, ephemeral); Replay replays the same result without re-rolling
- [ ] No tofu/empty-box glyphs in the rendered panel
- [ ] Loot/XP/rewards still granted exactly as before, driven by sim outcome
- [ ] Dry-run test both commands (win and lose cases) before finishing
