'use strict';

/**
 * bossMessages.js — the boss live-message lifecycle (Phase 2.3 split of
 * bossSystem.js; all bodies moved VERBATIM).
 *
 * Owns everything about the tracked boss message: announce-channel
 * resolution, the non-official redirect notice, posting a fresh live message,
 * repointing/deleting it, and the coalesced progress refresh. Also holds the
 * view fetch and CV2 payload builder that those paths render.
 *
 * Depends downward only (bossRuntime -> bossRender); it must never require the
 * bossSystem facade, which would create a cycle.
 */

const pool = require('../../db/pool');
const {
  ContainerBuilder, ButtonBuilder, ButtonStyle,
  MessageFlags, PermissionFlagsBits,
} = require('discord.js');
const guildConfig = require('../../handlers/guildConfigCache');
const { smallDivider: sep } = require('../../utils/componentsV2');
const { emojiForDisplay } = require('../../utils/emojis');
const { isRemoteSource } = require('../../utils/assets');
const { makeOptimizedAttachment } = require('../../utils/imageOutput');
const { discordImageAttachmentsAllowed } = require('../../utils/egressGuard');
const {
  envBool, envNumber, envPositiveInt, bandwidthLog, performanceLog,
} = require('../../utils/runtimeLogs');
const { beginActivity } = require('../../utils/networkTelemetry');
const {
  isGreaterBoss, isCalamityBoss, bossRewards, bossBagReward,
  MAX_BOSS_ATTACKS_PER_DAY, bossAttackDecision,
} = require('../../config/bosses');
const {
  bossRedirectMessage,
  isOfficialGuild,
  supportMarkdownLink,
} = require('../../config/officialSupport');
const {
  SUPREME_CHEST_REWARD,
  DIVINE_BAG_REWARD,
  grantedCalamityBonusRewards,
} = require('../calamityRewards');
const {
  bossPassiveText, bossStatusText, bossStatusImage, bossBanner, bossLore,
  bossImagePath, bossImagePathForMessage, bossImageMaxWidth, bossCrit,
} = require('./bossRender');
const {
  liveMessages, nonOfficialRedirects, currentSpawn, pendingBossRefreshes,
  lastBossReconciliations, logCache,
  chestForSpawn, clearPendingBossRefresh, rememberSpawn, purgeBossRuntimeForGuild,
  bossProgressRefreshDebounceMs,
} = require('./bossRuntime');

const NON_OFFICIAL_REDIRECT_COOLDOWN_MS = 6 * 60 * 60_000;

const BOSS_PROGRESS_REFRESH_MAX_RETRIES = 2;

const TOP_N = 15;

const BOSS_FLAVOR = {
  PH: '🌒 *An old terror of the islands stirs…*',
  Norse: '🌒 *An ancient dread of the nine realms awakens…*',
  Greek: '🌒 *A monster of myth crawls into the light…*',
  _default: '🌒 *An old terror stirs…*',
};

const GREATER_FLAVOR = '☠️ **GREATER BOSS** — *A world-ender awakes…*';

const BOSS_DAILY_ATTACK_LIMIT_MAX = MAX_BOSS_ATTACKS_PER_DAY + 2;

function bossImageRefreshEnabled() {
  return envBool('BOSS_IMAGE_REFRESH_ENABLED', true);
}

function bossDailyAttackLimit() {
  // §1.4: cap lives in config (MAX_BOSS_ATTACKS_PER_DAY); env may override for ops.
  return envPositiveInt('BOSS_DAILY_ATTACK_LIMIT', MAX_BOSS_ATTACKS_PER_DAY, {
    max: BOSS_DAILY_ATTACK_LIMIT_MAX,
  });
}

function devBossHasUnlimitedAttacks(state, mobRow) {
  return state?.spawn_source === 'dev' && !isCalamityBoss(mobRow?.name);
}

function calamityBonusRewardBlock(status, bonusRewardResults = null) {
  const supremeIcon = emojiForDisplay(SUPREME_CHEST_REWARD.label, '👑');
  const divineIcon = emojiForDisplay(DIVINE_BAG_REWARD.label, '✨');
  if (status === 'active') {
    return `\n\n**Bonus Rewards**\n` +
      `${supremeIcon} ${SUPREME_CHEST_REWARD.label} ×${SUPREME_CHEST_REWARD.qty}\n` +
      `${divineIcon} ${DIVINE_BAG_REWARD.label} ×${DIVINE_BAG_REWARD.qty}\n` +
      '-# *Two independent chances per eligible participant, each weighted by the same damage contribution.*';
  }
  if (status !== 'dead') return '';
  const granted = grantedCalamityBonusRewards(bonusRewardResults || {});
  if (granted.length === 0) return '';
  const lines = granted.map((item) => {
    const icon = emojiForDisplay(item.label, '🎁');
    return `${icon} ${item.label} ×${item.qty} each · ${item.winnerCount} ` +
      `User${item.winnerCount === 1 ? '' : 's'}`;
  });
  return `\n\n**Bonus Rewards**\n${lines.join('\n')}`;
}

function bossBagRewardLine(bagReward) {
  const icon = emojiForDisplay(bagReward.label, '🎒');
  return `${icon} ${bagReward.label} ×${bagReward.qty}`;
}

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

async function buildBossMessage(view, {
  includeStatusImage = true,
  includeBanner = true,
  bannerUrl = null,
  forceAssetRefresh = false,
  phase = 'snapshot',
  telemetryCommand = 'boss',
  bonusRewardResults = null,
} = {}) {
  const { state, mobRow, attackers, attackerCount, isDev = false } = view;
  const { status } = state;

  const greater = isGreaterBoss(mobRow.name);
  const calamity = isCalamityBoss(mobRow.name);
  const unlimitedDev = isDev && !calamity;
  const spawnChest = chestForSpawn(state.spawn_id, mobRow.name, {
    spawnSource: state.spawn_source,
    passiveState: state.passive_state,
  });
  const reward = bossRewards(mobRow.name, spawnChest);
  const bagReward = bossBagReward(mobRow.name, spawnChest);

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

  // Participation rewards are fixed by the same spawn variant as the chest.
  const creduxIcon = emojiForDisplay('Credux Coin', '💰');
  const expIcon = emojiForDisplay('Combat Exp', '✨');
  const chestIcon = emojiForDisplay('Boss Treasure Chest', '🗝️');
  const goldChestIcon = emojiForDisplay('Boss Golden Chest', '🪙');
  const supremeChestIcon = emojiForDisplay('Supreme Chest', '👑');
  const shardIcon = emojiForDisplay('Belief Shards', '🔮');
  // [v4.6] Greater chest is rolled ONCE at spawn — show the ACTUAL chest this fight awards
  // (not the 75/25 rule), keyed off the same source the payout uses so they never disagree.
  const spawnChestIcon = spawnChest.column === SUPREME_CHEST_REWARD.column
    ? supremeChestIcon : spawnChest.column === 'boss_golden_chest' ? goldChestIcon : chestIcon;
  // [v4.8] drop the "(this fight)" qualifier — redundant; rewards are understood to be this boss's.
  const chestLine = `${spawnChestIcon} ${spawnChest.label} ×${spawnChest.qty}`;
  const bagLine = bossBagRewardLine(bagReward);
  const calamityBonusBlock = calamity
    ? calamityBonusRewardBlock(status, bonusRewardResults)
    : '';
  container
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent(
      `**Participation rewards if defeated:**${calamity ? '  ☄️ *Calamity*' : greater ? '  ☠️ *Greater*' : ''}\n` +
      `${creduxIcon} Credux ×${reward.credux.toLocaleString()}\n` +
      `${expIcon} Combat EXP ×${reward.exp.toLocaleString()}\n` +
      `${chestLine}\n` +
      `${bagLine}\n` +
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

function repointLiveMessage(guildId, msg) {
  const channelId = msg?.channelId || msg?.channel?.id;
  if (!channelId || !msg?.id) return false;
  liveMessages.set(guildId, { channelId, messageId: msg.id });
  return true;
}

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
  if (!msg && options.allowCreate === false) return false;
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
    // Components-V2 flags are immutable after the live message is created.
    // `crd boss` sends this flag on the initial post, but repeating it in the
    // attack-triggered PATCH makes Discord reject the edit and leaves the old
    // HP/leaderboard visible. Keep the flag for fresh-message recovery only.
    const editablePayload = { ...payload };
    delete editablePayload.flags;
    let editError = null;
    const edited = await msg.edit({ ...editablePayload, attachments: retainedAttachments }).catch((err) => {
      editError = err;
      return null;
    });
    if (edited) return true;
    console.warn('[boss] live message edit failed', {
      guildId,
      channelId: ref.channelId,
      messageId: ref.messageId,
      code: editError?.code || 'unknown',
      error: editError?.message || 'Discord returned no edited message',
    });
    // A tracked message that rejected an edit must not produce a duplicate
    // boss message for every attack. The bounded scheduler retry can try again;
    // `crd boss` remains the explicit recovery path when the message is gone or
    // Discord continues rejecting edits.
    return false;
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
    // A button interaction identifies the message to edit. Never turn a
    // post-attack refresh into a second boss post if message tracking was lost;
    // scheduler reconciliation remains the explicit reconstruction path.
    allowCreate: phase === 'background',
  });
}

function scheduleBossLiveRefresh(client, guildId, {
  spawnId = null, retryAttempt = 0, telemetryCommand = 'boss:attack', immediate = false,
} = {}) {
  const existing = pendingBossRefreshes.get(guildId);
  if (existing) {
    existing.spawnId = spawnId || existing.spawnId;
    existing.telemetryCommand = telemetryCommand || existing.telemetryCommand;
    if (immediate) {
      existing.immediate = true;
      existing.retryAttempt = 0;
      if (existing.running) {
        existing.rerun = true;
      } else if (existing.timer && existing.run) {
        clearTimeout(existing.timer);
        existing.timer = setTimeout(existing.run, 0);
      }
    } else if (existing.running) {
      existing.rerun = true;
    }
    bandwidthLog('boss progress refresh coalesced', {
      system: 'boss',
      command: existing.telemetryCommand,
      imageType: 'boss_status',
      guildId,
      spawnId: existing.spawnId,
      debounceMs: existing.immediate ? 0 : bossProgressRefreshDebounceMs(),
      immediate: existing.immediate,
    });
    return existing.done;
  }

  // Scheduler/reconciliation refreshes retain their coalescing delay. Only a
  // post-commit player attack opts into the zero-delay path.
  const debounceMs = immediate ? 0 : bossProgressRefreshDebounceMs();
  bandwidthLog('boss progress refresh scheduled', {
    system: 'boss',
    command: telemetryCommand,
    imageType: 'boss_status',
    guildId,
    spawnId,
    debounceMs,
    immediate,
    retryAttempt,
  });

  let resolveDone;
  const pending = {
    timer: null,
    spawnId,
    retryAttempt,
    telemetryCommand,
    immediate,
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

  const run = async () => {
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
          shouldApply: (view) => {
            // A final/death transition can race an attack-triggered refresh
            // that was queued just after the terminal cleanup began. Mark the
            // pending work cancelled when the fetched state is terminal so
            // it cannot delete/recreate or overwrite the completed message.
            if (view?.state && view.state.status !== 'active') pending.cancelled = true;
            return (
              !pending.cancelled
              && pendingBossRefreshes.get(guildId) === pending
              && (!pending.spawnId || view?.state?.spawn_id === pending.spawnId)
              && view?.state?.status === 'active'
            );
          },
        });
        if (!refreshSucceeded) failureReason = 'no-message-updated';
      } catch (err) {
        failureReason = err.message;
        console.error(`[boss] progress refresh failed (guild ${guildId}):`, err.message);
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
      let followupDone = null;
      if (pendingBossRefreshes.get(guildId) === pending) {
        pendingBossRefreshes.delete(guildId);
        if (!pending.cancelled && !refreshSucceeded && pending.retryAttempt < BOSS_PROGRESS_REFRESH_MAX_RETRIES) {
          followupDone = scheduleBossLiveRefresh(client, guildId, {
            spawnId: pending.spawnId,
            retryAttempt: pending.retryAttempt + 1,
            telemetryCommand: pending.telemetryCommand,
            immediate: pending.immediate,
          });
        } else if (!pending.cancelled && pending.rerun) {
          followupDone = scheduleBossLiveRefresh(client, guildId, {
            spawnId: pending.spawnId,
            telemetryCommand: pending.telemetryCommand,
            immediate: pending.immediate,
          });
        } else if (!pending.cancelled && !refreshSucceeded) {
          liveMessages.delete(guildId);
        }
      }
      if (followupDone) {
        // Keep callers that awaited the attack-triggered refresh blocked until
        // the latest coalesced generation has rendered, not merely until an
        // older snapshot finished its edit.
        followupDone.then(() => pending.finish(), () => pending.finish());
      } else {
        pending.finish();
      }
    }
  };

  pending.run = run;
  pending.timer = setTimeout(run, debounceMs);
  pendingBossRefreshes.set(guildId, pending);
  return pending.done;
}

module.exports = {
  bossImageRefreshEnabled,
  bossDailyAttackLimit,
  devBossHasUnlimitedAttacks,
  calamityBonusRewardBlock,
  bossBagRewardLine,
  fetchBossView,
  buildBossMessage,
  resolveAnnounceChannelId,
  redirectChannelIssue,
  warnRedirectFailure,
  warnLivePostFailure,
  postOfficialRedirect,
  postFreshLiveMessage,
  repointLiveMessage,
  deleteLiveMessage,
  refreshLiveMessage,
  refreshLiveMessageProgress,
  scheduleBossLiveRefresh,
};
