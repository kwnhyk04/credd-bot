'use strict';

const { registerMemorySource } = require('./memoryRegistry');

const MAX_KEYS = 64;
const streams = {
  assetCache: new Map(),
  assetDownloads: new Map(),
  assetHeads: new Map(),
  canvasCache: new Map(),
  r2Uploads: new Map(),
  r2Deletes: new Map(),
  discordRest: new Map(),
  discordAttachmentsByCommand: new Map(),
  discordAttachmentsByFilenameCategory: new Map(),
};
const activities = new Map();
// Weak keys preserve command attribution without extending attachment-buffer lifetime.
const discordAttachmentContexts = new WeakMap();
let previous = null;

function safeKey(value, fallback = 'other') {
  const key = String(value || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
  return key || fallback;
}

function boundedKey(map, value) {
  const key = safeKey(value);
  if (map.has(key)) return key;
  if (map.size >= MAX_KEYS) {
    return map.has('other') ? 'other' : map.keys().next().value;
  }
  if (map.has('other') || map.size < MAX_KEYS - 1) return key;
  return 'other';
}

function add(map, key, values = {}) {
  const name = boundedKey(map, key);
  const entry = map.get(name) || {};
  for (const [field, raw] of Object.entries(values)) {
    const value = Number(raw) || 0;
    entry[field] = (entry[field] || 0) + value;
  }
  map.set(name, entry);
}

function contextKey(context = {}, fallback = 'other') {
  const command = safeKey(context.command || context.system || fallback);
  const imageType = safeKey(context.imageType || '', '');
  return imageType && imageType !== command ? `${command}.${imageType}` : command;
}

function recordAssetDownload(category, bytes, ok = true) {
  add(streams.assetDownloads, category, {
    requests: 1,
    successes: ok ? 1 : 0,
    failures: ok ? 0 : 1,
    bytes: ok ? bytes : 0,
  });
}

function recordAssetCache(category, cacheType, outcome) {
  const type = safeKey(cacheType, 'buffer');
  const state = outcome === true ? 'hit' : outcome === false ? 'miss' : safeKey(outcome, 'miss');
  const suffix = {
    hit: 'Hits',
    miss: 'Misses',
    coalesced: 'Coalesced',
  }[state] || 'Other';
  add(streams.assetCache, category, {
    [`${type}${suffix}`]: 1,
  });
}

function recordAssetHead(category, ok) {
  add(streams.assetHeads, category, {
    requests: 1,
    available: ok ? 1 : 0,
    unavailable: ok ? 0 : 1,
  });
}

function recordR2Upload(context, bytes, ok) {
  add(streams.r2Uploads, contextKey(context, 'canvas'), {
    attempts: 1,
    successes: ok ? 1 : 0,
    failures: ok ? 0 : 1,
    attemptedBytes: bytes,
    confirmedBytes: ok ? bytes : 0,
  });
}

function recordCanvasCache(context, outcome) {
  const field = {
    memory: 'memoryHits',
    database: 'dbHits',
    coalesced: 'inflightHits',
    miss: 'misses',
    failure: 'failures',
  }[outcome] || 'other';
  add(streams.canvasCache, contextKey(context, 'canvas'), { [field]: 1 });
}

function recordR2Delete(context, ok) {
  add(streams.r2Deletes, contextKey(context, 'canvas_sweep'), {
    attempts: 1,
    successes: ok ? 1 : 0,
    failures: ok ? 0 : 1,
  });
}

function discordRoute(request = {}) {
  const route = String(request.route || request.path || '').toLowerCase();
  if (route.includes('/interactions/') || route.includes('/webhooks/')) return 'interactions';
  if (route.includes('/channels/') && route.includes('/messages')) return 'messages';
  if (route.includes('/applications/') && route.includes('/commands')) return 'commands';
  if (route.includes('/applications/') && route.includes('/emojis')) return 'application_emojis';
  if (route.includes('/guilds/') && route.includes('/emojis')) return 'guild_emojis';
  if (route.includes('/gateway')) return 'gateway';
  return 'other';
}

function byteLength(value) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return value.byteLength;
  if (typeof value === 'string') return Buffer.byteLength(value);
  return 0;
}

function requestBodyBytes(body) {
  const direct = byteLength(body);
  if (direct) return direct;
  if (!body || typeof body !== 'object') return 0;
  try {
    return Buffer.byteLength(JSON.stringify(body));
  } catch {
    return 0;
  }
}

function discordAttachmentCategory(name) {
  const value = safeKey(String(name || '').replace(/\.[^.]+$/, ''));
  if (value.startsWith('profile')) return 'profile';
  if (value.startsWith('stats')) return 'stats';
  if (value.startsWith('battle')) return 'battle';
  if (value.startsWith('rewards')) return 'raid';
  if (value.startsWith('boss')) return 'boss';
  if (value.startsWith('attendance')) return 'daily';
  if (value.startsWith('class_')) return 'create';
  if (value.startsWith('deities')) return 'deity';
  if (value.startsWith('quest')) return 'quests';
  if (/(summon|gacha|flip)/.test(value)) return 'summon';
  if (/(casino|slot|coin|dice|baccarat|blackjack|crash|card)/.test(value)) return 'casino';
  if (/(skin|equipment)/.test(value)) return 'equipment';
  return 'other';
}

function tagDiscordAttachmentBuffer(buffer, context = {}) {
  if (!buffer || (typeof buffer !== 'object' && typeof buffer !== 'function')) return buffer;
  discordAttachmentContexts.set(buffer, {
    command: safeKey(context.command || context.system || 'other'),
    imageType: safeKey(context.imageType || '', ''),
  });
  return buffer;
}

function recordDiscordRestResponse(request = {}, response = {}) {
  const ok = response.ok === true;
  const responseBytes = Number(response.headers?.get?.('content-length')) || 0;
  const requestBytes = requestBodyBytes(request.data?.body);
  add(streams.discordRest, discordRoute(request), {
    responses: 1,
    successes: ok ? 1 : 0,
    failures: ok ? 0 : 1,
    requestBytes,
    responseBytes,
  });
  for (const file of request.data?.files || []) {
    const bytes = byteLength(file?.data);
    if (!bytes) continue;
    const filenameCategory = discordAttachmentCategory(file?.name);
    const tagged = file?.data && typeof file.data === 'object'
      ? discordAttachmentContexts.get(file.data)
      : null;
    const values = {
      attempts: 1,
      successes: ok ? 1 : 0,
      failures: ok ? 0 : 1,
      attemptedBytes: bytes,
      confirmedBytes: ok ? bytes : 0,
    };
    add(streams.discordAttachmentsByCommand, tagged?.command || filenameCategory, values);
    add(streams.discordAttachmentsByFilenameCategory, filenameCategory, values);
  }
  try {
    const cancellation = response.body?.cancel?.();
    if (cancellation && typeof cancellation.catch === 'function') cancellation.catch(() => {});
  } catch {
    // The telemetry listener receives a response clone; ignore already-locked bodies.
  }
}

function beginActivity(name) {
  const key = boundedKey(activities, name);
  const entry = activities.get(key) || {
    active: 0, peak: 0, started: 0, completed: 0,
  };
  entry.active += 1;
  entry.peak = Math.max(entry.peak, entry.active);
  entry.started += 1;
  activities.set(key, entry);
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    entry.active = Math.max(0, entry.active - 1);
    entry.completed += 1;
  };
}

function mapSnapshot(map) {
  return Object.fromEntries(
    [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [key, { ...value }])
  );
}

function currentSnapshot() {
  return {
    ...Object.fromEntries(Object.entries(streams).map(([name, map]) => [name, mapSnapshot(map)])),
    activities: mapSnapshot(activities),
  };
}

function deltaRecord(current = {}, last = {}) {
  const out = {};
  for (const [field, value] of Object.entries(current)) {
    if (field === 'active' || field === 'peak') {
      out[field] = value;
    } else {
      out[field] = Math.max(0, (Number(value) || 0) - (Number(last[field]) || 0));
    }
  }
  return out;
}

function deltaSnapshot(current, last = {}) {
  const out = {};
  for (const [stream, records] of Object.entries(current)) {
    out[stream] = {};
    for (const [key, record] of Object.entries(records)) {
      out[stream][key] = deltaRecord(record, last[stream]?.[key]);
    }
  }
  return out;
}

function takeNetworkTelemetrySnapshot() {
  const total = currentSnapshot();
  const interval = deltaSnapshot(total, previous || {});
  previous = total;
  return { total, interval };
}

function getNetworkTelemetryStats() {
  const entries = Object.values(streams).reduce((sum, map) => sum + map.size, 0) + activities.size;
  return {
    streams: entries - activities.size,
    activityTypes: activities.size,
    estimatedBytes: entries * 256 * (previous ? 2 : 1),
    maxKeysPerStream: MAX_KEYS,
  };
}

registerMemorySource('telemetry.network-counters', getNetworkTelemetryStats);

module.exports = {
  recordAssetCache,
  recordAssetDownload,
  recordAssetHead,
  recordR2Upload,
  recordCanvasCache,
  recordR2Delete,
  tagDiscordAttachmentBuffer,
  recordDiscordRestResponse,
  beginActivity,
  takeNetworkTelemetrySnapshot,
  getNetworkTelemetryStats,
};
