'use strict';

/**
 * interactionCreate.js — the SLASH command path (Phase 11, §3.4). Button interactions are NOT
 * handled here; index.js still routes those to the existing handlers/interactionHandler.js.
 *
 * Flow: resolve the slash def → assemble the canonical token array + User mentions → build an
 * InteractionContext → run the SAME middleware the prefix path uses (so a bot-channel/cooldown
 * rejection replies EPHEMERALLY, before any defer) → deferReply (Canvas/battle commands need it,
 * and it's harmless for instant ones) → dispatch the SAME handler the prefix path calls.
 */

const { byName } = require('../commands/slashDefinitions');
const { IMPLEMENTED, COMMAND_MAP } = require('../handlers/commandHandler');
const { runMiddleware, isBanned } = require('../handlers/middleware');
const { InteractionContext } = require('../utils/commandContext');

async function handleSlash(interaction) {
  if (!interaction.isChatInputCommand()) return;
  const entry = byName.get(interaction.commandName);
  if (!entry) return;
  const impl = IMPLEMENTED[entry.canonical];
  if (!impl || impl.mw === 'dev') return; // dev commands have no slash equivalent

  const { args, mentions } = entry.assemble(interaction);
  const ctx = new InteractionContext(interaction, args, mentions);

  try {
    if (impl.mw === 'ban') {
      if (await isBanned(ctx.userId)) return; // silent, like the prefix path
    } else {
      const requiresCharacter = COMMAND_MAP[entry.canonical]?.requiresCharacter ?? false;
      const allowed = await runMiddleware(ctx, { requiresCharacter, commandKey: entry.canonical });
      if (!allowed) return; // middleware already replied (ephemeral)
    }
    // Defer AFTER middleware so rejections stay ephemeral & undeferred; reply() now → editReply.
    await ctx.deferReply();
    await impl.run(ctx, { args: ctx.args });
  } catch (err) {
    console.error('[interactionCreate] slash error:', err);
    try {
      await ctx.reply({ content: 'Something went wrong.', ephemeral: true });
    } catch { /* interaction may be gone */ }
  }
}

module.exports = { handleSlash };
