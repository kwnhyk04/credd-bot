'use strict';

const { Client, GatewayIntentBits, Options } = require('discord.js');
const { BOT_TOKEN, CLIENT_ID } = require('./src/config/config');
const { setupGlobalErrorHandlers } = require('./src/utils/errorHandler');
const { handleMessage } = require('./src/handlers/commandHandler');
const { handleInteraction } = require('./src/handlers/interactionHandler');
const { handleSlash } = require('./src/events/interactionCreate');
const { runMiddleware, isBanned } = require('./src/handlers/middleware');
const guildConfig = require('./src/handlers/guildConfigCache');
const { startBattleReaper } = require('./src/schedulers/battleReaper');
const { startResetScheduler } = require('./src/schedulers/resetScheduler');
const { startBossScheduler } = require('./src/schedulers/bossScheduler');
const { startSeasonScheduler } = require('./src/schedulers/seasonScheduler');
const pool = require('./src/db/pool');
const { auditWeaponEmojis, reconcileEmojiIds } = require('./src/utils/emojis');
const { recoverExpiredSessions } = require('./src/casino/sessionStore');
const { sweepCanvasCache, verifyCanvasCacheReady } = require('./src/utils/canvasCache');
const { syncSlashCommandsOnStart } = require('./src/utils/slashCommandSync');
const {
  discordImageAttachmentsAllowed,
  productionEgressIssues,
} = require('./src/utils/egressGuard');

setupGlobalErrorHandlers();

const CASINO_SWEEP_MS = 60_000;
const CANVAS_CACHE_SWEEP_MS = 6 * 3600_000;
let casinoSweepInterval = null;
let canvasCacheSweepInterval = null;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  makeCache: Options.cacheWithLimits({
    ...Options.DefaultMakeCacheSettings,
    MessageManager: 25,
    ReactionManager: 0,
    PresenceManager: 0,
    GuildMemberManager: {
      maxSize: 100,
      keepOverLimit: (member) => member.id === member.client.user?.id,
    },
    UserManager: 200,
    GuildEmojiManager: 500,
  }),
});

client.once('ready', async () => {
  console.log(`[credd] Logged in as ${client.user.tag}`);
  const egressIssues = productionEgressIssues();
  if (egressIssues.length > 0) {
    console.error('[credd] Refusing to start: production egress guard failed.');
    for (const issue of egressIssues) console.error(`[credd] - ${issue}`);
    process.exit(1);
  }
  if (!discordImageAttachmentsAllowed()) {
    try {
      await verifyCanvasCacheReady();
      console.log('[credd] Production egress guard ready: assets/canvas renders use R2 URLs.');
    } catch (err) {
      console.error('[credd] Refusing to start: canvas_cache is not ready:', err.message);
      console.error('[credd] Apply scripts/canvas-cache-schema.sql or set ALLOW_DISCORD_IMAGE_ATTACHMENTS=true intentionally.');
      process.exit(1);
    }
  } else if (!String(process.env.ASSET_BASE_URL || '').trim()) {
    console.warn(
      '[credd] ASSET_BASE_URL is NOT set — static images will be re-uploaded to Discord '
      + 'on every command (billable egress). Set it to the R2 public bucket URL.'
    );
  }
  // Load per-guild config (prefix + channel ids) once — middleware reads from this cache (§1.2).
  try {
    const n = await guildConfig.loadAll();
    console.log(`[credd] Loaded server_config for ${n} guild(s).`);
  } catch (err) {
    console.error('[credd] server_config cache load failed:', err.message);
  }
  try {
    await syncSlashCommandsOnStart(client, { token: BOT_TOKEN, clientId: CLIENT_ID });
  } catch (err) {
    console.error('[commands] Slash-command sync failed:', err.message);
  }
  await startBattleReaper();
  startResetScheduler();
  startBossScheduler(client);
  startSeasonScheduler();
  // Emoji diagnostics (warn-only, never blocks startup).
  auditWeaponEmojis(pool);
  reconcileEmojiIds(client);
  // Pre-pad the fixed casino assets so the first spin isn't slow (background, non-blocking).
  require('./src/casino/casinoRender').prewarm();
  // Casino recovery sweep: refund expired stateful sessions (blackjack/crash) whose players
  // never came back — once at startup, then every 60s. A sweep failure must never crash the bot.
  recoverExpiredSessions({ reason: 'startup_recovery' })
    .catch((err) => console.error('[casinoSweep] startup sweep failed:', err.message));
  casinoSweepInterval = setInterval(() => {
    recoverExpiredSessions()
      .catch((err) => console.error('[casinoSweep] sweep failed:', err.message));
  }, CASINO_SWEEP_MS);
  // Canvas-cache eviction (no-op unless R2 write creds are configured).
  canvasCacheSweepInterval = setInterval(() => {
    sweepCanvasCache().catch((err) => console.error('[canvasCache] sweep failed:', err.message));
  }, CANVAS_CACHE_SWEEP_MS);
});

client.on('messageCreate', async (message) => {
  if (message.author?.bot || message.author?.id === client.user?.id) return;
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
  if (interaction.user?.bot || interaction.user?.id === client.user?.id) return;
  try {
    // Slash commands → the Phase-11 slash path; buttons/components → the existing handler.
    if (interaction.isChatInputCommand()) await handleSlash(interaction);
    else await handleInteraction(interaction);
  } catch (err) {
    console.error('[interactionCreate] Unhandled error:', err);
  }
});

// Graceful shutdown: stop the sweep, close Discord, drain the pool, exit clean.
// Postgres rolls back any transaction cut mid-flight, so money invariants hold.
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[credd] ${signal} received — shutting down.`);
  if (casinoSweepInterval) clearInterval(casinoSweepInterval);
  if (canvasCacheSweepInterval) clearInterval(canvasCacheSweepInterval);
  try { client.destroy(); } catch (err) { console.error('[credd] client.destroy failed:', err.message); }
  try { await pool.end(); } catch (err) { console.error('[credd] pool.end failed:', err.message); }
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

client.login(BOT_TOKEN);
