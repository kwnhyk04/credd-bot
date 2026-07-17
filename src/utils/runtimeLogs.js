'use strict';

const { registerMemorySource } = require('./memoryRegistry');

const warnedEnv = new Set();
const WARNED_ENV_MAX = 100;

function envRaw(name) {
  const raw = process.env[name];
  return raw == null ? '' : String(raw).trim();
}

function warnInvalidEnv(name, raw, fallback, reason) {
  const key = `${name}:${raw}`;
  if (warnedEnv.has(key)) return;
  warnedEnv.add(key);
  while (warnedEnv.size > WARNED_ENV_MAX) warnedEnv.delete(warnedEnv.values().next().value);
  console.warn(`[env] ${name}=${raw || '<empty>'} ignored (${reason}); using ${fallback}.`);
}

function envTrue(name) {
  return envRaw(name).toLowerCase() === 'true';
}

function envBool(name, fallback = false) {
  const raw = envRaw(name);
  if (!raw) return fallback;
  const lower = raw.toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(lower)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(lower)) return false;
  warnInvalidEnv(name, raw, fallback, 'expected boolean');
  return fallback;
}

function envNumber(name, fallback, { min = -Infinity, max = Infinity } = {}) {
  const raw = envRaw(name);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    warnInvalidEnv(name, raw, fallback, 'expected number');
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

function envInt(name, fallback, { min = -Infinity, max = Infinity } = {}) {
  const raw = envRaw(name);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) {
    warnInvalidEnv(name, raw, fallback, 'expected integer');
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

function envPositiveInt(name, fallback, { max = Infinity } = {}) {
  return envInt(name, fallback, { min: 1, max });
}

function envBoundedInt(name, fallback, min, max) {
  return envInt(name, fallback, { min, max });
}

// Optional telemetry sub-gates. Each falls back to the RESOURCE_LOGS master
// gate when its own variable is unset, so default log output is unchanged.
function telemetrySubGate(name) {
  const raw = envRaw(name);
  if (!raw) return envBool('RESOURCE_LOGS', true);
  return envBool(name, true);
}

function commandMemoryLogsEnabled() {
  return telemetrySubGate('COMMAND_MEMORY_LOGS');
}

function cacheMetricsLogsEnabled() {
  return telemetrySubGate('CACHE_METRICS_LOGS');
}

function networkUsageLogsEnabled() {
  return telemetrySubGate('NETWORK_USAGE_LOGS');
}

function safeMeta(meta = {}) {
  const allowed = [
    'system', 'command', 'imageType', 'bytes', 'guildId', 'userId',
    'reason', 'status', 'durationMs', 'debounceMs', 'spawnId',
    'cache', 'name', 'originalBytes', 'optimizedBytes', 'format',
    'queueWaitMs', 'renderMs', 'rss', 'heapUsed', 'heapTotal', 'heapLimit',
    'external', 'arrayBuffers', 'uptimeSec', 'userCpuMs', 'systemCpuMs',
    'entries', 'bufferEntries', 'imageEntries', 'diskHits', 'diskMisses',
    'throttleMs', 'poolKey', 'poolSize', 'candidateCount', 'count',
    'removed', 'events', 'attackers', 'limit',
    'phase', 'rendered', 'renderMode', 'cacheStatus', 'skipReason',
    'assetEntries', 'assetMb', 'assetMaxMb', 'canvasEntries', 'canvasMb',
    'canvasMaxMb', 'battleStaticEntries', 'battleStaticMb', 'battleStaticMaxMb',
    'profileEntries', 'queueActive', 'queueQueued', 'queueLimit',
    'avatarSource', 'avatarKey', 'assetKey', 'loadStatus', 'quality', 'envName',
    'preservedImage', 'multiplier', 'baseHp', 'baseAtk', 'baseDef', 'baseCrit',
    'finalHp', 'finalAtk', 'finalDef', 'finalCrit', 'attackDefenseMultiplier',
    'source', 'thumbnailVariant',
    'skinSource', 'skinCategory', 'cosmeticKey',
  ];
  const out = {};
  for (const key of allowed) {
    const value = meta[key];
    if (value == null || value === '') continue;
    out[key] = typeof value === 'number' ? value : String(value);
  }
  return out;
}

function metaString(meta = {}) {
  const parts = Object.entries(safeMeta(meta)).map(([key, value]) => `${key}=${value}`);
  return parts.length ? ` ${parts.join(' ')}` : '';
}

function bandwidthLog(event, meta = {}) {
  if (!envTrue('BANDWIDTH_LOGS')) return;
  console.log(`[bandwidth] ${event}${metaString(meta)}`);
}

function performanceLog(event, meta = {}) {
  if (!envTrue('PERFORMANCE_LOGS')) return;
  console.log(`[perf] ${event}${metaString(meta)}`);
}

function criticalEgressWarn(event, meta = {}) {
  console.warn(`[egress] ${event}${metaString(meta)}`);
}

registerMemorySource('runtime.env-warnings', () => ({
  entries: warnedEnv.size,
  maxEntries: WARNED_ENV_MAX,
}));

module.exports = {
  envTrue,
  envBool,
  envNumber,
  envInt,
  envPositiveInt,
  envBoundedInt,
  bandwidthLog,
  performanceLog,
  criticalEgressWarn,
  metaString,
  commandMemoryLogsEnabled,
  cacheMetricsLogsEnabled,
  networkUsageLogsEnabled,
};
