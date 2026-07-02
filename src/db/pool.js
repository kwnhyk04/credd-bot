const fs = require('fs');
const { Pool } = require('pg');
const { DATABASE_URL } = require('../config/config');

// TLS for remote/hosted Postgres. Precedence:
//   PGSSL_CA=<path>  → encrypt AND verify the server against the provider CA (preferred)
//   PGSSL=require or sslmode=require in DATABASE_URL → encrypt without CA verification
//   neither          → no SSL (local/same-host DB only)
function sslConfig() {
  if (process.env.PGSSL_CA) {
    return { rejectUnauthorized: true, ca: fs.readFileSync(process.env.PGSSL_CA).toString() };
  }
  if (process.env.PGSSL === 'require' || /[?&]sslmode=require/.test(DATABASE_URL)) {
    return { rejectUnauthorized: false };
  }
  return undefined;
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: sslConfig(),
});

pool.on('error', (err) => {
  console.error('[pool] Unexpected client error:', err.message);
});

module.exports = pool;
