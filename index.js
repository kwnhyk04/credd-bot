'use strict';

const { Client, GatewayIntentBits } = require('discord.js');
const { BOT_TOKEN } = require('./src/config/config');
const { setupGlobalErrorHandlers } = require('./src/utils/errorHandler');
const { handleMessage } = require('./src/handlers/commandHandler');
const { runMiddleware } = require('./src/handlers/middleware');
const { startBattleReaper } = require('./src/schedulers/battleReaper');
const { startResetScheduler } = require('./src/schedulers/resetScheduler');

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
});

client.on('messageCreate', async (message) => {
  try {
    await handleMessage(message, { runMiddleware });
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

client.login(BOT_TOKEN);
