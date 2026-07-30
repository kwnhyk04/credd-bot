const fs = require('fs');
const path = require('path');
const { Pool, types } = require('pg');

// ── int8 (BIGINT, OID 20) → JS number ────────────────────────────────────────
// pg returns BIGINT as a STRING by default, to avoid silent precision loss above
// Number.MAX_SAFE_INTEGER. That default is a correctness hazard for this codebase:
// `lifetime_exp + gain` would CONCATENATE rather than add, silently, and every
// comparison against a numeric literal would be a string comparison. Progression v2
// makes user_character.lifetime_exp the source of truth for levels, so this parser is
// what makes JS-side arithmetic on it safe — do not remove it without converting every
// read site to an explicit Number().
//
// Safety, verified against the LIVE database rather than the committed dump (the dump
// was stale — 37 columns vs 40 in production):
//   SELECT table_name, column_name FROM information_schema.columns
//    WHERE data_type='bigint' AND table_schema='public';
// returns 40 columns, ALL of them economy/stat counters (credux, combat_exp,
// believer_exp, bet_amount, payout, max_hp, total_damage, ...), surrogate sequence PKs,
// or internal avatar_id catalog keys. ZERO are Discord snowflakes — every discord_id,
// guild_id, channel_id and message_id is character varying(20). Snowflakes exceed
// MAX_SAFE_INTEGER by ~137x and WOULD be silently rounded by this parser, so re-run
// that query before adding any bigint column that could hold an ID.
//
// Residual risk: values above 9,007,199,254,740,991 round. The v2 curve tops out at
// 3.63e9 so it is nowhere near, but users_bag.credux and lifetime_credux_earned are
// unbounded accumulators and are the pair to watch long-term.
types.setTypeParser(20, (value) => (value === null ? null : Number(value)));

const trackedSockets = new Map();
const networkStats = {
  connectionOpens: 0,
  connectionCloses: 0,
  closedBytesRead: 0,
  closedBytesWritten: 0,
};

function connectionStringWithoutSslParams(raw) {
  if (!raw) return raw;
  try {
    const url = new URL(raw);
    for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) {
      url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return raw;
  }
}

function positiveIntEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

const pool = new Pool({
  connectionString: connectionStringWithoutSslParams(process.env.DATABASE_URL),
  ssl: {
    rejectUnauthorized: true,
    ca: fs.readFileSync(path.join(__dirname, '..', '..', 'prod-ca-2021.crt')).toString()
  },
  // Anti-deadlock guardrails: without these, one stalled connection or row lock
  // wedges a command forever — its finally-cleanup (e.g. the active_battles
  // DELETE after a raid) never runs and the player is locked out permanently.
  max: positiveIntEnv('PG_POOL_MAX', 10),
  // pool.connect() fails fast instead of queueing forever when the pool is starved
  connectionTimeoutMillis: positiveIntEnv('PG_CONNECT_TIMEOUT_MS', 10_000),
  idleTimeoutMillis: positiveIntEnv('PG_IDLE_TIMEOUT_MS', 120_000),
  keepAlive: true,
  // client-side cap — also catches dead sockets the server never saw
  query_timeout: positiveIntEnv('PG_QUERY_TIMEOUT_MS', 30_000),
  // server-side caps — statement_timeout includes lock-wait time; the idle-in-
  // transaction timeout kills leaked BEGINs so their row locks release themselves
  statement_timeout: positiveIntEnv('PG_STATEMENT_TIMEOUT_MS', 25_000),
  idle_in_transaction_session_timeout: positiveIntEnv('PG_IDLE_TXN_TIMEOUT_MS', 60_000),
});

pool.on('error', (err) => {
  console.error('[pool] Unexpected client error:', err.message);
});

pool.on('connect', (client) => {
  const socket = client?.connection?.stream;
  if (!socket || trackedSockets.has(socket)) return;
  const entry = {
    // The socket is new to this pool. A zero baseline includes TLS/auth traffic
    // that occurred before pg emitted its connect event.
    bytesRead: 0,
    bytesWritten: 0,
  };
  trackedSockets.set(socket, entry);
  networkStats.connectionOpens += 1;
  socket.once('close', () => {
    networkStats.connectionCloses += 1;
    networkStats.closedBytesRead += Math.max(0, (Number(socket.bytesRead) || 0) - entry.bytesRead);
    networkStats.closedBytesWritten += Math.max(0, (Number(socket.bytesWritten) || 0) - entry.bytesWritten);
    trackedSockets.delete(socket);
  });
});

function getNetworkStats() {
  let bytesRead = networkStats.closedBytesRead;
  let bytesWritten = networkStats.closedBytesWritten;
  for (const [socket, entry] of trackedSockets) {
    bytesRead += Math.max(0, (Number(socket.bytesRead) || 0) - entry.bytesRead);
    bytesWritten += Math.max(0, (Number(socket.bytesWritten) || 0) - entry.bytesWritten);
  }
  return {
    connectionOpens: networkStats.connectionOpens,
    connectionCloses: networkStats.connectionCloses,
    activeSockets: trackedSockets.size,
    bytesRead,
    bytesWritten,
  };
}

pool.getNetworkStats = getNetworkStats;

module.exports = pool;
