'use strict';

/**
 * BOSS SYSTEM — Master §16 (v4.1: 2-hour timer, boss art) + Phase 7 prompt.
 *
 * One active boss per guild (boss_state, PK guild_id). The scheduler tick
 * (schedulers/bossScheduler.js) drives spawn/escape/defeat-recovery; the
 * ⚔️ Attack and 📋 Log buttons route here from interactionHandler.
 *
 * Core invariants:
 *  - Spawn/escape/defeat transitions are ATOMIC SQL guards (status checks in
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
 *    no died_at; for 'escaped' expires_at is the end time naturally).
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
  AttachmentBuilder, MessageFlags,
} = require('discord.js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const pool = require('../db/pool');
const { resolveBattle } = require('./battleEngine');
const {
  buildPlayerFighter, buildBossFighter, computeBossStats, fetchAllBosses, fetchMobByName,
} = require('./statAssembly');
const { logEmbeds } = require('./battleRender');
const { awardCombatExpMany } = require('../utils/awardCombatExp');
const { isBanned } = require('../handlers/middleware');
const { smallDivider: sep } = require('../utils/componentsV2');
const { emojiForDisplay } = require('../utils/emojis');
const { grantTitles } = require('../utils/titleGrant');
const {
  assetPath,
  isRemoteAssetsEnabled,
  isRemoteSource,
  loadAssetImage: loadAssetImageSource,
  localAssetPath,
  readAssetText,
} = require('../utils/assets');
const { getCachedCanvasUrl } = require('../utils/canvasCache');
const { makeOptimizedAttachment } = require('../utils/imageOutput');
const { bossFeatTitlesFor } = require('../config/titles');
const {
  isGreaterBoss, bossRewards, rollBossChest, hpMultiplierForChest, pickWeightedBoss,
} = require('../config/bosses');

const RESPAWN_COOLDOWN = '15 minutes';   // §16: spawns every 15 min after dead/escaped
const BOSS_DURATION = '2 hours';         // v4.1: was 1h (schema comment is stale)
const TOP_N = 15;
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
const BOSS_ASSET_DIR = localAssetPath('monsters/boss');

/* ── in-memory state ────────────────────────────────────────────────────── */
const liveMessages = new Map();  // guildId → { channelId, messageId }
const logCache = new Map();      // `${spawnId}:${discordId}` → sim
const currentSpawn = new Map();  // guildId → spawnId (for logCache purging)
// [v4.6] Greater Boss chest rolled ONCE at spawn, keyed by spawn_id — the single source of
// truth shared by the announcement and the defeat payout (they can never disagree). In-memory
// only (no schema change); a restart loses it and chestForSpawn re-rolls for that spawn.
const greaterChests = new Map(); // spawnId → { column, qty, label }
// spawn_ids created by `crd dev spawnboss` — the daily/once-per-spawn attack
// rules are BYPASSED for these (multi-attack smoke testing). Regular scheduler
// spawns keep every rule. In-memory: a restart reverts a test boss to normal
// rules, which is fine for testing.
const devSpawns = new Set();

function rememberSpawn(guildId, spawnId) {
  const old = currentSpawn.get(guildId);
  if (old && old !== spawnId) {
    for (const key of logCache.keys()) {
      if (key.startsWith(`${old}:`)) logCache.delete(key);
    }
    greaterChests.delete(old);
  }
  currentSpawn.set(guildId, spawnId);
}

/**
 * [v4.6] The chest outcome for a spawn — the ONE place announcement and payout agree.
 * Normal bosses → deterministic 1× Boss Treasure Chest. Greater bosses → rolled 80/20 ONCE
 * and cached by spawn_id, so every read (announcement, every attacker's payout) is identical.
 */
function chestForSpawn(spawnId, bossName) {
  if (!isGreaterBoss(bossName)) return rollBossChest(bossName, Math.random); // fixed 1× treasure
  if (!greaterChests.has(spawnId)) greaterChests.set(spawnId, rollBossChest(bossName, Math.random));
  return greaterChests.get(spawnId);
}

/* ── boss art (slug per Roster & Asset Conventions Part 1) ──────────────── */
function bossSlug(name) {
  return String(name).toLowerCase()
    .replace(/['’]/g, '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/ð/g, 'd').replace(/þ/g, 'th')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

let bossAssetLookup = { mtimeMs: null, files: [], resolved: new Map() };

function bossAssetFiles() {
  const mtimeMs = fs.statSync(BOSS_ASSET_DIR).mtimeMs;
  if (bossAssetLookup.mtimeMs !== mtimeMs) {
    bossAssetLookup = {
      mtimeMs,
      files: fs.readdirSync(BOSS_ASSET_DIR).filter((f) => f.toLowerCase().endsWith('.png')),
      resolved: new Map(),
    };
  }
  return bossAssetLookup;
}

/** Exact `<slug>.png`, else a prefix-wildcard scan of the directory; null = no art (gallery omitted). */
function bossImagePath(name) {
  try {
    const slug = bossSlug(name);
    if (isRemoteAssetsEnabled()) return assetPath(`monsters/boss/${slug}.png`);
    const lookup = bossAssetFiles();
    if (lookup.resolved.has(slug)) return lookup.resolved.get(slug);

    const exactName = `${slug}.png`;
    const exactHit = lookup.files.includes(exactName) ? exactName : null;
    const hit = exactHit || lookup.files.find((f) => {
      const base = f.slice(0, -4).toLowerCase();
      return base.startsWith(slug) || slug.startsWith(base);
    });
    const resolved = hit ? path.join(BOSS_ASSET_DIR, hit) : null;
    lookup.resolved.set(slug, resolved);
    return resolved;
  } catch {
    return null;
  }
}

/* ── boss banner: letterbox the art onto a wide canvas so the MediaGallery
 *    renders full-width and centered (raw portrait PNGs render off-center).
 *    Rendered once per file, cached in memory. ─────────────────────────── */
const BANNER_W = 1200, BANNER_H = 600;
const bannerCache = new Map(); // imgPath → Promise<Buffer|null>

async function loadAssetImage(source) {
  return loadAssetImageSource(loadImage, source);
}

function bossBanner(imgPath) {
  if (!bannerCache.has(imgPath)) {
    bannerCache.set(imgPath, (async () => {
      try {
        const img = await loadAssetImage(imgPath);
        const canvas = createCanvas(BANNER_W, BANNER_H);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#1f2125';
        ctx.fillRect(0, 0, BANNER_W, BANNER_H);
        const scale = Math.min(BANNER_W / img.width, BANNER_H / img.height);
        const w = img.width * scale, h = img.height * scale;
        ctx.drawImage(img, (BANNER_W - w) / 2, (BANNER_H - h) / 2, w, h);
        return canvas.toBuffer('image/png');
      } catch (err) {
        console.warn('[boss] banner render failed:', err.message);
        return null;
      }
    })());
  }
  return bannerCache.get(imgPath);
}

/* ── boss lore (assets/monsters/boss/lore/boss_lores.txt: "Name: text") ──── */
const LORE_PATH = assetPath('monsters/boss/lore/boss_lores.txt');
let loreMap = null; // lazy-parsed once; mythology header lines have no text after ':' so they never match

async function bossLore(name) {
  if (loreMap === null) {
    loreMap = new Map();
    try {
      const txt = await readAssetText(LORE_PATH);
      for (const line of txt.split(/\r?\n/)) {
        const m = /^([A-Za-z'’ &]+):\s+(.+)$/.exec(line.trim());
        if (m) loreMap.set(m[1].trim().toLowerCase(), m[2].trim());
      }
    } catch (err) {
      console.warn('[boss] lore file unavailable:', err.message);
    }
  }
  return loreMap.get(String(name).toLowerCase()) || null;
}

/* ── boss status card — raid-card style, rendered at banner width so it
 *    lines up with the image above it. Name+Lv left / "· Boss" / HP text on
 *    the right, passive line, percentage-colored HP bar, stats row. Rendered
 *    fresh per update (HP changes); fonts registered by battleRender. ────── */
const FONT = 'DejaVu Sans';
const BOSS_STATUS_RENDER_REV = 1;
const CARD_COLORS = {
  bg: '#1f2125', card: '#26282d', cardLine: '#36393f',
  enemy: '#f23f43', text: '#e7e9ec', dim: '#9aa0a8', barBg: '#3b3e44',
};

function hpColor(p) {
  if (p > 0.5) return '#43d675';
  if (p > 0.25) return '#f0b232';
  return '#f23f43';
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function truncateToWidth(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

function renderBossStatusCard(state, mobRow) {
  const cur = Number(state.current_hp);
  const max = Number(state.max_hp);
  const p = max > 0 ? Math.max(0, Math.min(1, cur / max)) : 0;

  const W = BANNER_W, H = 190, PAD = 22;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = CARD_COLORS.bg;
  ctx.fillRect(0, 0, W, H);
  roundRectPath(ctx, PAD, PAD, W - PAD * 2, H - PAD * 2, 16);
  ctx.fillStyle = CARD_COLORS.card; ctx.fill();
  ctx.strokeStyle = CARD_COLORS.cardLine; ctx.lineWidth = 2.5; ctx.stroke();

  const L = PAD + 26, R = W - PAD - 26;
  ctx.textAlign = 'left';

  // row 1 — "✦ Name  Lv.N · Boss" left, "cur / max" HP right (same as raid card)
  let y = PAD + 40;
  ctx.font = `bold 28px ${FONT}`;
  ctx.fillStyle = CARD_COLORS.enemy;
  const nameText = `✦ ${mobRow.name}  Lv.${state.boss_level}`;
  ctx.fillText(nameText, L, y);
  const nw = ctx.measureText(nameText).width;
  ctx.font = `24px ${FONT}`; ctx.fillStyle = CARD_COLORS.dim;
  ctx.fillText('· Boss', L + nw + 14, y);
  ctx.font = `bold 26px ${FONT}`;
  ctx.fillStyle = hpColor(p);
  ctx.textAlign = 'right';
  ctx.fillText(`${cur.toLocaleString()} / ${max.toLocaleString()}`, R, y);
  ctx.textAlign = 'left';

  // row 2 — passive (transparency: players see what they're walking into)
  y += 36;
  const passive = mobRow.skill_name && mobRow.skill_name !== '—'
    ? `Passive: ${mobRow.skill_name} — ${mobRow.skill_description}`
    : `Passive: ${mobRow.skill_description || 'Basic attacks only.'}`;
  ctx.font = `21px ${FONT}`;
  ctx.fillStyle = CARD_COLORS.dim;
  ctx.fillText(truncateToWidth(ctx, passive, R - L), L, y);

  // HP bar — fills left→right, color by remaining percentage
  y += 18;
  const barW = R - L, barH = 16;
  roundRectPath(ctx, L, y, barW, barH, 7);
  ctx.fillStyle = CARD_COLORS.barBg; ctx.fill();
  if (p > 0) {
    roundRectPath(ctx, L, y, Math.max(barH, barW * p), barH, 7);
    ctx.fillStyle = hpColor(p); ctx.fill();
  }

  // row 3 — current stats (ATK from the spawn snapshot, CRIT live from roster)
  y += 48;
  const stats = [
    ['ATK', Number(state.scaled_atk).toLocaleString()],
    ['DEF', Number(state.scaled_def).toLocaleString()],
    ['CRIT', `${Number(mobRow.base_crit).toFixed(1)}%`],
  ];
  let sx = L;
  for (const [k, v] of stats) {
    ctx.font = `21px ${FONT}`; ctx.fillStyle = CARD_COLORS.dim;
    ctx.fillText(k, sx, y);
    const kw = ctx.measureText(`${k} `).width;
    ctx.font = `bold 23px ${FONT}`; ctx.fillStyle = CARD_COLORS.text;
    ctx.fillText(v, sx + kw, y);
    sx += kw + ctx.measureText(v).width + 34;
  }

  return canvas.toBuffer('image/png');
}

function bossStatusCacheParts(state, mobRow) {
  return {
    spawnId: state.spawn_id,
    status: state.status,
    mobId: state.mob_id,
    bossLevel: Number(state.boss_level),
    currentHp: Number(state.current_hp),
    maxHp: Number(state.max_hp),
    scaledAtk: Number(state.scaled_atk),
    scaledDef: Number(state.scaled_def),
    name: mobRow.name,
    crit: Number(mobRow.base_crit),
    skillName: mobRow.skill_name || '',
    skillDescription: mobRow.skill_description || '',
  };
}

async function bossStatusImage(state, mobRow) {
  const cached = await getCachedCanvasUrl(
    ['boss-status-card', BOSS_STATUS_RENDER_REV, bossStatusCacheParts(state, mobRow)],
    () => renderBossStatusCard(state, mobRow)
  );
  return cached
    ? { url: cached.url, file: null }
    : makeOptimizedAttachment(renderBossStatusCard(state, mobRow), 'boss_status');
}

/** Fetch everything the message needs in one place. Null when no boss_state row. */
async function fetchBossView(guildId) {
  const stateRes = await pool.query(
    `SELECT guild_id, spawn_id, mob_id, boss_level, max_hp, current_hp,
            scaled_atk, scaled_def, expires_at, status
       FROM boss_state
      WHERE guild_id = $1`,
    [guildId]
  );
  if (stateRes.rows.length === 0) return null;
  const state = stateRes.rows[0];
  const [mobRes, atkRes, countRes] = await Promise.all([
    pool.query(
      `SELECT mob_id, name, mythology, base_crit, skill_name, skill_description
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
    isDev: devSpawns.has(state.spawn_id),
  };
}

/**
 * Full CV2 payload (components + files + flags) for the current view.
 * Layout: "## <Boss>" header → separator → banner image → boss status canvas →
 * separator → lore → separator → rewards → separator → Top 15 → separator →
 * footer + buttons.
 */
async function buildBossMessage({ state, mobRow, attackers, attackerCount, isDev = false }) {
  const { status } = state;

  const greater = isGreaterBoss(mobRow.name);

  // header — evocative flavor line (mythology-flavored, or Greater apex framing) above
  // the boss name; terminal states swap the flavor for a small status subtext
  let header;
  if (status === 'active') {
    const flavor = greater ? GREATER_FLAVOR : (BOSS_FLAVOR[mobRow.mythology] || BOSS_FLAVOR._default);
    header = `${flavor}\n## ${mobRow.name}`;
  } else {
    header = `## ${mobRow.name}`;
    if (status === 'dead') header += '\n-# 💀 Slain by the united server — rewards distributed!';
    else if (status === 'escaped') header += '\n-# 🌫️ Escaped — no rewards this time.';
  }

  const accent = status === 'active' ? 0xf0b232 : status === 'dead' ? 0x43d675 : 0x95a5a6;
  const container = new ContainerBuilder()
    .setAccentColor(accent)
    .addTextDisplayComponents((td) => td.setContent(header))
    .addSeparatorComponents(sep);

  // boss art, letterboxed full-width + centered (mob_roster has no image
  // column — filename derived by convention)
  const files = [];
  const imgPath = bossImagePath(mobRow.name);
  if (imgPath && isRemoteSource(imgPath)) {
    container.addMediaGalleryComponents((g) =>
      g.addItems((item) => item.setURL(imgPath))
    );
  } else {
    const banner = imgPath ? await bossBanner(imgPath) : null;
    if (banner) {
      files.push(new AttachmentBuilder(banner, { name: 'boss_banner.png' }));
      container.addMediaGalleryComponents((g) =>
        g.addItems((item) => item.setURL('attachment://boss_banner.png'))
      );
    }
  }

  container.addSeparatorComponents(sep);
  try {
    const card = await bossStatusImage(state, mobRow);
    if (card.file) files.push(card.file);
    container.addMediaGalleryComponents((g) =>
      g.addItems((item) => item.setURL(card.url))
    );
  } catch (err) {
    console.warn('[boss] status card render failed:', err.message);
  }

  // lore — plain text wraps to the embed width on its own
  const lore = await bossLore(mobRow.name);
  if (lore) {
    container
      .addSeparatorComponents(sep)
      .addTextDisplayComponents((td) => td.setContent(`-# ${lore}`));
  }

  // participation rewards (§16 — normal vs Greater amounts from config/bosses)
  const reward = bossRewards(mobRow.name);
  const creduxIcon = emojiForDisplay('Credux Coin', '💰');
  const expIcon = emojiForDisplay('Combat Exp', '✨');
  const chestIcon = emojiForDisplay('Boss Treasure Chest', '🗝️');
  const goldChestIcon = emojiForDisplay('Boss Golden Chest', '🪙');
  const shardIcon = emojiForDisplay('Belief Shards', '🔮');
  // [v4.6] Greater chest is rolled ONCE at spawn — show the ACTUAL chest this fight awards
  // (not the 80/20 rule), keyed off the same source the payout uses so they never disagree.
  const spawnChest = chestForSpawn(state.spawn_id, mobRow.name);
  const spawnChestIcon = spawnChest.column === 'boss_golden_chest' ? goldChestIcon : chestIcon;
  // [v4.8] drop the "(this fight)" qualifier — redundant; rewards are understood to be this boss's.
  const chestLine = `${spawnChestIcon} ${spawnChest.label} ×${spawnChest.qty}`;
  container
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent(
      `**Participation rewards if defeated:**${greater ? '  ☠️ *Greater*' : ''}\n` +
      `${creduxIcon} Credux ×${reward.credux.toLocaleString()}\n` +
      `${expIcon} Combat EXP ×${reward.exp.toLocaleString()}\n` +
      `${chestLine}\n` +
      `${shardIcon} Belief Shards ×${reward.shards.toLocaleString()}`
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

  // footer (Discord relative timestamp self-counts — no edits needed) + buttons
  const expUnix = Math.floor(new Date(state.expires_at).getTime() / 1000);
  let footerText;
  if (status === 'active') {
    footerText = isDev
      ? `-# Disappears <t:${expUnix}:R> ・ 🧪 test boss — unlimited attacks until restart`
      : `-# Disappears <t:${expUnix}:R> ・ ⚔️ one boss attack per player per day (global)`;
  } else if (status === 'dead') {
    footerText = `-# Rewards distributed to all ${attackerCount} challenger${attackerCount === 1 ? '' : 's'}.`;
  } else {
    footerText = `-# Escaped <t:${expUnix}:R> — no rewards. Next spawn ~15 min after.`;
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
  const { rows } = await pool.query(
    'SELECT boss_announcement_channel_id FROM server_config WHERE guild_id = $1',
    [guildId]
  );
  return rows[0]?.boss_announcement_channel_id || null;
}

/** Post a fresh boss message in the configured (or hinted) channel and repoint the Map. */
async function postFreshLiveMessage(client, guildId, payload, channelIdHint = null) {
  const channelId = channelIdHint
    || liveMessages.get(guildId)?.channelId
    || await resolveAnnounceChannelId(guildId);
  if (!channelId) return null;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return null;
  const msg = await channel.send(payload).catch((err) => {
    console.error(`[boss] post failed (guild ${guildId}):`, err.message);
    return null;
  });
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
  const ref = liveMessages.get(guildId);
  liveMessages.delete(guildId);
  if (!ref) return;
  const channel = await client.channels.fetch(ref.channelId).catch(() => null);
  const msg = channel ? await channel.messages.fetch(ref.messageId).catch(() => null) : null;
  if (msg) await msg.delete().catch(() => {}); // Unknown Message / already gone → ignore
}

/**
 * Re-render the tracked message from fresh DB state; ANY edit/fetch failure
 * (deleted message, restart-empty Map) → fresh message + repoint.
 */
async function refreshLiveMessage(client, guildId) {
  const view = await fetchBossView(guildId);
  if (!view) return;
  rememberSpawn(guildId, view.state.spawn_id);
  const payload = await buildBossMessage(view);
  const ref = liveMessages.get(guildId);
  if (ref) {
    const channel = await client.channels.fetch(ref.channelId).catch(() => null);
    const msg = channel ? await channel.messages.fetch(ref.messageId).catch(() => null) : null;
    if (msg) {
      const edited = await msg.edit(payload).catch(() => null);
      if (edited) return;
    }
  }
  await postFreshLiveMessage(client, guildId, payload);
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
 * weighted pick — Greater bosses still get their 2× HP. Returns false if no boss
 * by that name exists.
 */
async function spawnBoss(client, guildId, { force = false, channelId = null, bossName = null } = {}) {
  const announceChannelId = channelId || await resolveAnnounceChannelId(guildId);
  if (!announceChannelId) return false; // nowhere to announce — skip guild

  // §16: server average level over REGISTERED players active in this guild
  const avgRes = await pool.query(
    `SELECT AVG(uc.combat_level) AS avg_level
       FROM user_guild_activity uga
       JOIN user_character uc ON uc.discord_id = uga.discord_id
      WHERE uga.guild_id = $1`,
    [guildId]
  );
  const avg = avgRes.rows[0]?.avg_level;
  if (avg == null) return false; // no registered characters yet — skip

  // [v4.4] forced boss (dev) by name, else the weighted tier roll (20% Greater / 80%).
  let pick;
  if (bossName) {
    const named = await fetchMobByName(pool, bossName);
    if (!named || named.mob_type !== 'boss') return false; // unknown boss name
    pick = { row: named, greater: isGreaterBoss(named.name) };
  } else {
    pick = pickWeightedBoss(await fetchAllBosses(pool), Math.random);
  }
  if (!pick) return false;
  const { row, greater } = pick;

  // §16: boss level = round(avg) + random(1–10) — NO [1,55] clamp (bosses are
  // exempt; that clamp governs raid mobs only). Defensive floor at 1.
  const level = Math.max(1, Math.round(Number(avg)) + 1 + Math.floor(Math.random() * 10));
  const stats = computeBossStats(row, level);
  // [RenderTweaks] Greater Bosses: HP multiplier is tied to the chest rolled at spawn —
  // Golden chest (rare 20%) → 3× HP, Treasure chest → 2× HP. Roll the chest ONCE here so the
  // HP and the payout/announcement share the same outcome; the same object is stashed in
  // greaterChests below (keyed by the DB-generated spawn_id) so chestForSpawn never re-rolls.
  // Bosses have no stored total-HP column, so the multiplier applies to the scaled result.
  const spawnChest = greater ? rollBossChest(row.name, Math.random) : null;
  const maxHp = greater ? stats.hp * hpMultiplierForChest(spawnChest) : stats.hp;

  const ins = await pool.query(
    `INSERT INTO boss_state
       (guild_id, spawn_id, mob_id, boss_level, max_hp, current_hp,
        scaled_atk, scaled_def, spawn_at, expires_at, status)
     VALUES ($1, gen_random_uuid(), $2, $3, $4, $4, $5, $6,
             NOW(), NOW() + INTERVAL '${BOSS_DURATION}', 'active')
     ON CONFLICT (guild_id) DO UPDATE SET
       spawn_id = gen_random_uuid(), mob_id = EXCLUDED.mob_id,
       boss_level = EXCLUDED.boss_level, max_hp = EXCLUDED.max_hp,
       current_hp = EXCLUDED.current_hp, scaled_atk = EXCLUDED.scaled_atk,
       scaled_def = EXCLUDED.scaled_def, spawn_at = NOW(),
       expires_at = NOW() + INTERVAL '${BOSS_DURATION}', status = 'active'
     WHERE boss_state.status <> 'active'
       AND ($7 OR boss_state.expires_at <= NOW() - INTERVAL '${RESPAWN_COOLDOWN}')
     RETURNING spawn_id`,
    [guildId, row.mob_id, level, maxHp, stats.atk, stats.def, force]
  );
  if (ins.rows.length === 0) return false; // lost the race / cooldown not over

  // [RenderTweaks] Stash the chest rolled above against the new spawn_id so the HP mult,
  // announcement, and payout all read the SAME outcome — chestForSpawn returns this without
  // re-rolling. (Normal bosses keep their lazy deterministic 1× Treasure roll.)
  if (spawnChest) greaterChests.set(ins.rows[0].spawn_id, spawnChest);

  if (force) devSpawns.add(ins.rows[0].spawn_id); // test boss: attack rules bypassed
  rememberSpawn(guildId, ins.rows[0].spawn_id);
  const view = await fetchBossView(guildId);
  if (view) {
    await postFreshLiveMessage(client, guildId, await buildBossMessage(view), announceChannelId);
  }
  return true;
}

/** Flip an overdue active boss to 'escaped' (atomic). [Jun-2026 §8] The countdown message is
 *  DELETED at 0s rather than left as an expired "Next spawn" card. */
async function expireBoss(client, guildId) {
  const res = await pool.query(
    `UPDATE boss_state SET status = 'escaped'
      WHERE guild_id = $1 AND status = 'active' AND expires_at <= NOW()
      RETURNING spawn_id`,
    [guildId]
  );
  if (res.rows.length === 0) return false;
  await deleteLiveMessage(client, guildId).catch(() => {});
  return true;
}

/* ── defeat distribution (§16 participation-only, exactly-once) ─────────── */

/**
 * Distribute participation rewards. The status flip and ALL payouts share one
 * transaction — exactly-once even under concurrent triggers (the row lock on
 * boss_state makes the loser of the race see 0 flipped rows and roll back).
 * Returns the attacker count, or null when nothing was distributed.
 */
async function distributeRewards(client, guildId, spawnId) {
  const dbc = await pool.connect();
  let attackerIds = [];
  let reward = null;
  let chest = null;
  try {
    await dbc.query('BEGIN');
    // expires_at = NOW() anchors the 15-min respawn clock (no died_at column)
    const flip = await dbc.query(
      `UPDATE boss_state SET status = 'dead', expires_at = NOW()
        WHERE guild_id = $1 AND spawn_id = $2 AND status = 'active' AND current_hp <= 0
        RETURNING mob_id`,
      [guildId, spawnId]
    );
    if (flip.rows.length === 0) {
      await dbc.query('ROLLBACK');
      return null; // already distributed (or boss not actually down)
    }

    // [v4.4] reward bundle + chest keyed off the boss's greater-ness (config/bosses —
    // the SAME source the announcement reads, so they never disagree). The Greater
    // chest is rolled ONCE here; every attacker receives the same outcome.
    const nameRes = await dbc.query('SELECT name FROM mob_roster WHERE mob_id = $1', [flip.rows[0].mob_id]);
    const bossName = nameRes.rows[0]?.name || '';
    reward = bossRewards(bossName);
    // [v4.6] the chest fixed at spawn — same outcome the announcement showed, paid to all.
    chest = chestForSpawn(spawnId, bossName); // { column (whitelisted), qty, label }

    const atk = await dbc.query(
      `SELECT discord_id FROM boss_attack_log
        WHERE boss_spawn_id = $1 ORDER BY discord_id`,
      [spawnId]
    );
    attackerIds = atk.rows.map((r) => r.discord_id);

    if (attackerIds.length > 0) {
      // lock order: users_bag (sorted) → user_character (sorted) — Phase-5
      // convention; the explicit sorted SELECT guarantees acquisition order
      await dbc.query(
        `SELECT discord_id FROM users_bag
          WHERE discord_id = ANY($1) ORDER BY discord_id FOR UPDATE`,
        [attackerIds]
      );
      // chest.column is from a fixed whitelist (boss_treasure_chest / boss_golden_chest)
      const bagUpd = await dbc.query(
        `UPDATE users_bag
            SET credux = credux + $2,
                belief_shards = belief_shards + $3,
                lifetime_credux_earned = lifetime_credux_earned + $2,
                ${chest.column} = ${chest.column} + $4
          WHERE discord_id = ANY($1)
          RETURNING discord_id, credux, belief_shards, ${chest.column} AS chest_count`,
        [attackerIds, reward.credux, reward.shards, chest.qty]
      );

      await awardCombatExpMany(dbc, attackerIds, reward.exp);

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
        prevSh.push(r.belief_shards - reward.shards);
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
    }

    await dbc.query('COMMIT');
  } catch (err) {
    await dbc.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    dbc.release();
  }

  // post-commit presentation (failures here never affect the payouts)
  await refreshLiveMessage(client, guildId).catch(() => {});
  const view = await fetchBossView(guildId).catch(() => null);
  if (view) {
    const channelId = liveMessages.get(guildId)?.channelId || await resolveAnnounceChannelId(guildId);
    const channel = channelId ? await client.channels.fetch(channelId).catch(() => null) : null;
    if (channel) {
      // reward/chest fall back to the boss-name lookup if distribution found no attackers
      const r = reward || bossRewards(view.mobRow.name);
      const c = chest || { qty: 1, label: 'Boss Treasure Chest' };
      const greater = isGreaterBoss(view.mobRow.name);
      await channel.send({
        content:
          `🎉 ${greater ? '☠️ **GREATER** ' : ''}**${view.mobRow.name}** has fallen! ` +
          `All **${attackerIds.length}** challenger${attackerIds.length === 1 ? '' : 's'} receive: ` +
          `${r.credux.toLocaleString()} Credux · ${r.exp.toLocaleString()} Combat EXP · ${c.qty}× ${c.label} · ${r.shards.toLocaleString()} Belief Shards.`,
        allowedMentions: { parse: [] },
      }).catch(() => {});
    }
  }
  return attackerIds.length;
}

/* ── ⚔️ Attack button ───────────────────────────────────────────────────── */
async function handleAttack(interaction) {
  const guildId = interaction.guildId;
  const discordId = interaction.user.id;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const fail = (msg) => interaction.editReply({ content: msg }).catch(() => {});

  try {
    // gate 1 — registered + character
    const fighter = await buildPlayerFighter(pool, discordId);
    if (!fighter) {
      return fail('You need a character first — `crd register`, then `crd create character`.');
    }
    // gate 2 — not banned (buttons bypass message middleware)
    if (await isBanned(discordId)) {
      return fail('You cannot attack the boss right now.');
    }
    // gate 3 — boss still active and not expired
    const stRes = await pool.query('SELECT * FROM boss_state WHERE guild_id = $1', [guildId]);
    const state = stRes.rows[0];
    if (!state || state.status !== 'active' || new Date(state.expires_at) <= new Date()) {
      return fail('There is no active boss right now — it has fallen or escaped. `crd boss` shows the latest status.');
    }
    // dev-spawned test boss (crd dev spawnboss): the daily lock and the
    // once-per-spawn rule are BYPASSED so testers can attack repeatedly;
    // damage accumulates on their boss_attack_log row instead
    const isDev = devSpawns.has(state.spawn_id);
    if (!isDev) {
      // gate 4 — global daily lock (one boss attack per day, PHT clock — DB-4)
      const dl = await pool.query(
        `SELECT 1 FROM users
          WHERE discord_id = $1
            AND last_boss_attack_date >= (NOW() AT TIME ZONE 'Asia/Manila')::date`,
        [discordId]
      );
      if (dl.rows.length > 0) {
        return fail('You already attacked a boss today — your attack resets at midnight PHT.');
      }
      // gate 5 — not already attacked THIS spawn
      const al = await pool.query(
        'SELECT 1 FROM boss_attack_log WHERE boss_spawn_id = $1 AND discord_id = $2',
        [state.spawn_id, discordId]
      );
      if (al.rows.length > 0) {
        return fail('You already attacked this boss.');
      }
    }
    // gate 6 — no live battle: claim the active_battles slot (reaper covers crashes)
    const mobRes = await pool.query('SELECT * FROM mob_roster WHERE mob_id = $1', [state.mob_id]);
    const mobRow = mobRes.rows[0];
    if (!mobRow) return fail('Boss data is missing — try again shortly.');
    const claim = await pool.query(
      `INSERT INTO active_battles
         (discord_id, channel_id, message_id, battle_type, mob_id, enemy_level,
          player_hp, player_max_hp, enemy_hp, enemy_max_hp, current_turn, player_goes_first)
       VALUES ($1, $2, '0', 'boss', $3, $4, $5, $5, $6, $7, 1, TRUE)
       ON CONFLICT (discord_id) DO NOTHING
       RETURNING battle_id`,
      [
        discordId, interaction.channelId, state.mob_id, state.boss_level,
        fighter.hp, Number(state.current_hp), Number(state.max_hp),
      ]
    );
    if (claim.rows.length === 0) {
      return fail('⚔️ You are already in a battle — wait for it to finish.');
    }

    try {
      // fresh pool snapshot at fight start — concurrent attackers may have
      // chipped it since the gate; "enemy HP < X%" passives read pool % (§35.4)
      const fresh = await pool.query(
        `SELECT current_hp FROM boss_state
          WHERE guild_id = $1 AND spawn_id = $2 AND status = 'active' AND current_hp > 0`,
        [guildId, state.spawn_id]
      );
      if (fresh.rows.length === 0) {
        return fail('The boss just fell before your strike landed!');
      }
      state.current_hp = fresh.rows[0].current_hp;

      const boss = buildBossFighter(mobRow, state);
      const sim = resolveBattle(fighter, boss, { mode: 'boss', seed: Date.now() >>> 0 });
      const net = Math.max(0, Math.floor(sim.totals.netDamage));

      // atomic commit — pool deduction, attack log, daily lock
      const dbc = await pool.connect();
      let remaining = null;
      try {
        await dbc.query('BEGIN');
        const upd = await dbc.query(
          `UPDATE boss_state SET current_hp = GREATEST(current_hp - $3, 0)
            WHERE guild_id = $1 AND spawn_id = $2 AND status = 'active' AND current_hp > 0
            RETURNING current_hp`,
          [guildId, state.spawn_id, net]
        );
        if (upd.rows.length === 0) {
          await dbc.query('ROLLBACK');
          return fail('The boss just fell before your strike landed!'); // daily lock NOT consumed
        }
        // dev test boss: repeat attacks ACCUMULATE damage on the same row;
        // regular boss: one row per spawn, conflict = double-press race
        const ins = await dbc.query(
          `INSERT INTO boss_attack_log
             (boss_spawn_id, guild_id, discord_id, mob_id, total_damage, last_daily_reset)
           VALUES ($1, $2, $3, $4, $5, (NOW() AT TIME ZONE 'Asia/Manila')::date)
           ON CONFLICT (boss_spawn_id, discord_id) ${isDev
            ? 'DO UPDATE SET total_damage = boss_attack_log.total_damage + EXCLUDED.total_damage, attacked_at = NOW()'
            : 'DO NOTHING'}
           RETURNING id`,
          [state.spawn_id, guildId, discordId, state.mob_id, net]
        );
        if (ins.rows.length === 0) {
          await dbc.query('ROLLBACK');
          return fail('You already attacked this boss.'); // double-press race
        }
        // [v5 Phase 5b] track highest single-attack boss damage (leaderboard metric)
        await dbc.query(
          'UPDATE user_character SET boss_top_damage = GREATEST(boss_top_damage, $2) WHERE discord_id = $1',
          [discordId, net]
        );
        if (!isDev) {
          // test bosses never consume the global daily lock
          await dbc.query(
            `UPDATE users SET last_boss_attack_date = (NOW() AT TIME ZONE 'Asia/Manila')::date
              WHERE discord_id = $1`,
            [discordId]
          );
        }
        await dbc.query('COMMIT');
        remaining = Number(upd.rows[0].current_hp);
      } catch (err) {
        await dbc.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        dbc.release();
      }

      logCache.set(`${state.spawn_id}:${discordId}`, sim);
      rememberSpawn(guildId, state.spawn_id);

      if (remaining <= 0) {
        await distributeRewards(interaction.client, guildId, state.spawn_id);
      } else {
        await refreshLiveMessage(interaction.client, guildId);
      }

      const survived = sim.outcome === 'boss_timeout';
      await interaction.editReply({
        content:
          `You dealt **${net.toLocaleString()}** damage to **${mobRow.name}**` +
          `${survived ? ' and survived all 50 rounds!' : '!'} Tap 📋 Log for the blow-by-blow.`,
      }).catch(() => {});
    } finally {
      await pool.query('DELETE FROM active_battles WHERE discord_id = $1', [discordId])
        .catch(() => {});
    }
  } catch (err) {
    console.error('[boss] attack error:', err);
    await fail('Something went wrong with your attack — nothing was consumed.');
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
    await interaction.editReply({ embeds: pages.slice(0, 10) });
    for (let p = 10; p < pages.length; p += 10) {
      await interaction.followUp({ embeds: pages.slice(p, p + 10), flags: MessageFlags.Ephemeral });
    }
  } catch (err) {
    console.error('[boss] log error:', err);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: 'Could not load the boss log right now.' }).catch(() => {});
    }
  }
}

/* ── scheduler entry — one guild per call ───────────────────────────────── */
async function tickGuild(client, guildId) {
  const stRes = await pool.query('SELECT * FROM boss_state WHERE guild_id = $1', [guildId]);
  const state = stRes.rows[0] || null;

  if (state && state.status === 'active') {
    if (Number(state.current_hp) <= 0) {
      // crash-recovery safety net: distribution didn't finish — re-run it
      await distributeRewards(client, guildId, state.spawn_id);
      return;
    }
    if (new Date(state.expires_at) <= new Date()) {
      await expireBoss(client, guildId);
    }
    return;
  }

  // no row, or terminal state — the spawn UPSERT's WHERE enforces the 15-min rule
  await spawnBoss(client, guildId);
}

module.exports = {
  tickGuild,
  spawnBoss,
  expireBoss,
  distributeRewards,
  handleAttack,
  handleLog,
  fetchBossView,
  buildBossMessage,
  repointLiveMessage,
  refreshLiveMessage,
};
