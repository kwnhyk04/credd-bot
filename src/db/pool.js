const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

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
