'use strict';

const { Client, GatewayIntentBits } = require('discord.js');
const { BOT_TOKEN } = require('./src/config/config');
const { setupGlobalErrorHandlers } = require('./src/utils/errorHandler');
const { handleMessage } = require('./src/handlers/commandHandler');
const { handleInteraction } = require('./src/handlers/interactionHandler');
const { runMiddleware, isBanned } = require('./src/handlers/middleware');
const { startBattleReaper } = require('./src/schedulers/battleReaper');
const { startResetScheduler } = require('./src/schedulers/resetScheduler');
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
  await startBattleReaper();
  startResetScheduler();
  // Emoji diagnostics (warn-only, never blocks startup).
  auditWeaponEmojis(pool);
  reconcileEmojiIds(client);
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
    await handleInteraction(interaction);
  } catch (err) {
    console.error('[interactionCreate] Unhandled error:', err);
  }
});

client.login(BOT_TOKEN);
