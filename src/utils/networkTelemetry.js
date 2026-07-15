'use strict';

const { AsyncLocalStorage } = require('async_hooks');
const crypto = require('crypto');
const { registerMemorySource } = require('./memoryRegistry');
const { envBool } = require('./runtimeLogs');

const MAX_KEYS = 64;
const MAX_FINGERPRINTS = 256;
const IDENTIFIER_HASH_BYTES = 8;
const identifierSalt = crypto.randomBytes(32);
const commandContext = new AsyncLocalStorage();
const streams = {
  assetCache: new Map(),
  assetCacheByCommand: new Map(),
  assetDownloads: new Map(),
  assetDownloadsByCommand: new Map(),
  assetHeads: new Map(),
  assetHeadsByCommand: new Map(),
  canvasCache: new Map(),
  r2Reads: new Map(),
  r2ReadsByCommand: new Map(),
  r2Uploads: new Map(),
  r2Deletes: new Map(),
  discordRest: new Map(),
  discordAttachmentsByCommand: new Map(),
  discordAttachmentsByCommandPhase: new Map(),
  discordAttachmentsByFilenameCategory: new Map(),
};
const activities = new Map();
// Weak keys preserve command attribution without extending attachment-buffer lifetime.
const discordAttachmentContexts = new WeakMap();
// Hashes only: bounded duplicate detection never retains attachment buffers or identifiers.
const recentAttachmentFingerprints = new Map();
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

function identifierHash(value, purpose) {
  if (value == null || String(value).trim() === '') return '';
  return crypto.createHmac('sha256', identifierSalt)
    .update(`${purpose}:${String(value)}`)
    .digest('hex')
    .slice(0, IDENTIFIER_HASH_BYTES * 2);
}

function normalizedIdentifierHash(value, purpose) {
  if (value == null || value === '') return '';
  const candidate = String(value).toLowerCase();
  return /^[a-f0-9]{16}$/.test(candidate) ? candidate : identifierHash(candidate, purpose);
}

function normalizePhase(value, fallback = 'final') {
  const phase = safeKey(value || fallback);
  if (['start', 'initial', 'opening', 'spawn'].includes(phase)) return 'initial';
  if (['update', 'intermediate', 'turn', 'progress'].includes(phase)) return 'intermediate';
  if (['result', 'final', 'complete', 'completed', 'retry', 'snapshot'].includes(phase)) return 'final';
  if (['background', 'scheduled', 'scheduler', 'refresh'].includes(phase)) return 'background';
  return phase || fallback;
}

function safeSurface(value, fallback = 'background') {
  const surface = safeKey(value || fallback);
  if (['prefix', 'slash', 'component', 'background', 'system'].includes(surface)) return surface;
  return surface || fallback;
}

function buildSafeContext(context = {}, current = {}) {
  const command = safeKey(context.command || context.system || current.command || 'background');
  const surface = safeSurface(
    context.surface || current.surface,
    command === 'background' ? 'background' : 'system'
  );
  const defaultPhase = ['background', 'system'].includes(surface) ? 'background' : 'final';
  const rawUserId = context.userId ?? context.discordId;
  const rawRequestId = context.requestId ?? context.interactionId ?? context.messageId;
  return {
    command,
    imageType: safeKey(context.imageType || current.imageType || '', ''),
    surface,
    phase: normalizePhase(context.phase || current.phase, defaultPhase),
    userHash: normalizedIdentifierHash(context.userHash, 'user')
      || (rawUserId != null ? identifierHash(rawUserId, 'user') : current.userHash)
      || '',
    correlationId: normalizedIdentifierHash(context.correlationId, 'request')
      || (rawRequestId != null ? identifierHash(rawRequestId, 'request') : current.correlationId)
      || '',
  };
}

/** Return only telemetry-safe fields; request-local raw IDs are hashed immediately. */
function getNetworkContext(overrides = {}) {
  const current = commandContext.getStore() || {};
  return buildSafeContext({
    ...overrides,
    // The request entry-point is authoritative for command and identity. Renderers
    // may still override imageType and phase for individual frames.
    command: current.command || overrides.command || overrides.system,
    surface: current.surface || overrides.surface,
    phase: overrides.phase || current.phase,
    userHash: current.userHash || overrides.userHash,
    correlationId: current.correlationId || overrides.correlationId,
    userId: current.userHash ? undefined : (overrides.userId ?? overrides.discordId),
    requestId: current.correlationId
      ? undefined
      : (overrides.requestId ?? overrides.interactionId ?? overrides.messageId),
  });
}

function activeCommandKey() {
  return contextKey(commandContext.getStore() || {}, 'background');
}

function withNetworkContext(context, fn) {
  const current = commandContext.getStore() || {};
  return commandContext.run(buildSafeContext(context, current), fn);
}

function recordAssetDownload(category, bytes, ok = true) {
  const values = {
    requests: 1,
    successes: ok ? 1 : 0,
    failures: ok ? 0 : 1,
    bytes: ok ? bytes : 0,
  };
  add(streams.assetDownloads, category, values);
  add(streams.assetDownloadsByCommand, activeCommandKey(), values);
}

function recordAssetCache(category, cacheType, outcome) {
  const type = safeKey(cacheType, 'buffer');
  const state = outcome === true ? 'hit' : outcome === false ? 'miss' : safeKey(outcome, 'miss');
  const suffix = {
    hit: 'Hits',
    miss: 'Misses',
    coalesced: 'Coalesced',
  }[state] || 'Other';
  const values = {
    [`${type}${suffix}`]: 1,
  };
  add(streams.assetCache, category, values);
  add(streams.assetCacheByCommand, activeCommandKey(), values);
}

function recordAssetHead(category, ok) {
  const values = {
    requests: 1,
    available: ok ? 1 : 0,
    unavailable: ok ? 0 : 1,
  };
  add(streams.assetHeads, category, values);
  add(streams.assetHeadsByCommand, activeCommandKey(), values);
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

function recordR2Read(operation, bytes, ok = true) {
  const values = {
    requests: 1,
    successes: ok ? 1 : 0,
    failures: ok ? 0 : 1,
    bytes: ok ? bytes : 0,
  };
  add(streams.r2Reads, safeKey(operation, 'get'), values);
  add(streams.r2ReadsByCommand, activeCommandKey(), values);
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

function sanitizeFilename(name) {
  const basename = String(name || 'attachment')
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\d{15,22}/g, '{id}')
    .trim();
  return (basename || 'attachment').slice(0, 128);
}

function sanitizeRoute(request = {}) {
  return String(request.route || request.path || 'other')
    .replace(/[?#].*$/, '')
    .replace(/(\/(?:webhooks|interactions)\/(?:\d{15,22}|:id)\/)[^/]+/gi, '$1:token')
    .replace(/\d{15,22}/g, ':id')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .slice(0, 160) || 'other';
}

function attachmentFingerprint(data) {
  if (!Buffer.isBuffer(data) && !(data instanceof Uint8Array)) return '';
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 24);
}

function noteAttachmentFingerprint(fingerprint) {
  if (!fingerprint) return { duplicate: false, seenCount: 0 };
  const previousSeen = recentAttachmentFingerprints.get(fingerprint) || 0;
  recentAttachmentFingerprints.delete(fingerprint);
  recentAttachmentFingerprints.set(fingerprint, previousSeen + 1);
  while (recentAttachmentFingerprints.size > MAX_FINGERPRINTS) {
    recentAttachmentFingerprints.delete(recentAttachmentFingerprints.keys().next().value);
  }
  return { duplicate: previousSeen > 0, seenCount: previousSeen + 1 };
}

function logDiscordUpload(event) {
  // All fields are pre-sanitized/hashes. Keep one JSON object per actual REST response
  // so Railway logs can be aggregated without retaining high-cardinality state here.
  if (!envBool('RESOURCE_LOGS', true)) return;
  try {
    console.log(`[discord-upload] ${JSON.stringify(event)}`);
  } catch {
    // Logging must never affect Discord request handling.
  }
}

function tagDiscordAttachmentBuffer(buffer, context = {}) {
  if (!buffer || (typeof buffer !== 'object' && typeof buffer !== 'function')) return buffer;
  discordAttachmentContexts.set(buffer, {
    ...getNetworkContext(context),
    fingerprint: attachmentFingerprint(buffer),
  });
  return buffer;
}

function recordDiscordRestResponse(request = {}, response = {}) {
  const ok = response.ok === true;
  const status = Number(response.status) || 0;
  const responseBytes = Number(response.headers?.get?.('content-length')) || 0;
  const requestBytes = requestBodyBytes(request.data?.body);
  const routeCategory = discordRoute(request);
  add(streams.discordRest, routeCategory, {
    responses: 1,
    successes: ok ? 1 : 0,
    failures: ok ? 0 : 1,
    requestBytes,
    responseBytes,
  });
  const requestFiles = Array.isArray(request.data?.files) ? request.data.files : [];
  const files = requestFiles.filter((file) => byteLength(file?.data) > 0);
  for (const [index, file] of files.entries()) {
    const bytes = byteLength(file?.data);
    const filenameCategory = discordAttachmentCategory(file?.name);
    const tagged = file?.data && typeof file.data === 'object'
      ? discordAttachmentContexts.get(file.data)
      : null;
    const active = commandContext.getStore() ? getNetworkContext() : null;
    const command = safeKey(
      tagged?.command && !['background', 'other'].includes(tagged.command)
        ? tagged.command
        : active?.command || filenameCategory
    );
    const phase = normalizePhase(tagged?.phase || active?.phase, active ? 'final' : 'background');
    const fingerprint = tagged?.fingerprint || attachmentFingerprint(file?.data);
    const duplicate = noteAttachmentFingerprint(fingerprint);
    const values = {
      attempts: 1,
      successes: ok ? 1 : 0,
      failures: ok ? 0 : 1,
      attemptedBytes: bytes,
      confirmedBytes: ok ? bytes : 0,
      duplicateAttempts: duplicate.duplicate ? 1 : 0,
    };
    add(streams.discordAttachmentsByCommand, command, values);
    add(streams.discordAttachmentsByCommandPhase, `${command}.${phase}`, values);
    add(streams.discordAttachmentsByFilenameCategory, filenameCategory, values);
    logDiscordUpload({
      command,
      imageType: tagged?.imageType || filenameCategory,
      filename: sanitizeFilename(file?.name),
      bytes,
      uploadIndex: index + 1,
      uploadCount: files.length,
      userHash: tagged?.userHash || active?.userHash || undefined,
      correlationId: tagged?.correlationId || active?.correlationId || undefined,
      surface: tagged?.surface || active?.surface || 'background',
      phase,
      route: sanitizeRoute(request),
      routeCategory,
      method: safeKey(request.method || 'unknown').toUpperCase(),
      retry: Math.max(0, Number(request.retries) || 0),
      status,
      ok,
      fingerprint: fingerprint || undefined,
      duplicateBuffer: duplicate.duplicate,
      fingerprintSeen: duplicate.seenCount,
    });
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
  const streamEntries = Object.values(streams).reduce((sum, map) => sum + map.size, 0);
  const entries = streamEntries + activities.size + recentAttachmentFingerprints.size;
  return {
    streams: streamEntries,
    activityTypes: activities.size,
    attachmentFingerprints: recentAttachmentFingerprints.size,
    maxAttachmentFingerprints: MAX_FINGERPRINTS,
    estimatedBytes: entries * 256 * (previous ? 2 : 1),
    maxKeysPerStream: MAX_KEYS,
  };
}

registerMemorySource('telemetry.network-counters', getNetworkTelemetryStats);

module.exports = {
  withNetworkContext,
  getNetworkContext,
  normalizePhase,
  recordAssetCache,
  recordAssetDownload,
  recordAssetHead,
  recordR2Read,
  recordR2Upload,
  recordCanvasCache,
  recordR2Delete,
  tagDiscordAttachmentBuffer,
  recordDiscordRestResponse,
  beginActivity,
  takeNetworkTelemetrySnapshot,
  getNetworkTelemetryStats,
};
