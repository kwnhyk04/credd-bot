'use strict';

/**
 * bossRender.js — boss art, banner cache, lore, and the status card
 * (Phase 2.1 split of bossSystem.js; all bodies moved VERBATIM).
 *
 * Owns the render-side module state: the banner LRU (bannerCache +
 * bannerCacheBytes), the boss asset lookup, the lore map, and
 * lastBossStatusUrls — bossStatusImage is that map's only setter, so it lives
 * here and exposes purge helpers the runtime purge paths call.
 *
 * The reassignable bindings (bossAssetLookup, bannerCacheBytes, loreMap) are
 * read via renderMemoryStats() rather than exported directly: a destructured
 * import would freeze their values at require time.
 *
 * bossCrit and bossImageMaxWidth live here because both the status card and
 * code remaining in bossSystem call them, and this module must never require
 * the facade (that would create a cycle).
 */

const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const {
  assetPath,
  assetSignatureSync,
  clearAssetCacheFor,
  isRemoteAssetsEnabled,
  isRemoteSource,
  loadAssetImage: loadAssetImageSource,
  localAssetPath,
  readAssetText,
} = require('../../utils/assets');
const { getCachedCanvasUrl } = require('../../utils/canvasCache');
const { makeOptimizedAttachment, attachmentFromOptimizedImage } = require('../../utils/imageOutput');
const { discordImageAttachmentsAllowed } = require('../../utils/egressGuard');
const { encodeOpaqueCanvas } = require('../../utils/canvasEncode');
const r2 = require('../../utils/r2Client');
const {
  envBool, envNumber, envPositiveInt, bandwidthLog, performanceLog,
} = require('../../utils/runtimeLogs');
const { beginActivity } = require('../../utils/networkTelemetry');
const { isGreaterBoss, isCalamityBoss } = require('../../config/bosses');

const BOSS_ASSET_DIR = localAssetPath('monsters/boss');

const lastBossStatusUrls = new Map(); // guildId -> { spawnId, status, currentHp, maxHp, url }

function bossImageMaxWidth() {
  return Math.floor(envNumber('BOSS_IMAGE_MAX_WIDTH', 0, { min: 0, max: 4096 }));
}

function bossCrit(mobRow) {
  return Number(mobRow?.base_crit || 0);
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
const BANNER_CACHE_MAX_ENTRIES = envPositiveInt('BOSS_BANNER_CACHE_MAX', 4, { max: 100 });
const BANNER_CACHE_MAX_BYTES = Math.max(
  1024 * 1024,
  envNumber('BOSS_BANNER_CACHE_MAX_MB', 8, { min: 1, max: 256 }) * 1024 * 1024
);
const BANNER_CACHE_TTL_MS = Math.max(
  0,
  envNumber('BOSS_BANNER_CACHE_TTL_MS', 600_000, { min: 0, max: 86_400_000 })
);
const BOSS_REMOTE_VERSION_CACHE_TTL_MS = Math.max(
  0,
  envNumber('BOSS_REMOTE_VERSION_CACHE_TTL_MS', 600_000, { min: 0, max: 86_400_000 })
);
const BOSS_REMOTE_VERSION_CACHE_MAX_ENTRIES = envPositiveInt(
  'BOSS_REMOTE_VERSION_CACHE_MAX', 16, { max: 100 }
);
const bannerCache = new Map(); // `${imgPath}\0${signature}` → { promise, bytes, lastUsed }
const bossAssetSignatures = new Map(); // imgPath → current local mtime/size or remote asset version
const bossRemoteVersions = new Map(); // object key → { version, checkedAt }
let bannerCacheBytes = 0;

function dropBossBanner(key) {
  const entry = bannerCache.get(key);
  if (!entry) return;
  bannerCache.delete(key);
  bannerCacheBytes = Math.max(0, bannerCacheBytes - entry.bytes);
}

function trimBossBanners(now = Date.now()) {
  if (BANNER_CACHE_TTL_MS) {
    for (const [key, entry] of bannerCache) {
      if (now - entry.lastUsed > BANNER_CACHE_TTL_MS) dropBossBanner(key);
    }
  }
  while (bannerCache.size > BANNER_CACHE_MAX_ENTRIES || bannerCacheBytes > BANNER_CACHE_MAX_BYTES) {
    dropBossBanner(bannerCache.keys().next().value);
  }
}

async function loadAssetImage(source) {
  return loadAssetImageSource(loadImage, source);
}

function appendBossAssetVersion(url, version) {
  if (!url || !version) return url;
  return `${url}${url.includes('?') ? '&' : '?'}r2v=${encodeURIComponent(version)}`;
}

function rememberBossRemoteVersion(key, version) {
  if (!version) return;
  bossRemoteVersions.delete(key);
  bossRemoteVersions.set(key, { version, checkedAt: Date.now() });
  while (bossRemoteVersions.size > BOSS_REMOTE_VERSION_CACHE_MAX_ENTRIES) {
    bossRemoteVersions.delete(bossRemoteVersions.keys().next().value);
  }
}

/** Resolve a boss image with a bounded, R2-origin-backed cache version. */
async function bossImagePathForMessage(name, { forceAssetRefresh = false } = {}) {
  const imgPath = bossImagePath(name);
  if (!isRemoteSource(imgPath) || !r2.isConfigured()) return imgPath;
  const key = `monsters/boss/${bossSlug(name)}.png`;
  const cached = bossRemoteVersions.get(key);
  const cacheFresh = cached
    && BOSS_REMOTE_VERSION_CACHE_TTL_MS > 0
    && Date.now() - cached.checkedAt < BOSS_REMOTE_VERSION_CACHE_TTL_MS;
  let version = cacheFresh && !forceAssetRefresh ? cached.version : null;
  if (!version) {
    const metadata = await r2.headObject(key);
    version = metadata?.etag
      || [metadata?.lastModified, metadata?.contentLength].filter(Boolean).join(':');
    if (version) rememberBossRemoteVersion(key, version);
    else version = cached?.version || null;
  }
  return appendBossAssetVersion(imgPath, version);
}

function bossAssetSignature(imgPath) {
  if (!imgPath) return null;
  if (isRemoteSource(imgPath)) {
    try { return assetSignatureSync(imgPath); } catch { return imgPath; }
  }
  try {
    const stat = fs.statSync(imgPath);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return imgPath;
  }
}

function dropBossBannersForPath(imgPath) {
  const prefix = `${imgPath}\0`;
  for (const key of bannerCache.keys()) {
    if (key.startsWith(prefix)) dropBossBanner(key);
  }
}

function bossBanner(imgPath) {
  const signature = bossAssetSignature(imgPath);
  const previousSignature = bossAssetSignatures.get(imgPath);
  if (previousSignature !== signature) {
    // Local files keep the same path when an art asset is replaced; clear only
    // that decoded source and rendered banner when its bounded signature changes.
    if (!isRemoteSource(imgPath)) clearAssetCacheFor(imgPath);
    dropBossBannersForPath(imgPath);
    bossAssetSignatures.delete(imgPath);
    bossAssetSignatures.set(imgPath, signature);
  }
  while (bossAssetSignatures.size > BANNER_CACHE_MAX_ENTRIES) {
    bossAssetSignatures.delete(bossAssetSignatures.keys().next().value);
  }
  const cacheKey = `${imgPath}\0${signature}`;
  const cached = bannerCache.get(cacheKey);
  if (cached) {
    cached.lastUsed = Date.now();
    bannerCache.delete(cacheKey);
    bannerCache.set(cacheKey, cached);
    return cached.promise;
  }
  const entry = { bytes: 0, lastUsed: Date.now(), promise: null };
  entry.promise = (async () => {
    try {
      const img = await loadAssetImage(imgPath);
      const canvas = createCanvas(BANNER_W, BANNER_H);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#1f2125';
      ctx.fillRect(0, 0, BANNER_W, BANNER_H);
      const scale = Math.min(BANNER_W / img.width, BANNER_H / img.height);
      const w = img.width * scale, h = img.height * scale;
      ctx.drawImage(img, (BANNER_W - w) / 2, (BANNER_H - h) / 2, w, h);
      const buffer = encodeOpaqueCanvas(canvas, { system: 'boss', command: 'boss', imageType: 'boss_banner' });
      if (bannerCache.get(cacheKey) === entry) {
        entry.bytes = buffer.length;
        bannerCacheBytes += entry.bytes;
        trimBossBanners();
      }
      return buffer;
    } catch (err) {
      console.warn('[boss] banner render failed:', err.message);
      return null;
    }
  })();
  bannerCache.set(cacheKey, entry);
  trimBossBanners();
  return entry.promise;
}

/* ── boss lore (assets/monsters/boss/lore/{boss_lores,boss}.txt: "Name: text") ── */
// `boss_lores.txt` is the canonical R2 object. `boss.txt` is accepted as a
// compatibility alias because older asset uploads used that shorter filename.
const LORE_PATHS = [
  assetPath('monsters/boss/lore/boss_lores.txt'),
  assetPath('monsters/boss/lore/boss.txt'),
];
// Bakunawa is an event-only boss. Keep its authored lore available when a
// deployment has the code but the separately managed R2 text asset has not
// been uploaded yet; a loaded asset always takes precedence.
const BOSS_LORE_FALLBACKS = Object.freeze({
  bakunawa: 'A colossal sea serpent from Visayan mythology in the Philippines, sometimes described as a dragon or naga. The myth is pre-colonial and tied to the Visayan lunar calendar, where it served to explain and track eclipses. Old accounts give it a mouth the size of a lake, a red tongue, whiskers, gills, and a row of pale spines running down its back. It sleeps in the deepest trenches of the sea and rises only to feed.',
});
let loreMap = null; // mythology header lines have no text after ':' so they never match

async function bossLore(name) {
  if (loreMap === null) {
    loreMap = new Map();
    let loaded = false;
    for (const lorePath of LORE_PATHS) {
      try {
        const txt = await readAssetText(lorePath);
        loaded = true;
        for (const line of txt.split(/\r?\n/)) {
          const m = /^([^:]+):\s+(.+)$/.exec(line.trim());
          if (m) loreMap.set(m[1].trim().toLowerCase(), m[2].trim());
        }
      } catch (err) {
        // The alias is optional; report only when neither supported file loads.
        if (lorePath === LORE_PATHS.at(-1) && !loaded) {
          console.warn('[boss] lore file unavailable:', err.message);
        }
      }
    }
  }
  const key = String(name).trim().toLowerCase();
  return loreMap.get(key) || BOSS_LORE_FALLBACKS[key] || null;
}

/* ── boss status card — raid-card style, rendered at banner width so it
 *    lines up with the image above it. Name / "· Boss" / HP text on
 *    the right, passive line, percentage-colored HP bar, stats row. Rendered
 *    fresh per update (HP changes). ─────────────────────────────────────── */
// This module used to draw with a bare 'DejaVu Sans' and register nothing, relying on
// battleRender having been required first. That made correct text vs. empty boxes a
// function of module load order. Fonts now come from the one registry, which registers
// assets/fonts synchronously at require time; FONT is the full CSS family list
// (primary + Unicode fallbacks) and is interpolated UNQUOTED into ctx.font.
const { fontStack } = require('../../utils/fontRegistry');
const FONT = fontStack();
const BOSS_STATUS_RENDER_REV = 6;
const STATUS_PASSIVE_MAX_LINES = 4;
const STATUS_PASSIVE_LINE_HEIGHT = 26;
const STATUS_CARD_MIN_HEIGHT = 190;
const CARD_COLORS = {
  bg: '#1f2125', card: '#26282d', cardLine: '#36393f',
  enemy: '#f23f43', text: '#e7e9ec', dim: '#9aa0a8', barBg: '#3b3e44',
};

const { hpColor } = require('../../utils/canvasDraw');

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

function wrapToWidth(ctx, text, maxW, maxLines) {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    const candidate = current ? `${current} ${word}` : word;
    if (!current || ctx.measureText(candidate).width <= maxW) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length === maxLines - 1) {
      const remainder = [current, ...words.slice(index + 1)].join(' ');
      lines.push(truncateToWidth(ctx, remainder, maxW));
      return lines;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, maxLines);
}

function bossPassiveText(mobRow, separator) {
  const skillName = mobRow.skill_name && mobRow.skill_name !== '—'
    ? String(mobRow.skill_name).trim()
    : '';
  const description = String(mobRow.skill_description || 'Basic attacks only.').trim();
  if (!skillName) return `Passive: ${description}`;
  const prefix = `${skillName}:`;
  const displayDescription = description.toLowerCase().startsWith(prefix.toLowerCase())
    ? description.slice(prefix.length).trim()
    : description;
  return `Passive: ${skillName} ${separator} ${displayDescription}`;
}

function bossStatusCardHeight(passiveLineCount) {
  const requestedLineCount = Math.floor(Number(passiveLineCount) || 1);
  const lineCount = Math.max(
    1,
    Math.min(STATUS_PASSIVE_MAX_LINES, requestedLineCount),
  );
  return STATUS_CARD_MIN_HEIGHT + (lineCount - 1) * STATUS_PASSIVE_LINE_HEIGHT;
}

function renderBossStatusCard(state, mobRow) {
  const cur = Number(state.current_hp);
  const max = Number(state.max_hp);
  const p = max > 0 ? Math.max(0, Math.min(1, cur / max)) : 0;

  const W = BANNER_W, PAD = 22;
  const L = PAD + 26, R = W - PAD - 26;
  const passive = bossPassiveText(mobRow, '—');
  const passiveFont = `21px ${FONT}`;
  const measureCtx = createCanvas(1, 1).getContext('2d');
  measureCtx.font = passiveFont;
  const passiveLines = wrapToWidth(measureCtx, passive, R - L, STATUS_PASSIVE_MAX_LINES);
  const passiveLineCount = Math.max(1, passiveLines.length);
  const H = bossStatusCardHeight(passiveLineCount);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = CARD_COLORS.bg;
  ctx.fillRect(0, 0, W, H);
  roundRectPath(ctx, PAD, PAD, W - PAD * 2, H - PAD * 2, 16);
  ctx.fillStyle = CARD_COLORS.card; ctx.fill();
  ctx.strokeStyle = CARD_COLORS.cardLine; ctx.lineWidth = 2.5; ctx.stroke();

  ctx.textAlign = 'left';

  // row 1 — "✦ Name · Boss" left, "cur / max" HP right (same as raid card)
  let y = PAD + 40;
  ctx.font = `bold 28px ${FONT}`;
  ctx.fillStyle = CARD_COLORS.enemy;
  const nameText = `✦ ${mobRow.name}`;
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
  ctx.font = passiveFont;
  ctx.fillStyle = CARD_COLORS.dim;
  for (let i = 0; i < passiveLines.length; i += 1) {
    if (passiveLines[i]) ctx.fillText(passiveLines[i], L, y + i * STATUS_PASSIVE_LINE_HEIGHT);
  }

  // HP bar — fills left→right, color by remaining percentage
  y += STATUS_PASSIVE_LINE_HEIGHT * (passiveLineCount - 1) + 18;
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
    ['CRIT', `${bossCrit(mobRow).toFixed(1)}%`],
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

  return encodeOpaqueCanvas(canvas, { system: 'boss', command: 'boss', imageType: 'boss_status' });
}

function bossStatusText(state, mobRow) {
  const cur = Number(state.current_hp);
  const max = Number(state.max_hp);
  const pct = max > 0 ? Math.max(0, Math.min(100, (cur / max) * 100)) : 0;
  const passive = bossPassiveText(mobRow, '-');
  return [
    `**HP:** ${cur.toLocaleString()} / ${max.toLocaleString()} (${pct.toFixed(1)}%)`,
    `**ATK:** ${Number(state.scaled_atk).toLocaleString()}  **DEF:** ${Number(state.scaled_def).toLocaleString()}  **CRIT:** ${bossCrit(mobRow).toFixed(1)}%`,
    `-# ${passive}`,
  ].join('\n');
}

function renderBossStatusCardWithLog(state, mobRow, logContext) {
  const started = Date.now();
  const buffer = renderBossStatusCard(state, mobRow);
  performanceLog('boss render duration', {
    ...logContext,
    durationMs: Date.now() - started,
    bytes: buffer.length,
  });
  return buffer;
}

function bossStatusCacheParts(state, mobRow) {
  return {
    spawnId: state.spawn_id,
    status: state.status,
    mobId: state.mob_id,
    currentHp: Number(state.current_hp),
    maxHp: Number(state.max_hp),
    scaledAtk: Number(state.scaled_atk),
    scaledDef: Number(state.scaled_def),
    name: mobRow.name,
    crit: bossCrit(mobRow),
    skillName: mobRow.skill_name || '',
    skillDescription: mobRow.skill_description || '',
  };
}

async function bossStatusImage(state, mobRow, {
  phase = 'snapshot', telemetryCommand = 'boss',
} = {}) {
  const logContext = {
    system: 'boss',
    command: telemetryCommand,
    imageType: 'boss_status',
    guildId: state.guild_id,
    spawnId: state.spawn_id,
    phase,
  };
  const imageOptions = {
    maxWidth: bossImageMaxWidth(),
    logContext,
  };
  const cached = await getCachedCanvasUrl(
    ['boss-status-card', BOSS_STATUS_RENDER_REV, bossStatusCacheParts(state, mobRow)],
    () => renderBossStatusCardWithLog(state, mobRow, logContext),
    imageOptions,
    { returnImageOnFailure: true, logContext }
  );
  if (cached?.url) {
    lastBossStatusUrls.set(state.guild_id, {
      spawnId: state.spawn_id,
      status: state.status,
      currentHp: Number(state.current_hp),
      maxHp: Number(state.max_hp),
      url: cached.url,
    });
    return { url: cached.url, file: null };
  }
  const last = lastBossStatusUrls.get(state.guild_id);
  const lastMatchesState = last?.spawnId === state.spawn_id
    && last.status === state.status
    && last.currentHp === Number(state.current_hp)
    && last.maxHp === Number(state.max_hp);
  if (cached?.image) {
    console.warn(`[boss] boss image r2 upload failed (guild=${state.guild_id}, spawn=${state.spawn_id}, cache=${cached.cache || 'unknown'}).`);
    if (last?.url && lastMatchesState) {
      performanceLog('reused last boss image URL', {
        ...logContext,
        cacheStatus: cached.cache || 'image-fallback',
        reason: 'r2-upload-failed',
      });
      return { url: last.url, file: null, reusedLastUrl: true };
    }
    if (discordImageAttachmentsAllowed()) {
      return attachmentFromOptimizedImage(cached.image, 'boss_status', { ...logContext, reusedBuffer: true });
    }
    performanceLog('boss image skipped, text-only fallback used', {
      ...logContext,
      cacheStatus: cached.cache || 'image-fallback',
      reason: 'attachments-blocked',
    });
    return null;
  }
  if (last?.url && lastMatchesState) {
    performanceLog('reused last boss image URL', {
      ...logContext,
      cacheStatus: 'missing',
      reason: 'cache-unavailable',
    });
    return { url: last.url, file: null, reusedLastUrl: true };
  }
  if (discordImageAttachmentsAllowed()) {
    return makeOptimizedAttachment(
      renderBossStatusCardWithLog(state, mobRow, logContext),
      'boss_status',
      imageOptions
    );
  }
  performanceLog('boss image skipped, text-only fallback used', {
    ...logContext,
    cacheStatus: 'missing',
    reason: 'no-public-url',
  });
  return null;
}


/** Live read of the reassignable render-side counters (see header note). */
function renderMemoryStats() {
  return {
    statusUrlEntries: lastBossStatusUrls.size,
    bannerEntries: bannerCache.size,
    bannerBytes: bannerCacheBytes,
    bannerMaxEntries: BANNER_CACHE_MAX_ENTRIES,
    bannerMaxBytes: BANNER_CACHE_MAX_BYTES,
    bannerTtlMs: BANNER_CACHE_TTL_MS,
    loreEntries: loreMap?.size || 0,
    assetFileEntries: bossAssetLookup.files.length,
    assetLookupEntries: bossAssetLookup.resolved.size,
  };
}

/** Purge helpers for the runtime purge paths — the map is owned here. */
function dropStatusUrlsForSpawn(spawnId) {
  for (const [guildId, record] of lastBossStatusUrls.entries()) {
    if (record.spawnId === spawnId) lastBossStatusUrls.delete(guildId);
  }
}

function dropStatusUrlsForGuild(guildId) {
  lastBossStatusUrls.delete(guildId);
}

module.exports = {
  bossSlug,
  bossImagePath,
  bossImagePathForMessage,
  bossBanner,
  bossLore,
  bossPassiveText,
  bossStatusCardHeight,
  bossStatusText,
  bossStatusImage,
  bossStatusCacheParts,
  renderBossStatusCard,
  trimBossBanners,
  dropBossBannersForPath,
  bossImageMaxWidth,
  bossCrit,
  renderMemoryStats,
  dropStatusUrlsForSpawn,
  dropStatusUrlsForGuild,
};
