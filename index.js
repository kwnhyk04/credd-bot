'use strict';

require('dotenv').config();
require('./src/utils/imageRuntime').configureImageRuntime();

const {
  Client, GatewayIntentBits, Options, RESTEvents,
} = require('discord.js');
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
const { clearBossRuntimeForGuild } = require('./src/engine/bossSystem');
const pool = require('./src/db/pool');
const { verifyRequiredSchema } = require('./src/db/schemaGuard');
const { auditWeaponEmojis, reconcileEmojiIds } = require('./src/utils/emojis');
const { sweepCanvasCache, verifyCanvasCacheReady } = require('./src/utils/canvasCache');
const { syncSlashCommandsOnStart } = require('./src/utils/slashCommandSync');
const { envBool } = require('./src/utils/runtimeLogs');
const { startResourceMonitor } = require('./src/utils/resourceMonitor');
const { beginActivity, recordDiscordRestResponse } = require('./src/utils/networkTelemetry');
const {
  discordImageAttachmentsAllowed,
  productionEgressIssues,
} = require('./src/utils/egressGuard');

setupGlobalErrorHandlers();

const CASINO_SWEEP_MS = 60_000;
const CANVAS_CACHE_SWEEP_MS = 6 * 3600_000;
let casinoSweepInterval = null;
let canvasCacheSweepInterval = null;
let casinoSweepRunning = false;
let canvasCacheSweepRunning = false;
let stopResourceMonitor = null;
const stopSchedulers = [];

function casinoEnabled() {
  return envBool('CASINO_ENABLED', false);
}

async function runCasinoSweep(recoverExpiredSessions, reason = null) {
  if (casinoSweepRunning) return;
  casinoSweepRunning = true;
  const endActivity = beginActivity('scheduler.casino_recovery');
  try {
    await (reason ? recoverExpiredSessions({ reason }) : recoverExpiredSessions());
  } finally {
    casinoSweepRunning = false;
    endActivity();
  }
}

async function runCanvasCacheSweep() {
  if (canvasCacheSweepRunning) return;
  canvasCacheSweepRunning = true;
  const endActivity = beginActivity('scheduler.canvas_sweep');
  try {
    await sweepCanvasCache();
  } finally {
    canvasCacheSweepRunning = false;
    endActivity();
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  makeCache: Options.cacheWithLimits({
    ...Options.DefaultMakeCacheSettings,
    MessageManager: 5,
    ReactionManager: 0,
    ReactionUserManager: 0,
    PresenceManager: 0,
    GuildBanManager: 0,
    GuildInviteManager: 0,
    GuildScheduledEventManager: 0,
    GuildSoundboardSoundManager: 0,
    GuildStickerManager: 0,
    StageInstanceManager: 0,
    ThreadMemberManager: 0,
    VoiceStateManager: 0,
    AutoModerationRuleManager: 0,
    PollAnswerVoterManager: 0,
    GuildMemberManager: {
      maxSize: 100,
      keepOverLimit: (member) => member.id === member.client.user?.id,
    },
    UserManager: 200,
    GuildEmojiManager: 500,
  }),
  sweepers: {
    ...Options.DefaultSweeperSettings,
    messages: { interval: 300, lifetime: 300 },
  },
});

client.rest.on(RESTEvents.Response, recordDiscordRestResponse);

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
  stopSchedulers.push(await startBattleReaper());
  stopSchedulers.push(startResetScheduler());
  stopSchedulers.push(startBossScheduler(client));
  stopSchedulers.push(startSeasonScheduler());
  // Emoji diagnostics (warn-only, never blocks startup).
  auditWeaponEmojis(pool);
  reconcileEmojiIds(client);
  // Casino startup work is opt-in while public casino commands are disabled by default.
  if (casinoEnabled()) {
    console.log('[casino] Casino enabled; prewarm and recovery sweep active.');
    require('./src/casino/casinoRender').prewarm();
    const { recoverExpiredSessions } = require('./src/casino/sessionStore');
    // Casino recovery sweep: refund expired stateful sessions (blackjack/crash) whose players
    // never came back — once at startup, then every 60s. A sweep failure must never crash the bot.
    runCasinoSweep(recoverExpiredSessions, 'startup_recovery')
      .catch((err) => console.error('[casinoSweep] startup sweep failed:', err.message));
    casinoSweepInterval = setInterval(() => {
      runCasinoSweep(recoverExpiredSessions)
        .catch((err) => console.error('[casinoSweep] sweep failed:', err.message));
    }, CASINO_SWEEP_MS);
  } else {
    console.log('[casino] Casino disabled; prewarm and recovery sweep skipped.');
  }
  // Canvas-cache eviction (no-op unless R2 write creds are configured).
  canvasCacheSweepInterval = setInterval(() => {
    runCanvasCacheSweep().catch((err) => console.error('[canvasCache] sweep failed:', err.message));
  }, CANVAS_CACHE_SWEEP_MS);
  stopResourceMonitor = startResourceMonitor({ client });
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

client.on('guildDelete', (guild) => {
  guildConfig.deleteGuild(guild.id);
  clearBossRuntimeForGuild(guild.id);
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
  if (stopResourceMonitor) stopResourceMonitor();
  for (const stop of stopSchedulers.splice(0)) {
    try { if (typeof stop === 'function') stop(); } catch (err) {
      console.error('[credd] scheduler stop failed:', err.message);
    }
  }
  try { client.destroy(); } catch (err) { console.error('[credd] client.destroy failed:', err.message); }
  try { await pool.end(); } catch (err) { console.error('[credd] pool.end failed:', err.message); }
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

async function bootstrap() {
  try {
    await verifyRequiredSchema(pool);
  } catch (err) {
    console.error('[credd] Refusing to log in: database schema check failed:', err);
    await pool.end().catch(() => {});
    process.exitCode = 1;
    return;
  }
  await client.login(BOT_TOKEN);
}

bootstrap().catch((err) => {
  console.error('[credd] Startup failed:', err);
  process.exitCode = 1;
});
