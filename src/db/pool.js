const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

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
  idleTimeoutMillis: positiveIntEnv('PG_IDLE_TIMEOUT_MS', 30_000),
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

module.exports = pool;
