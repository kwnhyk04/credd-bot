# Phase 11 — Approved. Proceed with the phased build.

Your reconnaissance is accepted in full. Defer to the real tree (root `index.js`, `src/handlers/`, `src/commands/{rpg,economy,casino}/`) over any path in the original prompt. Build in the incremental order you proposed, keeping `node --check` + self-tests green at every step.

## Decisions (H1–H4)
1. **Aliases:** Adopt `aliases.js` as the single routing source. Keep `sm → slot machine` and `g → cred` for back-compat *in addition to* the prompt's `sl`. Route everything through `aliases.js`; key `IMPLEMENTED` by canonical command only (drop the redundant direct alias keys). Add `(g)` to the `crd cred` help line and `(sm)` to the `crd slot machine` help line so both are discoverable.
2. **Refactor style:** Incremental, handler-by-handler, green throughout. Approved.
3. **Doc tag:** `[v4.9]`. Approved. Patch `CREDD_Master_Export_v4.2.md` with the help/admin/prefix/slash rules.
4. **Category filter + `/help` choices:** In scope. Include now.

## Signature & ctx — confirmed targets
- Refactor to `execute(ctx)`; handlers needing the client use `ctx.client`. Do not reintroduce a `client` positional arg.
- `ctx.reply()` **must return the sent `Message` on both paths** (slash via `fetchReply: true` / `fetchReply()`). This is a hard requirement, not an implementation nicety — `bestow.js`, `duel.js`, and the casino CV2 flows attach `createMessageComponentCollector` to the returned message, and they must keep working unchanged on the slash path. Verify each collector still binds after the refactor.
- Components V2 payloads (`flags: IsComponentsV2`) pass through `reply`/`editReply` unchanged on both paths.
- `ephemeral` is honored only on the slash path (bot-channel rejection + error fallback). No-op on prefix.

## interactionCreate — integrate, do not duplicate
- Keep the existing button handler exactly as-is. In `index.js`: `isButton()` → existing `handleInteraction`; `isChatInputCommand()` → new `events/interactionCreate.js`. Button custom_id scoping and session locks stay untouched.

## Slash arg-assemblers — the load-bearing part
- This is the highest-risk item; get it right first. Each slash command defines, alongside its `SlashCommandBuilder`, an **arg-assembler** that reconstructs the exact canonical token array the existing prefix handler consumes — *including literal subcommand tokens* (`toss`, `chests`, `info`, `collection`, `equip`, `enhance`, etc.). `InteractionContext.args` is the output of that assembler, never raw options-in-order.
- The assembler is the single source of truth for a command's token contract. If a handler later changes its token shape, the assembler changes with it.

## server_config cache — unify
- Replace the lazy `getPrefix()` map + the separate per-command `bot_channel_id` SELECT with **one startup-loaded `guildConfigCache`** (prefix + all three channel IDs per guild). Middleware reads from cache; no per-command `server_config` SELECT remains on the hot path.
- `crd admin setprefix` / `setbotchannel` / `setannouncementchannel` / `setbosschannel` update the DB (UPSERT) **and** the cache in the same code path. No stale reads.

## Selftest — one addition
- `help-selftest.js` keeps your four checks, **plus**: assert every slash command in `slashDefinitions.js` has a registered arg-assembler. A missing assembler must fail the selftest (exit 1), not fail live.

## Guardrails (unchanged)
- No DDL. `server_config` used as-is (`prefix VARCHAR(5)` — keep `setprefix` validation at 1–5 chars, alphanumeric, reject `crd` and `/`).
- Frozen: schema, `summonEngine.js`, `passiveRegistry.js`, battle/casino engine RNG, `statAssembly.js`, `.env` file. Document `GUILD_IDS` (new, optional) + `CLIENT_ID` (exists) in the deploy-script header only.
- `dev.js` takes the `ctx` signature but stays prefix-only (no slash). Dev section in `crd help` shown only when `DEV_IDS.includes(ctx.userId)`.

Proceed. Stop and flag if the collector-rebind on any slash path (bestow/duel/casino) can't preserve the existing behavior — that's the one place I want a heads-up before you finalize.
