'use strict';

const { Client, GatewayIntentBits } = require('discord.js');
const { BOT_TOKEN } = require('./src/config/config');
const { setupGlobalErrorHandlers } = require('./src/utils/errorHandler');
const { handleMessage } = require('./src/handlers/commandHandler');
const { handleInteraction } = require('./src/handlers/interactionHandler');
const { handleSlash } = require('./src/events/interactionCreate');
const { runMiddleware, isBanned } = require('./src/handlers/middleware');
const guildConfig = require('./src/handlers/guildConfigCache');
const { startBattleReaper } = require('./src/schedulers/battleReaper');
const { startResetScheduler } = require('./src/schedulers/resetScheduler');
const { startBossScheduler } = require('./src/schedulers/bossScheduler');
const pool = require('./src/db/pool');
const { auditWeaponEmojis, reconcileEmojiIds } = require('./src/utils/emojis');

setupGlobalErrorHandlers();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once('ready', async () => {
  console.log(`[credd] Logged in as ${client.user.tag}`);
  // Load per-guild config (prefix + channel ids) once — middleware reads from this cache (§1.2).
  try {
    const n = await guildConfig.loadAll();
    console.log(`[credd] Loaded server_config for ${n} guild(s).`);
  } catch (err) {
    console.error('[credd] server_config cache load failed:', err.message);
  }
  await startBattleReaper();
  startResetScheduler();
  startBossScheduler(client);
  // Emoji diagnostics (warn-only, never blocks startup).
  auditWeaponEmojis(pool);
  reconcileEmojiIds(client);
  // Pre-pad the fixed casino assets so the first spin isn't slow (background, non-blocking).
  require('./src/casino/casinoRender').prewarm();
});

client.on('messageCreate', async (message) => {
  try {
    await handleMessage(message, { runMiddleware, isBanned });
  } catch (err) {
    console.error('[messageCreate] Unhandled error:', err);
    try {
      await message.reply({
        content: 'An unexpected error occurred.',
        allowedMentions: { repliedUser: false },
      });
    } catch {
      // channel gone, nothing to do
    }
  }
});

client.on('interactionCreate', async (interaction) => {
  try {
    // Slash commands → the Phase-11 slash path; buttons/components → the existing handler.
    if (interaction.isChatInputCommand()) await handleSlash(interaction);
    else await handleInteraction(interaction);
  } catch (err) {
    console.error('[interactionCreate] Unhandled error:', err);
  }
});

client.login(BOT_TOKEN);
