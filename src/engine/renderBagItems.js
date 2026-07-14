'use strict';

/**
 * renderBagItems.js — canvas-rendered boxed item rows (OwO-checklist style)
 * for `crd bag chests`: one rounded dark box per item with the item's emoji
 * icon, bold name, the open command in smaller muted text, and the count
 * right-aligned.
 *
 * Emoji icons are downloaded ONCE from the Discord CDN
 * (https://cdn.discordapp.com/emojis/<id>.png?size=64 — ids from
 * game_items.txt via the emojis util) and cached beside the shared asset disk
 * cache, then memoized in-process. Renders never
 * fetch in steady state; the row image itself is re-rendered per invocation
 * (cheap).
 */

const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const { encodeCanvas } = require('../utils/canvasEncode');
const path = require('path');
const crypto = require('crypto');
const { emoji } = require('../utils/emojis');
const {
  assetDiskCacheEnabled, assetSource, loadAssetImage: loadAssetImageSource,
  readAssetDiskCacheFile, writeAssetDiskCacheFile, removeAssetDiskCacheFile,
  touchAssetDiskCacheFile,
} = require('../utils/assets');
const { envNumber, envPositiveInt } = require('../utils/runtimeLogs');
const { registerMemorySource } = require('../utils/memoryRegistry');
const {
  recordAssetCache, recordAssetDownload,
} = require('../utils/networkTelemetry');

const ROOT = path.join(__dirname, '..', '..');

// Bundled font — the host may have no system fonts at all. Regular + Bold
// registered under one family so 'bold …' resolves correctly.
const FONT_FAMILY = 'DejaVu Sans';
for (const file of ['DejaVuSans.ttf', 'DejaVuSans-Bold.ttf']) {
  try {
    GlobalFonts.registerFromPath(path.join(ROOT, 'assets', 'fonts', file), FONT_FAMILY);
  } catch (err) {
    console.error(`[renderBagItems] font ${file} failed to register:`, err.message);
  }
}

// Layout
const W = 460;
const ROW_H = 48;
const GAP = 8;          // gap between boxes
const PAD = 10;         // canvas padding
const RADIUS = 10;      // box corner radius
const ICON = 28;        // icon edge length

// Colors (near Discord dark)
const BG = '#1E1F22';
const BOX = '#26272D';
const NAME_COLOR = '#FFFFFF';
const CMD_COLOR = '#8E919A';

// Typography (bundled DejaVu Sans)
const NAME_FONT = `bold 15px "${FONT_FAMILY}"`;
const COUNT_FONT = `15px "${FONT_FAMILY}"`;
const CMD_FONT = `11px "${FONT_FAMILY}"`;

// emojiName → loaded Image (successes only, so transient failures retry later)
const ICON_CACHE_MAX_ENTRIES = envPositiveInt('EMOJI_IMAGE_CACHE_MAX', 256, { max: 2000 });
const ICON_CACHE_MAX_BYTES = Math.max(1024 * 1024, envNumber('EMOJI_IMAGE_CACHE_MAX_MB', 4, { min: 1, max: 128 }) * 1024 * 1024);
const ICON_CACHE_TTL_MS = Math.max(0, envNumber('EMOJI_IMAGE_CACHE_TTL_MS', 1_800_000, { min: 0, max: 86_400_000 }));
const ICON_REMOTE_MISS_TTL_MS = Math.max(0, envNumber('EMOJI_REMOTE_MISS_TTL_MS', 600_000, { min: 0, max: 86_400_000 }));
const ICON_REMOTE_MISS_MAX = envPositiveInt('EMOJI_REMOTE_MISS_MAX', 256, { max: 2000 });
const iconCache = new Map(); // key -> { image, bytes, lastUsed }
const iconInflight = new Map(); // key -> Promise<Image|null>
const iconRemoteMisses = new Map(); // URL -> expiresAt
let iconCacheBytes = 0;
const iconStats = {
  hits: 0,
  misses: 0,
  coalesced: 0,
  diskHits: 0,
  downloads: 0,
  downloadedBytes: 0,
  failures: 0,
  negativeHits: 0,
};

function cachedIcon(key, category) {
  const entry = iconCache.get(key);
  if (!entry) return null;
  if (ICON_CACHE_TTL_MS && Date.now() - entry.lastUsed > ICON_CACHE_TTL_MS) {
    iconCache.delete(key);
    iconCacheBytes = Math.max(0, iconCacheBytes - entry.bytes);
    return null;
  }
  iconStats.hits += 1;
  recordAssetCache(category, 'image', 'hit');
  const now = Date.now();
  entry.lastUsed = now;
  if (entry.diskName && now - (entry.diskTouchedAt || 0) >= 300_000) {
    entry.diskTouchedAt = now;
    void touchAssetDiskCacheFile(entry.diskName);
  }
  iconCache.delete(key);
  iconCache.set(key, entry);
  return entry.image;
}

function rememberIcon(key, image, diskName = null) {
  const bytes = Math.max(1, (image?.width || 0) * (image?.height || 0) * 4);
  const old = iconCache.get(key);
  if (old) iconCacheBytes -= old.bytes;
  iconCache.delete(key);
  const now = Date.now();
  iconCache.set(key, { image, bytes, lastUsed: now, diskTouchedAt: now, diskName });
  iconCacheBytes += bytes;
  while (iconCache.size > ICON_CACHE_MAX_ENTRIES || iconCacheBytes > ICON_CACHE_MAX_BYTES) {
    const first = iconCache.entries().next().value;
    if (!first) break;
    iconCache.delete(first[0]);
    iconCacheBytes = Math.max(0, iconCacheBytes - first[1].bytes);
  }
  return image;
}

// '<:silver_chest:1514006354027741184>' → '1514006354027741184'
function emojiIdOf(name) {
  const m = emoji(name).match(/:(\d+)>$/);
  return m ? m[1] : null;
}

function iconCacheFileName(key, url) {
  const safe = String(key || 'icon').replace(/[^a-z0-9_-]+/gi, '_').slice(0, 64) || 'icon';
  const digest = crypto.createHash('sha256').update(String(url || key || 'icon')).digest('hex').slice(0, 16);
  return `emoji-${safe}-${digest}.png`;
}

async function loadDiskCachedIcon(key, category, url) {
  const cacheKey = String(url || `missing:${key}`);
  const cached = cachedIcon(cacheKey, category);
  if (cached) return cached;
  const negativeUntil = iconRemoteMisses.get(cacheKey) || 0;
  if (negativeUntil > Date.now()) {
    iconStats.negativeHits += 1;
    recordAssetCache(category, 'negative', 'hit');
    return null;
  }
  if (negativeUntil) iconRemoteMisses.delete(cacheKey);
  const pending = iconInflight.get(cacheKey);
  if (pending) {
    iconStats.coalesced += 1;
    recordAssetCache(category, 'image', 'coalesced');
    return pending;
  }
  iconStats.misses += 1;
  recordAssetCache(category, 'image', 'miss');
  const job = (async () => {
    let fetchAttempted = false;
    let downloadRecorded = false;
    const download = async () => {
      fetchAttempted = true;
      const res = await fetch(url);
      if (!res.ok) {
        if (ICON_REMOTE_MISS_TTL_MS && [404, 410].includes(Number(res.status))) {
          iconRemoteMisses.delete(cacheKey);
          iconRemoteMisses.set(cacheKey, Date.now() + ICON_REMOTE_MISS_TTL_MS);
          while (iconRemoteMisses.size > ICON_REMOTE_MISS_MAX) {
            iconRemoteMisses.delete(iconRemoteMisses.keys().next().value);
          }
        }
        recordAssetDownload(category, 0, false);
        downloadRecorded = true;
        return null;
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      iconRemoteMisses.delete(cacheKey);
      iconStats.downloads += 1;
      iconStats.downloadedBytes += buffer.length;
      recordAssetDownload(category, buffer.length, true);
      downloadRecorded = true;
      return buffer;
    };
    try {
      if (!url) return null;
      const diskName = iconCacheFileName(key, url);
      let file = null;
      let buffer = null;
      if (assetDiskCacheEnabled()) {
        file = await readAssetDiskCacheFile(diskName);
      }
      if (!file) {
        if (assetDiskCacheEnabled()) recordAssetCache(category, 'disk', 'miss');
        buffer = await download();
        if (!buffer) {
          iconStats.failures += 1;
          return null;
        }
        file = await writeAssetDiskCacheFile(diskName, buffer);
      } else {
        iconStats.diskHits += 1;
        recordAssetCache(category, 'disk', 'hit');
      }
      let img;
      try {
        img = await loadImage(file || buffer);
      } catch (err) {
        if (!file) throw err;
        if (buffer) {
          await removeAssetDiskCacheFile(diskName);
          throw err;
        }
        await removeAssetDiskCacheFile(diskName);
        recordAssetCache(category, 'disk', 'miss');
        buffer = await download();
        if (!buffer) {
          iconStats.failures += 1;
          return null;
        }
        file = await writeAssetDiskCacheFile(diskName, buffer);
        img = await loadImage(file || buffer);
      }
      return rememberIcon(cacheKey, img, file ? diskName : null);
    } catch (err) {
      iconStats.failures += 1;
      if (fetchAttempted && !downloadRecorded) recordAssetDownload(category, 0, false);
      console.error(`[renderBagItems] icon '${key}' unavailable:`, err.message);
      return null;
    }
  })();
  iconInflight.set(cacheKey, job);
  try {
    return await job;
  } finally {
    if (iconInflight.get(cacheKey) === job) iconInflight.delete(cacheKey);
  }
}

/** Disk-cached CDN icon. Returns a canvas Image or null (row renders without icon). */
async function getEmojiIcon(name) {
  const id = emojiIdOf(name);
  return loadDiskCachedIcon(
    id ? `${name}-${id}` : name,
    'discord_emoji',
    id ? `https://cdn.discordapp.com/emojis/${id}.png?size=64` : null
  );
}

/** Disk-cached Twemoji (Discord's default-emoji art) by hex codepoint. Returns
 *  a canvas Image or null. Used for items with no custom emoji (weapons/armors). */
async function getUnicodeIcon(hex) {
  const key = `u${hex}`;
  return loadDiskCachedIcon(
    key,
    'twemoji',
    `https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/72x72/${hex}.png`
  );
}

async function loadAssetImage(source) {
  return loadAssetImageSource(loadImage, source);
}

async function getLocalIcon(filePath) {
  const resolved = assetSource(filePath);
  try {
    return await loadAssetImage(resolved);
  } catch {
    return null;
  }
}

function getEmojiImageCacheStats() {
  if (ICON_CACHE_TTL_MS) {
    const now = Date.now();
    for (const [key, entry] of iconCache) {
      if (now - entry.lastUsed <= ICON_CACHE_TTL_MS) continue;
      iconCache.delete(key);
      iconCacheBytes = Math.max(0, iconCacheBytes - entry.bytes);
    }
  }
  return {
    ...iconStats,
    entries: iconCache.size,
    inflight: iconInflight.size,
    negativeEntries: iconRemoteMisses.size,
    negativeMaxEntries: ICON_REMOTE_MISS_MAX,
    negativeTtlMs: ICON_REMOTE_MISS_TTL_MS,
    bytes: iconCacheBytes,
    maxEntries: ICON_CACHE_MAX_ENTRIES,
    maxBytes: ICON_CACHE_MAX_BYTES,
    ttlMs: ICON_CACHE_TTL_MS,
  };
}

registerMemorySource('images.discord-emojis', getEmojiImageCacheStats);

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
  ctx.lineTo(x + w, y + h - r);
  ctx.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
  ctx.lineTo(x + r, y + h);
  ctx.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
  ctx.lineTo(x, y + r);
  ctx.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
  ctx.closePath();
}

/**
 * @param {Array<{emojiName: string, name: string, count: number, cmd: string}>} items
 * @returns {Promise<Buffer>} PNG
 */
async function renderBagItemsImage(items) {
  const H = PAD * 2 + items.length * ROW_H + (items.length - 1) * GAP;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const y = PAD + i * (ROW_H + GAP);

    roundRectPath(ctx, PAD, y, W - PAD * 2, ROW_H, RADIUS);
    ctx.fillStyle = BOX;
    ctx.fill();

    const midY = y + ROW_H / 2;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    // Optional leading id label (essence shop: `1` `2` …) before the icon.
    let leftX = PAD + 12;
    if (item.idLabel != null) {
      ctx.font = NAME_FONT;
      ctx.fillStyle = CMD_COLOR;
      ctx.fillText(String(item.idLabel), leftX, midY);
      leftX += ctx.measureText(String(item.idLabel)).width + 12;
    }

    // Icon: a local iconPath (assets/items/...) wins over the CDN emoji; a unicode
    // `glyph` (e.g. ⚔️ / 🛡️) is the last-resort fallback drawn as text.
    let icon = null;
    if (item.iconPath) icon = await getLocalIcon(item.iconPath);
    if (!icon && item.emojiName) icon = await getEmojiIcon(item.emojiName);
    if (!icon && item.twemoji) icon = await getUnicodeIcon(item.twemoji);
    if (icon) {
      ctx.drawImage(icon, leftX, midY - ICON / 2, ICON, ICON);
    } else if (item.glyph) {
      ctx.font = `${ICON - 4}px "${FONT_FAMILY}"`;
      ctx.fillStyle = NAME_COLOR;
      ctx.fillText(item.glyph, leftX, midY);
    }

    // Bold name, then the open command in smaller muted text.
    const nameX = leftX + ICON + 10;
    ctx.font = NAME_FONT;
    ctx.fillStyle = NAME_COLOR;
    ctx.fillText(item.name, nameX, midY);
    const nameW = ctx.measureText(item.name).width;
    let cmdEnd = nameX + nameW;
    if (item.cmd) {
      ctx.font = CMD_FONT;
      ctx.fillStyle = CMD_COLOR;
      ctx.fillText(item.cmd, nameX + nameW + 12, midY);
      cmdEnd = nameX + nameW + 12 + ctx.measureText(item.cmd).width;
    }

    // Right side, in priority: rightSegments (text + inline emoji icons, FIXED
    // font) → `right` string (auto-shrunk) → numeric count.
    ctx.fillStyle = NAME_COLOR;
    if (Array.isArray(item.rightSegments)) {
      const SEG_FONT = `15px "${FONT_FAMILY}"`;
      const SEG_ICON = 20;
      ctx.font = SEG_FONT;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      // Resolve icons + measure total width.
      let total = 0;
      const parts = [];
      for (const seg of item.rightSegments) {
        if (seg.text != null) {
          parts.push({ text: seg.text, w: ctx.measureText(seg.text).width });
          total += parts[parts.length - 1].w;
        } else {
          let im = null;
          if (seg.iconPath) im = await getLocalIcon(seg.iconPath);
          if (!im && seg.emojiName) im = await getEmojiIcon(seg.emojiName);
          if (!im && seg.twemoji) im = await getUnicodeIcon(seg.twemoji);
          parts.push({ img: im, w: im ? SEG_ICON + 2 : 0 });
          total += parts[parts.length - 1].w;
        }
      }
      let sx = W - PAD - 14 - total;
      for (const p of parts) {
        if (p.img) { ctx.drawImage(p.img, sx, midY - SEG_ICON / 2, SEG_ICON, SEG_ICON); sx += p.w; }
        else if (p.text != null) { ctx.fillText(p.text, sx, midY); sx += p.w; }
      }
      ctx.textAlign = 'left';
    } else if (item.right != null) {
      ctx.textAlign = 'right';
      const avail = (W - PAD - 14) - (cmdEnd + 14);
      let px = 15;
      ctx.font = `${px}px "${FONT_FAMILY}"`;
      while (px > 9 && ctx.measureText(String(item.right)).width > avail) {
        px -= 1; ctx.font = `${px}px "${FONT_FAMILY}"`;
      }
      ctx.fillText(String(item.right), W - PAD - 14, midY);
    } else {
      ctx.textAlign = 'right';
      ctx.font = COUNT_FONT;
      ctx.fillText(String(item.count), W - PAD - 14, midY);
    }
    ctx.textAlign = 'left';
  }

  ctx.textBaseline = 'alphabetic';
  return encodeCanvas(canvas);
}

// getEmojiIcon shared with renderSummon (badge essence icons use the same cache).
module.exports = { renderBagItemsImage, getEmojiIcon, FONT_FAMILY, getEmojiImageCacheStats };
