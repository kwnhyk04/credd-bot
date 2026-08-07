'use strict';

/**
 * BOSS SYSTEM — Master §16 (persistent active bosses, boss art) + Phase 7 prompt.
 *
 * One active boss per guild (boss_state, PK guild_id). The scheduler tick
 * (schedulers/bossScheduler.js) drives spawn/defeat-recovery; the
 * ⚔️ Attack and 📋 Log buttons route here from interactionHandler.
 *
 * Core invariants:
 *  - Spawn/defeat transitions are ATOMIC SQL guards (status checks in
 *    the WHERE clause) — overlapping ticks or button presses can never
 *    double-apply a transition.
 *  - Attack commit: UPDATE boss_state GREATEST(current_hp − net, 0) serialized
 *    by the row lock; damage committed = sim.totals.netDamage (Hydra local
 *    regen excluded — the shared pool is never healed, §16/§35.5). The
 *    rollback path ("boss just fell") consumes NO daily lock.
 *  - Defeat distribution shares ONE transaction with the status flip
 *    'active'→'dead' — idempotency is structural: a crash rolls everything
 *    back (boss stays active at 0 HP, attacks blocked by current_hp > 0) and
 *    the next tick re-runs distribution. No double-pay, no lost pay.
 *  - expires_at = NOW() on defeat anchors the 15-min respawn clock (schema has
 *    no died_at). Active bosses use a far-future compatibility value and never
 *    transition out of active due to elapsed time.
 *  - Lock order everywhere: users_bag (sorted) → user_character (sorted) —
 *    Phase-5 convention, deadlock-safe vs. concurrent raid commits.
 *
 * In-memory only (by design — schema holds no message pointer):
 *  - liveMessages: guild → {channelId, messageId} of the tracked boss message.
 *    Any failed edit/fetch → post a FRESH status message and repoint (covers
 *    restarts, deleted messages, "attacked on an expired message").
 *  - logCache: `${spawnId}:${userId}` → resolved sim for the 📋 Log button
 *    (lost on restart — accepted; purged per guild on each new spawn).
 */

const fs = require('fs');
const path = require('path');
const {
  ContainerBuilder, ButtonBuilder, ButtonStyle,
  MessageFlags, PermissionFlagsBits,
} = require('discord.js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const pool = require('../db/pool');
const guildConfig = require('../handlers/guildConfigCache');
const { resolveBattle } = require('./battleEngine');
const {
  buildPlayerFighter, buildBossFighter, computeBossStats, fetchAllBosses, fetchMobByName,
} = require('./statAssembly');
const { logEmbeds, showPaginatedBattleLog } = require('./battleRender');
const { awardCombatExpMany } = require('../utils/awardCombatExp');
const { formatLevelRewardLine } = require('../config/levelRewards');
const { isBanned } = require('../handlers/middleware');
const { smallDivider: sep } = require('../utils/componentsV2');
const { emojiForDisplay } = require('../utils/emojis');
const { grantTitles } = require('../utils/titleGrant');
const { allocateRaidRewardLimits } = require('../utils/raidRewardLimits');
const {
  assetPath,
  assetSignatureSync,
  clearAssetCacheFor,
  isRemoteAssetsEnabled,
  isRemoteSource,
  loadAssetImage: loadAssetImageSource,
  localAssetPath,
  readAssetText,
} = require('../utils/assets');
const { getCachedCanvasUrl } = require('../utils/canvasCache');
const { makeOptimizedAttachment, attachmentFromOptimizedImage } = require('../utils/imageOutput');
const { discordImageAttachmentsAllowed } = require('../utils/egressGuard');
const { encodeOpaqueCanvas } = require('../utils/canvasEncode');
const r2 = require('../utils/r2Client');
const {
  envBool, envNumber, envPositiveInt, bandwidthLog, performanceLog,
} = require('../utils/runtimeLogs');
const { registerMemorySource } = require('../utils/memoryRegistry');
const { beginActivity } = require('../utils/networkTelemetry');
const { bossFeatTitlesFor } = require('../config/titles');
const {
  isGreaterBoss, isCalamityBoss, bossRewards, rollBossChest, hpMultiplierForChest,
  bossMaxHpForChest, inferChestFromGreaterHp, bossChestForSpawn,
  pickWeightedBoss,
  MAX_BOSS_ATTACKS_PER_DAY, bossAttackDecision,
} = require('../config/bosses');
const {
  SUPREME_CHEST_REWARD,
  rollCalamitySupremeRewards,
} = require('./calamityRewards');
const {
  bossRedirectMessage,
  isOfficialGuild,
  supportMarkdownLink,
} = require('../config/officialSupport');
const {
  bossSlug,
  bossImagePath,
  bossImagePathForMessage,
  bossBanner,
  bossLore,
  bossPassiveText,
  bossStatusCardHeight,
  bossStatusText,
  bossStatusImage,
  renderBossStatusCard,
  trimBossBanners,
  dropBossBannersForPath,
  bossImageMaxWidth,
  bossCrit,
  renderMemoryStats,
  dropStatusUrlsForSpawn,
  dropStatusUrlsForGuild,
} = require('./boss/bossRender');
const {
  liveMessages,
  logCache,
  logCacheOrder,
  currentSpawn,
  pendingBossRefreshes,
  lastBossReconciliations,
  nonOfficialRedirects,
  greaterChests,
  devSpawns,
  bossProgressRefreshDebounceMs,
  bossLogCacheMaxAttackers,
  bossLogCacheMaxEventsPerAttacker,
  clearPendingBossRefresh,
  rememberSpawn,
  bossLogKey,
  compactBossSim,
  rememberBossLog,
  purgeBossRuntimeForSpawn,
  purgeBossRuntimeForGuild,
  clearBossRuntimeForGuild,
  chestForSpawn,
  getBossMemoryStats,
} = require('./boss/bossRuntime');

const RESPAWN_COOLDOWN = '15 minutes';   // spawns every 15 min after defeat
const RESPAWN_COOLDOWN_MS = 15 * 60_000;
const CALAMITY_CLAIM_TIMEOUT = '5 minutes';
const ACTIVE_BOSS_EXPIRES_AT_SQL = "NOW() + INTERVAL '100 years'";
const NON_OFFICIAL_REDIRECT_COOLDOWN_MS = 6 * 60 * 60_000;
const BOSS_PROGRESS_REFRESH_MAX_RETRIES = 2;
const BOSS_REFRESH_RECONCILE_COOLDOWN_MS = 10 * 60_000;
const TOP_N = 15;
const BOSS_STATE_COLUMNS = `
  guild_id, spawn_id, mob_id, max_hp, current_hp,
  scaled_atk, scaled_def, spawn_at, expires_at, status,
  spawn_source, last_attack_at, passive_state
`;
const MOB_BATTLE_COLUMNS = `
  mob_id, name, mythology, mob_type, base_hp, hp_per_level, base_atk,
  atk_per_level, base_def, def_per_level, base_crit, skill_key,
  skill_name, skill_description, immunity_tags, special_flags
`;
// §16 participation rewards come from config/bosses (bossRewards) — normal vs Greater.

// Spawn-header flavor line shown above an active boss's name (keyed by mythology).
const BOSS_FLAVOR = {
  PH: '🌒 *An old terror of the islands stirs…*',
  Norse: '🌒 *An ancient dread of the nine realms awakens…*',
  Greek: '🌒 *A monster of myth crawls into the light…*',
  _default: '🌒 *An old terror stirs…*',
};
// [v4.4] Greater Boss spawn header — distinct apex framing above the boss name.
const GREATER_FLAVOR = '☠️ **GREATER BOSS** — *A world-ender awakes…*';


function bossImageRefreshEnabled() {
  return envBool('BOSS_IMAGE_REFRESH_ENABLED', true);
}


// [Progression v2] The override ceiling is DERIVED from the design cap, additively.
// Boss EXP scales with participant level, so the daily attack cap is what keeps bosses
// a minority EXP source (~14% at level 100) instead of the dominant one. The old
// { max: 100 } ceiling let one env var take bosses to 89% of throughput and collapse
// time-to-level-100 from ~5.6 years to ~0.7. The ceiling is ADDITIVE (+2, not x2)
// because the case it exists for — granting players a retry after a boss bug — is a
// fixed quantity, not a proportion of the cap. A multiplier would scale the blast
// radius with the cap (a cap of 10 permitting 20); +2 stays one retry forever.
// Anything beyond that should be a reviewed code change, not a deploy-config edit.
const BOSS_DAILY_ATTACK_LIMIT_MAX = MAX_BOSS_ATTACKS_PER_DAY + 2;

function bossDailyAttackLimit() {
  // §1.4: cap lives in config (MAX_BOSS_ATTACKS_PER_DAY); env may override for ops.
  return envPositiveInt('BOSS_DAILY_ATTACK_LIMIT', MAX_BOSS_ATTACKS_PER_DAY, {
    max: BOSS_DAILY_ATTACK_LIMIT_MAX,
  });
}

// Startup diagnostic: an overridden cap is legitimate but must never be silent, since
// it moves the progression curve by months. Fires once when this module is first
// required, which happens during boot when the boss commands load. The ceiling above
// is the actual guard — this is visibility, not enforcement.
(function warnIfBossLimitOverridden() {
  const effective = bossDailyAttackLimit();
  if (effective === MAX_BOSS_ATTACKS_PER_DAY) return;
  console.warn(
    `[boss] BOSS_DAILY_ATTACK_LIMIT override active: ${effective} attacks/day `
    + `(design cap ${MAX_BOSS_ATTACKS_PER_DAY}, ceiling ${BOSS_DAILY_ATTACK_LIMIT_MAX}). `
    + 'Boss EXP scales with participant level — this accelerates progression. '
    + 'Unset the variable to restore the modeled curve.'
  );
})();


// Serialize an attacker's boss sim for the log cache. Keep EVERY turn/event so the
// paginated viewer can start at Turn 1 and reach every turn — the char-safe pager
// (battleRender.logEmbeds) handles Discord's limits, so nothing is truncated here.
// Only the serializable log fields are retained (no player/canvas/engine objects),
// and the cache stays bounded by the per-spawn attacker cap in rememberBossLog.


/**
 * [v4.6] The chest outcome for a spawn — the ONE place announcement and payout agree.
 * Normal bosses get one deterministic Boss Treasure Chest. Greater bosses roll 75/25 once
 * and cached by spawn_id, so every read (announcement, every attacker's payout) is identical.
 */


// Ordinary dev-spawned bosses are test fixtures and bypass the daily cap. A
// dev-spawned Calamity still follows the regular Calamity attack rules.
function devBossHasUnlimitedAttacks(state, mobRow) {
  return state?.spawn_source === 'dev' && !isCalamityBoss(mobRow?.name);
}

/** Fetch everything the message needs in one place. Null when no boss_state row. */
async function fetchBossView(guildId) {
  const stateRes = await pool.query(
    `SELECT guild_id, spawn_id, mob_id, max_hp, current_hp,
            scaled_atk, scaled_def, spawn_at, expires_at, status,
            spawn_source, last_attack_at, passive_state
       FROM boss_state
      WHERE guild_id = $1`,
    [guildId]
  );
  if (stateRes.rows.length === 0) return null;
  const state = stateRes.rows[0];
  const [mobRes, atkRes, countRes] = await Promise.all([
    pool.query(
      `SELECT mob_id, name, mythology,
              base_hp, hp_per_level, base_atk, atk_per_level,
              base_def, def_per_level, base_crit,
              skill_name, skill_description
         FROM mob_roster
        WHERE mob_id = $1`,
      [state.mob_id]
    ),
    pool.query(
      `SELECT discord_id, total_damage FROM boss_attack_log
        WHERE boss_spawn_id = $1
        ORDER BY total_damage DESC, attacked_at ASC
        LIMIT $2`,
      [state.spawn_id, TOP_N]
    ),
    pool.query(
      `SELECT count(*)::int AS attacker_count FROM boss_attack_log
        WHERE boss_spawn_id = $1`,
      [state.spawn_id]
    ),
  ]);
  if (mobRes.rows.length === 0) return null;
  return {
    state,
    mobRow: mobRes.rows[0],
    attackers: atkRes.rows,
    attackerCount: Number(countRes.rows[0]?.attacker_count || 0),
    isDev: state.spawn_source === 'dev',
  };
}

/**
 * Full CV2 payload (components + files + flags) for the current view.
 * Layout: "## <Boss>" header → separator → banner image → boss status canvas →
 * separator → lore → separator → rewards → separator → Top 15 → separator →
 * footer + buttons.
 */
async function buildBossMessage(view, {
  includeStatusImage = true,
  includeBanner = true,
  bannerUrl = null,
  forceAssetRefresh = false,
  phase = 'snapshot',
  telemetryCommand = 'boss',
} = {}) {
  const { state, mobRow, attackers, attackerCount, isDev = false } = view;
  const { status } = state;

  const greater = isGreaterBoss(mobRow.name);
  const calamity = isCalamityBoss(mobRow.name);
  const unlimitedDev = isDev && !calamity;
  const spawnChest = chestForSpawn(state.spawn_id, mobRow.name, {
    baseHp: mobRow.base_hp,
    maxHp: state.max_hp,
    spawnSource: state.spawn_source,
  });
  const reward = bossRewards(mobRow.name, spawnChest);

  // header — evocative flavor line (mythology-flavored, or Greater apex framing) above
  // the boss name; terminal states swap the flavor for a small status subtext
  let header;
  if (status === 'active') {
    const flavor = calamity ? '☄️ **CALAMITY BOSS** — *A catastrophe takes form…*'
      : greater ? GREATER_FLAVOR : (BOSS_FLAVOR[mobRow.mythology] || BOSS_FLAVOR._default);
    header = `${flavor}\n## ${mobRow.name}`;
  } else {
    header = `## ${mobRow.name}`;
    if (status === 'dead') header += '\n-# 💀 Slain by the united server — rewards distributed!';
    else if (status === 'escaped') header += '\n-# No rewards were distributed.';
  }

  const accent = status === 'active' ? 0xf0b232 : status === 'dead' ? 0x43d675 : 0x95a5a6;
  const container = new ContainerBuilder()
    .setAccentColor(accent)
    .addTextDisplayComponents((td) => td.setContent(header))
    .addSeparatorComponents(sep);

  // boss art, letterboxed full-width + centered (mob_roster has no image
  // column — filename derived by convention)
  const files = [];
  let bannerAdded = false;
  const imgPath = includeBanner
    ? await bossImagePathForMessage(mobRow.name, { forceAssetRefresh })
    : null;
  if (imgPath && bannerUrl) {
    container.addMediaGalleryComponents((g) =>
      g.addItems((item) => item.setURL(bannerUrl))
    );
    bannerAdded = true;
  } else if (imgPath && isRemoteSource(imgPath)) {
    container.addMediaGalleryComponents((g) =>
      g.addItems((item) => item.setURL(imgPath))
    );
    bannerAdded = true;
  } else {
    // Progress/final refreshes prefer an existing remote/CDN URL. The recovery
    // caller opts into one local attachment only when no reusable banner exists.
    const banner = imgPath && includeBanner !== 'remote-only'
      ? await bossBanner(imgPath)
      : null;
    if (banner && discordImageAttachmentsAllowed()) {
      const card = await makeOptimizedAttachment(banner, 'boss_banner', {
        maxWidth: bossImageMaxWidth(),
        logContext: {
          system: 'boss',
          command: telemetryCommand,
          imageType: 'boss_banner',
          guildId: state.guild_id,
          phase,
          bytes: banner.length,
        },
      });
      files.push(card.file);
      container.addMediaGalleryComponents((g) =>
        g.addItems((item) => item.setURL(card.url))
      );
      bannerAdded = true;
    } else if (banner) {
      performanceLog('boss banner skipped, text-only fallback used', {
        system: 'boss',
        command: telemetryCommand,
        imageType: 'boss_banner',
        guildId: state.guild_id,
        spawnId: state.spawn_id,
        phase,
        reason: 'attachments-blocked',
      });
    }
  }

  if (bannerAdded) container.addSeparatorComponents(sep);
  if (includeStatusImage) {
    try {
      const card = await bossStatusImage(state, mobRow, { phase, telemetryCommand });
      if (card?.url) {
        if (card.file) files.push(card.file);
        container.addMediaGalleryComponents((g) =>
          g.addItems((item) => item.setURL(card.url))
        );
      } else {
        container.addTextDisplayComponents((td) => td.setContent(bossStatusText(state, mobRow)));
      }
    } catch (err) {
      console.warn('[boss] status card render failed:', err.message);
      performanceLog('boss image skipped, text-only fallback used', {
        system: 'boss',
        command: telemetryCommand,
        imageType: 'boss_status',
        guildId: state.guild_id,
        spawnId: state.spawn_id,
        phase,
        reason: 'render-failed',
      });
      container.addTextDisplayComponents((td) => td.setContent(bossStatusText(state, mobRow)));
    }
  } else {
    bandwidthLog('boss status render skipped', {
      system: 'boss',
      command: telemetryCommand,
      imageType: 'boss_status',
      guildId: state.guild_id,
      spawnId: state.spawn_id,
      phase,
      reason: 'status-image-disabled',
    });
    container.addTextDisplayComponents((td) => td.setContent(bossStatusText(state, mobRow)));
  }

  // lore — plain text wraps to the embed width on its own
  const lore = await bossLore(mobRow.name);
  if (lore) {
    container
      .addSeparatorComponents(sep)
      .addTextDisplayComponents((td) => td.setContent(`-# ${lore}`));
  }

  // Participation rewards are fixed by the same spawn variant as HP and chest.
  const creduxIcon = emojiForDisplay('Credux Coin', '💰');
  const expIcon = emojiForDisplay('Combat Exp', '✨');
  const chestIcon = emojiForDisplay('Boss Treasure Chest', '🗝️');
  const goldChestIcon = emojiForDisplay('Boss Golden Chest', '🪙');
  const supremeChestIcon = emojiForDisplay('Supreme Chest', '👑');
  const shardIcon = emojiForDisplay('Belief Shards', '🔮');
  // [v4.6] Greater chest is rolled ONCE at spawn — show the ACTUAL chest this fight awards
  // (not the 75/25 rule), keyed off the same source the payout uses so they never disagree.
  const spawnChestIcon = spawnChest.column === 'supreme_chest'
    ? supremeChestIcon : spawnChest.column === 'boss_golden_chest' ? goldChestIcon : chestIcon;
  // [v4.8] drop the "(this fight)" qualifier — redundant; rewards are understood to be this boss's.
  const chestLine = `${spawnChestIcon} ${spawnChest.label} ×${spawnChest.qty}`;
  const calamityBonusBlock = calamity
    ? `\n\n**Bonus Rewards**\n${supremeChestIcon} Supreme Chest ×1\n-# *Chance per eligible participant, weighted by damage contribution.*`
    : '';
  container
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent(
      `**Participation rewards if defeated:**${calamity ? '  ☄️ *Calamity*' : greater ? '  ☠️ *Greater*' : ''}\n` +
      `${creduxIcon} Credux ×${reward.credux.toLocaleString()}\n` +
      `${expIcon} Combat EXP ×${reward.exp.toLocaleString()}\n` +
      `${chestLine}\n` +
      `${shardIcon} Belief Shards ×${reward.shards.toLocaleString()}` +
      calamityBonusBlock
    ));

  // damage leaderboard
  const lbRows = attackers.slice(0, TOP_N).map((a, i) =>
    `**#${i + 1}** · <@${a.discord_id}> · ${Number(a.total_damage).toLocaleString()}`);
  container
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent(
      `🏆 **Top 15 Damage — out of ${attackerCount} challenger${attackerCount === 1 ? '' : 's'}**\n` +
      (lbRows.length > 0 ? lbRows.join('\n') : '-# No challengers yet — be the first!')
    ));

  let footerText;
  if (status === 'active') {
    footerText = unlimitedDev
      ? '-# The boss remains until defeated. 🧪 Dev boss — unlimited attacks.'
      : `-# The boss remains until defeated. ⚔️ ${bossDailyAttackLimit()} boss attacks per player per day.`;
  } else if (status === 'dead') {
    footerText = `-# Rewards distributed to all ${attackerCount} challenger${attackerCount === 1 ? '' : 's'}.`;
  } else {
    footerText = '-# No rewards were distributed.';
  }
  container
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent(footerText));
  // Attack only while active; the Log button stays on terminal states too so an
  // attacker can still review the blow-by-blow (logCache lives until the next spawn).
  const logBtn = new ButtonBuilder().setCustomId(`boss:log:${state.guild_id}`)
    .setLabel('Log').setEmoji('📋').setStyle(ButtonStyle.Secondary);
  if (status === 'active') {
    container.addActionRowComponents((row) => row.setComponents(
      new ButtonBuilder().setCustomId(`boss:attack:${state.guild_id}`)
        .setLabel('Attack').setEmoji('⚔️').setStyle(ButtonStyle.Danger),
      logBtn,
    ));
  } else {
    container.addActionRowComponents((row) => row.setComponents(logBtn));
  }

  return {
    components: [container],
    files,
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

/* ── live-message management ────────────────────────────────────────────── */
async function resolveAnnounceChannelId(guildId) {
  return guildConfig.getConfig(guildId).boss_announcement_channel_id || null;
}

function redirectChannelIssue(channel, guildId, botUser) {
  if (channel.guildId !== guildId) return `channel belongs to guild ${channel.guildId || 'unknown'}`;
  if (typeof channel.isTextBased !== 'function' || !channel.isTextBased()) {
    return 'channel is not text-based';
  }
  if (typeof channel.isSendable === 'function' && !channel.isSendable()) {
    return 'channel type is not sendable';
  }
  const permissions = typeof channel.permissionsFor === 'function'
    ? channel.permissionsFor(botUser)
    : null;
  if (!permissions?.has(PermissionFlagsBits.ViewChannel)) return 'missing View Channel';
  const sendPermission = typeof channel.isThread === 'function' && channel.isThread()
    ? PermissionFlagsBits.SendMessagesInThreads
    : PermissionFlagsBits.SendMessages;
  if (!permissions.has(sendPermission)) {
    return channel.isThread?.() ? 'missing Send Messages in Threads' : 'missing Send Messages';
  }
  if (channel.isThread?.() && channel.archived) return 'thread is archived';
  if (channel.isThread?.() && channel.joined === false && channel.joinable === false) {
    return 'bot is not in the thread and cannot join it';
  }
  return null;
}

function warnRedirectFailure(guildId, channelId, channel, reason) {
  console.warn('[boss] official redirect skipped', {
    guildId,
    channelId,
    channelType: channel?.type ?? 'unresolved',
    reason,
  });
}

function warnLivePostFailure(guildId, channelId, channel, reason) {
  console.warn('[boss] live message skipped', {
    guildId,
    channelId,
    channelType: channel?.type ?? 'unresolved',
    reason,
  });
}

async function postOfficialRedirect(client, guildId, channelIdHint = null, { force = false } = {}) {
  const now = Date.now();
  const last = nonOfficialRedirects.get(guildId) || 0;
  if (!force && now - last < NON_OFFICIAL_REDIRECT_COOLDOWN_MS) return null;

  const channelId = channelIdHint || await resolveAnnounceChannelId(guildId);
  if (!channelId) return null;
  nonOfficialRedirects.set(guildId, now);

  let channel;
  try {
    channel = await client.channels.fetch(channelId);
  } catch (err) {
    warnRedirectFailure(guildId, channelId, null, `${err.code || 'fetch failed'}: ${err.message}`);
    return null;
  }
  if (!channel) {
    warnRedirectFailure(guildId, channelId, null, 'channel was not found');
    return null;
  }

  const issue = redirectChannelIssue(channel, guildId, client.user);
  if (issue) {
    warnRedirectFailure(guildId, channelId, channel, issue);
    return null;
  }

  if (channel.isThread?.() && channel.joined === false && channel.joinable) {
    try {
      await channel.join();
    } catch (err) {
      warnRedirectFailure(guildId, channelId, channel, `${err.code || 'thread join failed'}: ${err.message}`);
      return null;
    }
  }

  try {
    return await channel.send({
      content: bossRedirectMessage(),
      allowedMentions: { parse: [] },
    });
  } catch (err) {
    warnRedirectFailure(guildId, channelId, channel, `${err.code || 'send failed'}: ${err.message}`);
    return null;
  }
}

/** Post a fresh boss message in the configured (or hinted) channel and repoint the Map. */
async function postFreshLiveMessage(client, guildId, payload, channelIdHint = null) {
  const channelId = channelIdHint
    || liveMessages.get(guildId)?.channelId
    || await resolveAnnounceChannelId(guildId);
  if (!channelId) return null;

  let channel;
  try {
    channel = await client.channels.fetch(channelId);
  } catch (err) {
    warnLivePostFailure(guildId, channelId, null, `${err.code || 'fetch failed'}: ${err.message}`);
    return null;
  }
  if (!channel) {
    warnLivePostFailure(guildId, channelId, null, 'channel was not found');
    return null;
  }

  const issue = redirectChannelIssue(channel, guildId, client.user);
  if (issue) {
    warnLivePostFailure(guildId, channelId, channel, issue);
    return null;
  }

  if (channel.isThread?.() && channel.joined === false && channel.joinable) {
    try {
      await channel.join();
    } catch (err) {
      warnLivePostFailure(guildId, channelId, channel, `${err.code || 'thread join failed'}: ${err.message}`);
      return null;
    }
  }

  let msg;
  try {
    msg = await channel.send(payload);
  } catch (err) {
    warnLivePostFailure(guildId, channelId, channel, `${err.code || 'send failed'}: ${err.message}`);
    return null;
  }
  if (msg) liveMessages.set(guildId, { channelId: msg.channel.id, messageId: msg.id });
  return msg;
}

/** Make an externally-sent message (crd boss) the tracked live message. */
function repointLiveMessage(guildId, msg) {
  liveMessages.set(guildId, { channelId: msg.channel.id, messageId: msg.id });
}

/**
 * [Jun-2026 §8] Delete the tracked live boss message and forget it. Used when the spawn
 * countdown reaches 0 (escape) so the expired "Next spawn" card doesn't linger in the
 * channel. Already-deleted / missing-message (Unknown Message) is swallowed.
 */
async function deleteLiveMessage(client, guildId) {
  await clearPendingBossRefresh(guildId, 'live-message-deleted');
  const ref = liveMessages.get(guildId);
  liveMessages.delete(guildId);
  purgeBossRuntimeForGuild(guildId, 'live-message-deleted');
  if (!ref) return;
  const channel = await client.channels.fetch(ref.channelId).catch(() => null);
  const msg = channel ? await channel.messages.fetch(ref.messageId).catch(() => null) : null;
  if (msg) await msg.delete().catch(() => {}); // Unknown Message / already gone → ignore
}

/**
 * Re-render the tracked message from fresh DB state; ANY edit/fetch failure
 * (deleted message, restart-empty Map) → fresh message + repoint.
 */
async function refreshLiveMessage(client, guildId, options = {}) {
  const view = await fetchBossView(guildId);
  if (!view) return false;
  rememberSpawn(guildId, view.state.spawn_id);
  const shouldApply = typeof options.shouldApply === 'function'
    ? () => options.shouldApply(view)
    : () => true;
  if (!shouldApply()) return false;
  const ref = liveMessages.get(guildId);
  let msg = null;
  if (ref) {
    const channel = await client.channels.fetch(ref.channelId).catch(() => null);
    msg = channel ? await channel.messages.fetch(ref.messageId).catch(() => null) : null;
  }
  // A local spawn banner already lives on Discord. Reuse that CDN URL and
  // retain only its attachment ID during progress/final edits, avoiding both
  // a second upload and a visual downgrade. Old status attachments are not
  // retained, so they cannot accumulate across edits.
  const localBannerCanBeReused = options.includeBanner === 'remote-only'
    && !isRemoteSource(bossImagePath(view.mobRow.name));
  const existingBanner = localBannerCanBeReused
    ? [...(msg?.attachments?.values?.() || [])].find((attachment) => /^boss_banner\./i.test(attachment.name || ''))
    : null;
  // After a restart or deleted/legacy live message there is no Discord
  // attachment URL to reuse. Attach the local static banner once while
  // reconstructing/upgrading the live message; subsequent edits retain it by
  // ID and never upload it again.
  const needsLocalBannerAttachment = localBannerCanBeReused && !existingBanner;
  const payload = await buildBossMessage(view, {
    ...options,
    includeBanner: needsLocalBannerAttachment ? true : options.includeBanner,
    bannerUrl: existingBanner?.url || null,
  });
  if (!shouldApply()) return false;
  if (msg && shouldApply()) {
    const retainedAttachments = existingBanner?.id ? [{ id: existingBanner.id }] : [];
    const edited = await msg.edit({ ...payload, attachments: retainedAttachments }).catch(() => null);
    if (edited) return true;
  }
  // Preserve the status Canvas if an edit cannot be applied and the live
  // message must be reconstructed. This rare fallback may repeat an attempted
  // upload, but it does not change the command into a text-only presentation.
  if (!shouldApply()) return false;
  return Boolean(await postFreshLiveMessage(client, guildId, payload));
}

async function refreshLiveMessageProgress(client, guildId, {
  telemetryCommand = 'boss:attack', shouldApply = null,
} = {}) {
  const phase = String(telemetryCommand).startsWith('scheduler:') ? 'background' : 'progress';
  const includeStatusImage = bossImageRefreshEnabled();
  return refreshLiveMessage(client, guildId, {
    includeStatusImage,
    includeBanner: 'remote-only',
    phase,
    telemetryCommand,
    shouldApply,
  });
}

function scheduleBossLiveRefresh(client, guildId, {
  spawnId = null, retryAttempt = 0, telemetryCommand = 'boss:attack',
} = {}) {
  const existing = pendingBossRefreshes.get(guildId);
  if (existing) {
    existing.spawnId = spawnId || existing.spawnId;
    existing.telemetryCommand = telemetryCommand || existing.telemetryCommand;
    if (existing.running) existing.rerun = true;
    bandwidthLog('boss progress refresh coalesced', {
      system: 'boss',
      command: existing.telemetryCommand,
      imageType: 'boss_status',
      guildId,
      spawnId: existing.spawnId,
      debounceMs: bossProgressRefreshDebounceMs(),
    });
    return;
  }

  const debounceMs = bossProgressRefreshDebounceMs();
  bandwidthLog('boss progress refresh scheduled', {
    system: 'boss',
    command: telemetryCommand,
    imageType: 'boss_status',
    guildId,
    spawnId,
    debounceMs,
    retryAttempt,
  });

  let resolveDone;
  const pending = {
    timer: null,
    spawnId,
    retryAttempt,
    telemetryCommand,
    running: false,
    rerun: false,
    cancelled: false,
    finished: false,
    done: new Promise((resolve) => { resolveDone = resolve; }),
    finish() {
      if (this.finished) return;
      this.finished = true;
      resolveDone();
    },
  };

  const timer = setTimeout(async () => {
    if (pendingBossRefreshes.get(guildId) !== pending || pending.cancelled) {
      pending.finish();
      return;
    }
    pending.timer = null;
    pending.running = true;
    const started = Date.now();
    let refreshSucceeded = false;
    let failureReason = null;
    try {
      if (pending?.spawnId && currentSpawn.get(guildId) && currentSpawn.get(guildId) !== pending.spawnId) {
        failureReason = 'stale-spawn';
        pending.cancelled = true;
        bandwidthLog('boss progress refresh skipped', {
          system: 'boss',
          command: pending.telemetryCommand,
          imageType: 'boss_status',
          guildId,
          spawnId: pending.spawnId,
          reason: failureReason,
        });
        return;
      }
      try {
        refreshSucceeded = await refreshLiveMessageProgress(client, guildId, {
          telemetryCommand: pending.telemetryCommand,
          shouldApply: (view) => (
            !pending.cancelled
            && pendingBossRefreshes.get(guildId) === pending
            && (!pending.spawnId || view?.state?.spawn_id === pending.spawnId)
            && view?.state?.status === 'active'
          ),
        });
        if (!refreshSucceeded) failureReason = 'no-message-updated';
      } catch (err) {
        failureReason = err.message;
        console.error(`[boss] debounced refresh failed (guild ${guildId}):`, err.message);
      }
      bandwidthLog(refreshSucceeded ? 'boss progress refresh updated' : 'boss progress refresh failed', {
        system: 'boss',
        command: pending.telemetryCommand,
        imageType: 'boss_status',
        guildId,
        spawnId: pending?.spawnId,
        retryAttempt: pending.retryAttempt,
        ...(failureReason ? { reason: failureReason } : {}),
        durationMs: Date.now() - started,
      });
    } finally {
      pending.running = false;
      if (pendingBossRefreshes.get(guildId) === pending) {
        pendingBossRefreshes.delete(guildId);
        if (!pending.cancelled && !refreshSucceeded && pending.retryAttempt < BOSS_PROGRESS_REFRESH_MAX_RETRIES) {
          scheduleBossLiveRefresh(client, guildId, {
            spawnId: pending.spawnId,
            retryAttempt: pending.retryAttempt + 1,
            telemetryCommand: pending.telemetryCommand,
          });
        } else if (!pending.cancelled && pending.rerun) {
          scheduleBossLiveRefresh(client, guildId, {
            spawnId: pending.spawnId,
            telemetryCommand: pending.telemetryCommand,
          });
        } else if (!pending.cancelled && !refreshSucceeded) {
          liveMessages.delete(guildId);
        }
      }
      pending.finish();
    }
  }, debounceMs);

  pending.timer = timer;
  pendingBossRefreshes.set(guildId, pending);
}

/* ── spawn / escape (scheduler paths) ───────────────────────────────────── */

/**
 * Spawn a boss for the guild if eligible. Race-safe: the UPSERT's WHERE guard
 * makes the transition atomic — losing a race (or being ineligible) returns
 * false without side effects.
 * `force` (crd dev spawnboss) bypasses the 15-min respawn cooldown — it can
 * NEVER replace a live boss (status <> 'active' stays in the guard).
 * `channelId` overrides the configured announce channel (dev spawnboss posts
 * in the invoking channel when server_config has none).
 * `bossName` (crd dev spawnboss <name>) forces a specific boss instead of the
 * weighted pick. Greater status changes weighting/rewards, but all stats come
 * from the selected mob_roster row. Returns false if no boss by that name exists.
 */
async function processQueuedCalamity(client, guildId, { db = pool, spawn = spawnBoss } = {}) {
  const dbc = await db.connect();
  let queued = null;
  try {
    await dbc.query('BEGIN');
    await dbc.query(
      `UPDATE boss_spawn_queue
          SET status = 'pending', claim_started_at = NULL, updated_at = NOW()
        WHERE guild_id = $1
          AND status = 'spawning'
          AND (claim_started_at IS NULL OR claim_started_at <= NOW() - INTERVAL '${CALAMITY_CLAIM_TIMEOUT}')`,
      [guildId]
    );
    const result = await dbc.query(
      `WITH next_item AS (
         SELECT queue_id
           FROM boss_spawn_queue
          WHERE guild_id = $1 AND status = 'pending'
          ORDER BY created_at, queue_id
          FOR UPDATE SKIP LOCKED
          LIMIT 1
       )
       UPDATE boss_spawn_queue q
          SET status = 'spawning', claim_started_at = NOW(), updated_at = NOW()
         FROM next_item n
        WHERE q.queue_id = n.queue_id
        RETURNING q.queue_id, q.boss_name`,
      [guildId]
    );
    if (result.rows.length === 0) {
      await dbc.query('ROLLBACK');
      return false;
    }
    queued = result.rows[0];
    await dbc.query('COMMIT');
  } catch (err) {
    await dbc.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    dbc.release();
  }

  let spawned;
  try {
    spawned = await spawn(client, guildId, {
      force: false,
      bossName: queued.boss_name,
      spawnSource: 'dev',
      bypassOfficialGuard: true,
    });
  } catch (err) {
    await db.query(
      `UPDATE boss_spawn_queue
          SET status = 'pending', claim_started_at = NULL, updated_at = NOW()
        WHERE queue_id = $1 AND status = 'spawning'`,
      [queued.queue_id]
    ).catch(() => {});
    throw err;
  }
  if (spawned) {
    await db.query(
      `UPDATE boss_spawn_queue
          SET status = 'spawned', updated_at = NOW(), spawned_at = NOW(),
              claim_started_at = NULL,
              spawn_id = (SELECT spawn_id FROM boss_state WHERE guild_id = $1)
        WHERE queue_id = $2 AND status = 'spawning'`,
      [guildId, queued.queue_id]
    );
  } else {
    await db.query(
      `UPDATE boss_spawn_queue
          SET status = 'pending', claim_started_at = NULL, updated_at = NOW()
        WHERE queue_id = $1 AND status = 'spawning'`,
      [queued.queue_id]
    );
  }
  return spawned;
}

async function spawnBoss(client, guildId, {
  force = false, channelId = null, bossName = null, spawnSource = null,
  bypassOfficialGuard = false,
} = {}) {
  if (!bypassOfficialGuard && !isOfficialGuild(guildId)) {
    await postOfficialRedirect(client, guildId, channelId, { force });
    return false;
  }

  const announceChannelId = channelId || await resolveAnnounceChannelId(guildId);
  if (!announceChannelId) return false; // nowhere to announce — skip guild

  const eligible = await pool.query(
    `SELECT 1
       FROM user_guild_activity uga
       JOIN user_character uc ON uc.discord_id = uga.discord_id
      WHERE uga.guild_id = $1
      LIMIT 1`,
    [guildId]
  );
  if (eligible.rows.length === 0) return false;
  const source = spawnSource || (force ? 'dev' : 'natural');
  if (!['natural', 'dev'].includes(source)) return false;

  // Forced names use the roster row directly; natural spawns use the tier roll.
  let pick;
  if (bossName) {
    const named = await fetchMobByName(pool, bossName);
    if (!named || named.mob_type !== 'boss') return false; // unknown boss name
    pick = {
      row: named,
      greater: isGreaterBoss(named.name),
      calamity: isCalamityBoss(named.name),
    };
  } else {
    pick = pickWeightedBoss(await fetchAllBosses(pool));
  }
  if (!pick) return false;
  const { row, greater, calamity } = pick;

  const stats = computeBossStats(row);
  // Select the fixed chest once so HP, announcement, and payout share one outcome.
  const spawnChest = greater || calamity ? bossChestForSpawn(row.name, source) : rollBossChest(row.name);
  const hpMultiplier = greater ? hpMultiplierForChest(spawnChest) : 1;
  const maxHp = bossMaxHpForChest(
    row.base_hp,
    row.hp_per_level,
    null,
    spawnChest,
    row.name,
  );
  performanceLog('boss stats resolved from database', {
    system: 'boss',
    command: 'boss',
    imageType: 'boss_status',
    guildId,
    source: `${source}:mob_roster`,
    greater,
    calamity,
    multiplier: hpMultiplier,
    reason: spawnChest ? `${spawnChest.column}:x${spawnChest.qty}` : 'normal',
    baseHp: Number(row.base_hp),
    baseAtk: Number(row.base_atk),
    baseDef: Number(row.base_def),
    baseCrit: Number(row.base_crit),
    finalHp: Number(maxHp),
    finalAtk: Number(stats.atk),
    finalDef: Number(stats.def),
    finalCrit: Number(stats.crit),
  });

  const ins = await pool.query(
    `INSERT INTO boss_state
       (guild_id, spawn_id, mob_id, max_hp, current_hp,
        scaled_atk, scaled_def, spawn_at, expires_at, status,
        spawn_source, last_attack_at, passive_state)
     VALUES ($1, gen_random_uuid(), $2, $3, $3, $4, $5,
             NOW(), ${ACTIVE_BOSS_EXPIRES_AT_SQL}, 'active', $6, NOW(), '{}'::jsonb)
     ON CONFLICT (guild_id) DO UPDATE SET
       spawn_id = gen_random_uuid(), mob_id = EXCLUDED.mob_id,
       max_hp = EXCLUDED.max_hp, current_hp = EXCLUDED.current_hp,
       scaled_atk = EXCLUDED.scaled_atk,
       scaled_def = EXCLUDED.scaled_def, spawn_at = NOW(),
       expires_at = ${ACTIVE_BOSS_EXPIRES_AT_SQL}, status = 'active',
       spawn_source = EXCLUDED.spawn_source, last_attack_at = NOW(), passive_state = '{}'::jsonb
     WHERE boss_state.status <> 'active'
       AND ($7 OR boss_state.expires_at <= NOW() - INTERVAL '${RESPAWN_COOLDOWN}')
     RETURNING spawn_id`,
    [guildId, row.mob_id, maxHp, stats.atk, stats.def, source, force]
  );
  if (ins.rows.length === 0) return false; // lost the race / cooldown not over

  // Stash the chest against the new spawn_id so HP, announcement, and payout
  // keep the same outcome without re-rolling.
  if (greater && spawnChest) greaterChests.set(ins.rows[0].spawn_id, spawnChest);

  if (source === 'dev') devSpawns.add(ins.rows[0].spawn_id); // test boss: attack rules bypassed
  rememberSpawn(guildId, ins.rows[0].spawn_id);
  const view = await fetchBossView(guildId);
  if (view) {
    await postFreshLiveMessage(
      client,
      guildId,
      await buildBossMessage(view, {
        phase: 'spawn',
        telemetryCommand: force ? 'dev:spawnboss' : 'scheduler:boss',
      }),
      announceChannelId
    );
  }
  return true;
}

/* ── defeat distribution (§16 participation-only, exactly-once) ─────────── */

/**
 * Distribute participation rewards. The status flip and ALL payouts share one
 * transaction — exactly-once even under concurrent triggers (the row lock on
 * boss_state makes the loser of the race see 0 flipped rows and roll back).
 * Returns the attacker count, or null when nothing was distributed.
 */
async function distributeRewards(client, guildId, spawnId, { includeStatusImage = true } = {}) {
  const dbc = await pool.connect();
  let attackerIds = [];
  let reward = null;
  let chest = null;
  let supremeWinnerIds = [];
  let totalEligibleDamage = 0;
  let supremeBagUpd = { rows: [] };
  let bagUpd = { rows: [] };
  let raidLimitNoticeCount = 0;
  let expResults = new Map();
  try {
    await dbc.query('BEGIN');
    // expires_at = NOW() anchors the 15-min respawn clock (no died_at column)
    const flip = await dbc.query(
      `UPDATE boss_state SET status = 'dead', expires_at = NOW()
        WHERE guild_id = $1 AND spawn_id = $2 AND status = 'active' AND current_hp <= 0
        RETURNING mob_id, max_hp, spawn_source`,
      [guildId, spawnId]
    );
    if (flip.rows.length === 0) {
      await dbc.query('ROLLBACK');
      return null; // already distributed (or boss not actually down)
    }

    // Reward bundle + chest keyed off the boss's Greater identity. The chest was
    // fixed at spawn; after restart it is recovered from persisted max_hp.
    const mobRes = await dbc.query(
      `SELECT name, base_hp, hp_per_level, base_atk, atk_per_level,
              base_def, def_per_level, base_crit
         FROM mob_roster WHERE mob_id = $1`,
      [flip.rows[0].mob_id]
    );
    const mobRow = mobRes.rows[0] || {};
    const bossName = mobRow.name || '';
    const calamity = isCalamityBoss(bossName);
    // [v4.6] the chest fixed at spawn — same outcome the announcement showed, paid to all.
    chest = chestForSpawn(spawnId, bossName, {
      baseHp: mobRow.base_hp,
      hpPerLevel: mobRow.hp_per_level,
      maxHp: flip.rows[0].max_hp,
      spawnSource: flip.rows[0].spawn_source,
    }); // { column (whitelisted), qty, label }
    reward = bossRewards(bossName, chest);

    const atk = await dbc.query(
      `SELECT discord_id, total_damage FROM boss_attack_log
        WHERE boss_spawn_id = $1 ORDER BY discord_id`,
      [spawnId]
    );
    const participantRows = calamity
      ? atk.rows.filter((row) => Number(row.total_damage) > 0)
      : atk.rows;
    attackerIds = participantRows.map((r) => r.discord_id);
    if (calamity) {
      const rolls = rollCalamitySupremeRewards(participantRows);
      totalEligibleDamage = rolls.totalEligibleDamage;
      supremeWinnerIds = rolls.winnerIds;
    }

    if (attackerIds.length > 0) {
      // lock order: users_bag (sorted) → user_character (sorted) — Phase-5
      // convention; the explicit sorted SELECT guarantees acquisition order
      await dbc.query(
        `SELECT discord_id FROM users_bag
          WHERE discord_id = ANY($1) ORDER BY discord_id FOR UPDATE`,
        [attackerIds]
      );
      // Boss participation is a raid source for the shared Belief Shard cap. Each
      // participant is allocated independently while bag rows remain locked in the
      // sorted attacker order. Boss-specific chest columns are intentionally outside
      // the Silver/Gold raid caps.
      for (const discordId of attackerIds) {
        const allocation = await allocateRaidRewardLimits(dbc, discordId, {
          beliefShards: reward.shards,
        });
        if (allocation.notices.length > 0) raidLimitNoticeCount += 1;
        const rowRes = await dbc.query(
          `UPDATE users_bag
              SET credux = credux + $2,
                  belief_shards = belief_shards + $3,
                  lifetime_credux_earned = lifetime_credux_earned + $2,
                  ${chest.column} = ${chest.column} + $4
            WHERE discord_id = $1
            RETURNING discord_id, credux, belief_shards, ${chest.column} AS chest_count`,
          [discordId, reward.credux, allocation.granted.beliefShards, chest.qty]
        );
        if (rowRes.rows.length === 0) throw new Error(`missing reward bag row for ${discordId}`);
        rowRes.rows[0].granted_shards = allocation.granted.beliefShards;
        bagUpd.rows.push(rowRes.rows[0]);
      }

      if (calamity && supremeWinnerIds.length > 0) {
        supremeBagUpd = await dbc.query(
          `UPDATE users_bag
              SET supreme_chest = supreme_chest + $2
            WHERE discord_id = ANY($1)
            RETURNING discord_id, supreme_chest AS chest_count`,
          [supremeWinnerIds, SUPREME_CHEST_REWARD.qty]
        );
      }

      // Boss EXP scales off each attacker's own combat level, not the boss's fixed
      // combat stats.
      expResults = await awardCombatExpMany(dbc, attackerIds, reward.exp, {
        scaleByParticipantLevel: true,
      });

      // [v5 Phase 4] boss participation kill — boss died + you attacked (Blueprint §4.4)
      const killRes = await dbc.query(
        'UPDATE user_character SET boss_kills = boss_kills + 1 WHERE discord_id = ANY($1) RETURNING discord_id, boss_kills',
        [attackerIds]
      );
      // [v5 Phase 5] boss-feat titles at kill thresholds (idempotent).
      for (const row of killRes.rows) {
        await grantTitles(dbc, row.discord_id, bossFeatTitlesFor(row.boss_kills));
      }

      // game_logs — one row per currency/item per attacker (action 'Boss'),
      // before/after balances, bulk via unnest
      const ids = [], prevCred = [], newCred = [], prevSh = [], newSh = [], prevCh = [], newCh = [];
      for (const r of bagUpd.rows) {
        ids.push(r.discord_id);
        newCred.push(Number(r.credux));
        prevCred.push(Number(r.credux) - reward.credux);
        newSh.push(r.belief_shards);
        prevSh.push(r.belief_shards - r.granted_shards);
        newCh.push(r.chest_count);
        prevCh.push(r.chest_count - chest.qty);
      }
      await dbc.query(
        `INSERT INTO game_logs (discord_id, action, previous_credux, updated_credux)
         SELECT u.id, 'Boss', u.prev, u.upd
           FROM unnest($1::varchar[], $2::bigint[], $3::bigint[]) AS u(id, prev, upd)`,
        [ids, prevCred, newCred]
      );
      await dbc.query(
        `INSERT INTO game_logs (discord_id, action, previous_belief_shards, updated_belief_shards)
         SELECT u.id, 'Boss', u.prev, u.upd
           FROM unnest($1::varchar[], $2::int[], $3::int[]) AS u(id, prev, upd)`,
        [ids, prevSh, newSh]
      );
      await dbc.query(
        `INSERT INTO game_logs (discord_id, action, item_type, previous_chest_count, updated_chest_count)
          SELECT u.id, 'Boss', $4, u.prev, u.upd
            FROM unnest($1::varchar[], $2::int[], $3::int[]) AS u(id, prev, upd)`,
        [ids, prevCh, newCh, chest.column]
      );

      if (supremeBagUpd.rows.length > 0) {
        const supremeIds = [], previousSupreme = [], updatedSupreme = [];
        for (const row of supremeBagUpd.rows) {
          supremeIds.push(row.discord_id);
          updatedSupreme.push(row.chest_count);
          previousSupreme.push(row.chest_count - SUPREME_CHEST_REWARD.qty);
        }
        await dbc.query(
          `INSERT INTO game_logs (discord_id, action, item_type, previous_chest_count, updated_chest_count)
           SELECT u.id, 'Boss', $4, u.prev, u.upd
             FROM unnest($1::varchar[], $2::int[], $3::int[]) AS u(id, prev, upd)`,
          [supremeIds, previousSupreme, updatedSupreme, SUPREME_CHEST_REWARD.column]
        );
      }
    }

    await dbc.query('COMMIT');
  } catch (err) {
    await dbc.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    dbc.release();
  }

  // post-commit presentation (failures here never affect the payouts)
  await clearPendingBossRefresh(guildId, 'dead');
  await refreshLiveMessage(client, guildId, {
    includeStatusImage,
    includeBanner: 'remote-only',
    phase: 'final',
    telemetryCommand: 'boss:final',
  }).catch(() => {});
  const view = await fetchBossView(guildId).catch(() => null);
  if (view && isCalamityBoss(view.mobRow.name) && totalEligibleDamage <= 0) {
    console.info('[boss] calamity defeated without eligible damage', {
      guildId,
      spawnId,
      reason: 'total eligible damage is zero',
    });
  }
  if (view) {
    const channelId = liveMessages.get(guildId)?.channelId || await resolveAnnounceChannelId(guildId);
    const channel = channelId ? await client.channels.fetch(channelId).catch(() => null) : null;
    if (channel) {
      // Recover the fixed variant if presentation resumes after a process restart.
      const c = chest || chestForSpawn(view.state.spawn_id, view.mobRow.name, {
        baseHp: view.mobRow.base_hp,
        hpPerLevel: view.mobRow.hp_per_level,
        maxHp: view.state.max_hp,
        spawnSource: view.state.spawn_source,
      });
      const r = reward || bossRewards(view.mobRow.name, c);
      const greater = isGreaterBoss(view.mobRow.name);
      // Grouped level-up + level-reward summary (spec S3) from the same
      // distribution transaction — post-commit display only.
      let levelLine = '';
      {
        const leveled = [...expResults.values()].filter((i) => i.levelsGained > 0);
        if (leveled.length > 0) {
          const totals = { credux: 0, chests: {} };
          for (const info of leveled) {
            if (!info.rewards) continue;
            totals.credux += info.rewards.credux;
            for (const [col, qty] of Object.entries(info.rewards.chests)) {
              totals.chests[col] = (totals.chests[col] || 0) + qty;
            }
          }
          const rewardsText = formatLevelRewardLine(totals);
          levelLine =
            `\n⬆️ **${leveled.length}** challenger${leveled.length === 1 ? '' : 's'} leveled up!` +
            (rewardsText ? ` Level Rewards: ${rewardsText}` : '');
        }
      }
      await channel.send({
        // Calamity's bonus is an independent roll per valid damage participant;
        // only the guaranteed chest is included in the shared participation line.
        content:
          `🎉 ${greater ? '☠️ **GREATER** ' : ''}**${view.mobRow.name}** has fallen! ` +
          `All **${attackerIds.length}** challenger${attackerIds.length === 1 ? '' : 's'} receive: ` +
          `${r.credux.toLocaleString()} Credux · ${r.exp.toLocaleString()} Combat EXP · ${c.qty}× ${c.label} · ` +
          `${r.shards.toLocaleString()} Belief Shards${raidLimitNoticeCount > 0 ? ' subject to each participant\'s daily raid limit' : ''}.` +
          (raidLimitNoticeCount > 0
            ? ` Daily raid Belief Shard limits were applied to ${raidLimitNoticeCount} participant${raidLimitNoticeCount === 1 ? '' : 's'}.`
            : '') +
          (isCalamityBoss(view.mobRow.name)
            ? ` Each eligible participant also received an independent chance at 1 Supreme Chest; **${supremeWinnerIds.length}** won.`
            : '') +
          levelLine,
        allowedMentions: { parse: [] },
      }).catch(() => {});
    }
  }
  purgeBossRuntimeForSpawn(spawnId, 'dead');
  currentSpawn.delete(guildId);
  lastBossReconciliations.delete(guildId);
  return attackerIds.length;
}

/* ── ⚔️ Attack button ───────────────────────────────────────────────────── */
async function handleAttackImpl(interaction) {
  const guildId = interaction.guildId;
  const discordId = interaction.user.id;
  const started = Date.now();
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const fail = (msg) => interaction.editReply({ content: msg }).catch(() => {});

  try {
    // Read the persisted source before applying the official-server rule. A
    // dev-spawned boss is an explicit local test fixture and must remain
    // attackable wherever it was created, including dev-spawned Calamities.
    const stRes = await pool.query(`SELECT ${BOSS_STATE_COLUMNS} FROM boss_state WHERE guild_id = $1`, [guildId]);
    const state = stRes.rows[0];
    if (!isOfficialGuild(guildId) && state?.spawn_source !== 'dev') {
      return fail(`Monster bosses are currently hosted in the official support server: ${supportMarkdownLink()}.`);
    }
    // gate 1 — registered + character
    const fighter = await buildPlayerFighter(pool, discordId);
    if (!fighter) {
      return fail('You need a character first — `crd register`, then `crd create character`.');
    }
    // gate 2 — not banned (buttons bypass message middleware)
    if (await isBanned(discordId)) {
      return fail('You cannot attack the boss right now.');
    }
    // gate 3 — boss still active
    if (!state || state.status !== 'active') {
      return fail('There is no active boss right now — it has fallen. `crd boss` shows the latest status.');
    }
    // Ordinary dev test bosses bypass the daily lock. Dev Calamities use the
    // regular per-player cap, matching a naturally spawned Calamity.
    const mobRes = await pool.query(`SELECT ${MOB_BATTLE_COLUMNS} FROM mob_roster WHERE mob_id = $1`, [state.mob_id]);
    const mobRow = mobRes.rows[0];
    if (!mobRow) return fail('Boss data is missing — try again shortly.');
    let unlimitedDev = devBossHasUnlimitedAttacks(state, mobRow);
    if (!unlimitedDev) {
      // Gate 4: global daily limit (PHT clock). A player may attack up to
      // MAX_BOSS_ATTACKS_PER_DAY times/day across all boss spawns.
      const dailyLimit = bossDailyAttackLimit();
      const dl = await pool.query(
        `SELECT COALESCE(SUM(attacks), 0)::int AS used
           FROM boss_attack_log
          WHERE discord_id = $1
            AND last_daily_reset = (NOW() AT TIME ZONE 'Asia/Manila')::date`,
        [discordId]
      );
      const usedToday = Number(dl.rows[0]?.used || 0);
      const decision = bossAttackDecision({ usedToday, limit: dailyLimit });
      if (!decision.allowed) {
        return fail(`You already used all ${dailyLimit} boss attacks today — your attacks reset at midnight PHT.`);
      }
    }
    // gate 6 — no live battle: claim the active_battles slot (reaper covers crashes)
    const claim = await pool.query(
      `INSERT INTO active_battles
         (discord_id, channel_id, message_id, battle_type, mob_id,
          player_hp, player_max_hp, enemy_hp, enemy_max_hp, current_turn, player_goes_first)
       VALUES ($1, $2, '0', 'boss', $3, $4, $4, $5, $6, 1, TRUE)
       ON CONFLICT (discord_id) DO NOTHING
       RETURNING battle_id`,
      [
        discordId, interaction.channelId, state.mob_id,
        fighter.hp, Number(state.current_hp), Number(state.max_hp),
      ]
    );
    if (claim.rows.length === 0) {
      return fail('⚔️ You are already in a battle — wait for it to finish.');
    }

    let dbc = null;
    let txOpen = false;
    try {
      // fresh pool snapshot at fight start — concurrent attackers may have
      // chipped it since the gate; "enemy HP < X%" passives read pool % (§35.4)
      dbc = await pool.connect();
      let remaining = null;
      let sim = null;
      let net = 0;
      await dbc.query('BEGIN');
      txOpen = true;
      const locked = await dbc.query(
        `SELECT ${BOSS_STATE_COLUMNS} FROM boss_state
          WHERE guild_id = $1 AND spawn_id = $2
          FOR UPDATE`,
        [guildId, state.spawn_id]
      );
      if (locked.rows.length === 0 || locked.rows[0].status !== 'active' || Number(locked.rows[0].current_hp) <= 0) {
        await dbc.query('ROLLBACK');
        txOpen = false;
        dbc.release();
        dbc = null;
        return fail('The boss just fell before your strike landed!');
      }
      Object.assign(state, locked.rows[0]);
      unlimitedDev = devBossHasUnlimitedAttacks(state, mobRow);
      const boss = { ...buildBossFighter(mobRow, state), crit: bossCrit(mobRow) };
      sim = resolveBattle(fighter, boss, { mode: 'boss', seed: Date.now() >>> 0 });
      net = Math.max(0, Math.floor(sim.totals.netDamage));

      // atomic commit — pool deduction, attack log, daily lock
      try {
        const upd = await dbc.query(
          `UPDATE boss_state SET current_hp = GREATEST(current_hp - $3, 0),
                last_attack_at = NOW(), passive_state = $4::jsonb
            WHERE guild_id = $1 AND spawn_id = $2 AND status = 'active' AND current_hp > 0
            RETURNING current_hp`,
          [guildId, state.spawn_id, net, JSON.stringify(sim.b?.bossPassiveState || {})]
        );
        if (upd.rows.length === 0) {
          await dbc.query('ROLLBACK');
          return fail('The boss just fell before your strike landed!'); // daily lock NOT consumed
        }
        // The per-spawn row keeps lifetime damage while attacks tracks the current
        // PHT day. The conflict guard is a backstop for the daily limit.
        const ins = await dbc.query(
          `INSERT INTO boss_attack_log
             (boss_spawn_id, guild_id, discord_id, mob_id, total_damage, attacks, last_daily_reset)
           VALUES ($1, $2, $3, $4, $5, 1, (NOW() AT TIME ZONE 'Asia/Manila')::date)
           ON CONFLICT (boss_spawn_id, discord_id) DO UPDATE SET
             attacks = CASE
               WHEN boss_attack_log.last_daily_reset = (NOW() AT TIME ZONE 'Asia/Manila')::date
                 THEN boss_attack_log.attacks + 1
               ELSE 1
             END,
             total_damage = boss_attack_log.total_damage + EXCLUDED.total_damage,
             attacked_at = NOW(),
             last_daily_reset = (NOW() AT TIME ZONE 'Asia/Manila')::date
           ${unlimitedDev ? '' : "WHERE boss_attack_log.last_daily_reset <> (NOW() AT TIME ZONE 'Asia/Manila')::date OR boss_attack_log.attacks < $6"}
           RETURNING id`,
          unlimitedDev
            ? [state.spawn_id, guildId, discordId, state.mob_id, net]
            : [state.spawn_id, guildId, discordId, state.mob_id, net, bossDailyAttackLimit()]
        );
        if (ins.rows.length === 0) {
          await dbc.query('ROLLBACK');
          return fail(`You already used all ${bossDailyAttackLimit()} boss attacks today — your attacks reset at midnight PHT.`);
        }
        // [v5 Phase 5b] track highest single-attack boss damage (leaderboard metric)
        await dbc.query(
          'UPDATE user_character SET boss_top_damage = GREATEST(boss_top_damage, $2) WHERE discord_id = $1',
          [discordId, net]
        );
        if (!unlimitedDev) {
          // Only ordinary dev test bosses skip the global daily lock.
          await dbc.query(
            `UPDATE users SET last_boss_attack_date = (NOW() AT TIME ZONE 'Asia/Manila')::date
              WHERE discord_id = $1`,
            [discordId]
          );
        }
        await dbc.query('COMMIT');
        txOpen = false;
        remaining = Number(upd.rows[0].current_hp);
      } catch (err) {
        await dbc.query('ROLLBACK').catch(() => {});
        txOpen = false;
        throw err;
      } finally {
        dbc.release();
        dbc = null;
      }

      rememberBossLog(state.spawn_id, discordId, sim);
      rememberSpawn(guildId, state.spawn_id);

      if (sim.bossThresholdEvents?.length) {
        const channelId = liveMessages.get(guildId)?.channelId || await resolveAnnounceChannelId(guildId);
        const channel = channelId ? await interaction.client.channels.fetch(channelId).catch(() => null) : null;
        if (channel) {
          for (const event of sim.bossThresholdEvents) {
            await channel.send({
              content: `☄️ **Bakunawa** crosses ${event.threshold}% HP. Seven Moons raises its ATK to ${Math.round(event.atkBonusPct * 100)}%.`,
              allowedMentions: { parse: [] },
            }).catch(() => {});
          }
        }
      }

      if (remaining <= 0) {
        await distributeRewards(interaction.client, guildId, state.spawn_id);
      } else {
        scheduleBossLiveRefresh(interaction.client, guildId, { spawnId: state.spawn_id });
      }

      const survived = sim.outcome === 'boss_timeout';
      await interaction.editReply({
        content:
          `You dealt **${net.toLocaleString()}** damage to **${mobRow.name}**` +
          `${survived ? ' and survived all 50 rounds!' : '!'} Tap 📋 Log for the blow-by-blow.`,
      }).catch(() => {});
    } catch (err) {
      if (dbc) {
        if (txOpen) await dbc.query('ROLLBACK').catch(() => {});
        dbc.release();
        dbc = null;
      }
      throw err;
    } finally {
      await pool.query('DELETE FROM active_battles WHERE discord_id = $1', [discordId])
        .catch(() => {});
    }
  } catch (err) {
    console.error('[boss] attack error:', err);
    await fail('Something went wrong with your attack — nothing was consumed.');
  } finally {
    performanceLog('boss attack total duration', {
      system: 'boss',
      command: 'boss:attack',
      guildId,
      userId: discordId,
      durationMs: Date.now() - started,
    });
  }
}

async function handleAttack(interaction) {
  const endActivity = beginActivity('battle.boss');
  try {
    return await handleAttackImpl(interaction);
  } finally {
    endActivity();
  }
}

/* ── 📋 Log button ──────────────────────────────────────────────────────── */
async function handleLog(interaction) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const st = await pool.query(
      'SELECT spawn_id FROM boss_state WHERE guild_id = $1', [interaction.guildId]
    );
    const spawnId = st.rows[0]?.spawn_id;
    const sim = spawnId ? logCache.get(`${spawnId}:${interaction.user.id}`) : null;
    if (!sim) {
      await interaction.editReply({
        content: "You haven't attacked this boss yet.",
      });
      return;
    }
    const pages = logEmbeds(sim);
    await showPaginatedBattleLog(interaction, pages);
  } catch (err) {
    console.error('[boss] log error:', err);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: 'Could not load the boss log right now.' }).catch(() => {});
    }
  }
}

/* ── scheduler entry — one guild per call ───────────────────────────────── */
async function tickGuild(client, guildId, { forceRefresh = false } = {}) {
  const stRes = await pool.query(`SELECT ${BOSS_STATE_COLUMNS} FROM boss_state WHERE guild_id = $1`, [guildId]);
  const state = stRes.rows[0] || null;
  const devBossActive = state?.status === 'active' && state?.spawn_source === 'dev';

  // Keep natural lifecycle/spawn traffic official-only, but allow the
  // scheduler to reconcile and recover an explicitly dev-spawned test boss in
  // any guild. A terminal dev row must not cause a new natural spawn there.
  if (!isOfficialGuild(guildId) && !devBossActive) {
    await postOfficialRedirect(client, guildId);
    return;
  }

  if (state && state.status === 'active') {
    if (Number(state.current_hp) <= 0) {
      // crash-recovery safety net: distribution didn't finish — re-run it
      await distributeRewards(client, guildId, state.spawn_id);
      return;
    }
    rememberSpawn(guildId, state.spawn_id);
    // The startup scheduler pass explicitly refreshes the active boss so a
    // deployment immediately upgrades the live payload (footer, buttons, and
    // status image). Normal minute ticks only reconcile missing messages.
    if ((forceRefresh || !liveMessages.has(guildId)) && !pendingBossRefreshes.has(guildId)) {
      const now = Date.now();
      const lastAttempt = lastBossReconciliations.get(guildId) || 0;
      if (forceRefresh || now - lastAttempt >= BOSS_REFRESH_RECONCILE_COOLDOWN_MS) {
        lastBossReconciliations.set(guildId, now);
        scheduleBossLiveRefresh(client, guildId, {
          spawnId: state.spawn_id,
          telemetryCommand: forceRefresh ? 'scheduler:deployment-refresh' : 'scheduler:boss',
        });
        bandwidthLog('boss live message reconciliation scheduled', {
          system: 'boss',
          command: 'scheduler:boss',
          imageType: 'boss_status',
          guildId,
          spawnId: state.spawn_id,
          cooldownMs: BOSS_REFRESH_RECONCILE_COOLDOWN_MS,
        });
      }
    }
    return;
  }

  // no row, or terminal state — the spawn UPSERT's WHERE enforces the 15-min rule
  if (state && new Date(state.expires_at).getTime() + RESPAWN_COOLDOWN_MS > Date.now()) {
    return;
  }
  if (await processQueuedCalamity(client, guildId)) return;
  await spawnBoss(client, guildId);
}



module.exports = {
  tickGuild,
  processQueuedCalamity,
  spawnBoss,
  distributeRewards,
  handleAttack,
  handleLog,
  fetchBossView,
  buildBossMessage,
  repointLiveMessage,
  refreshLiveMessage,
  postOfficialRedirect,
  postFreshLiveMessage,
  redirectChannelIssue,
  clearBossRuntimeForGuild,
  getBossMemoryStats,
  bossStatusCardHeight,
};
