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

const pool = new Pool({
  connectionString: connectionStringWithoutSslParams(process.env.DATABASE_URL),
  ssl: {
    rejectUnauthorized: true,
    ca: fs.readFileSync(path.join(__dirname, '..', '..', 'prod-ca-2021.crt')).toString()
  }
});

pool.on('error', (err) => {
  console.error('[pool] Unexpected client error:', err.message);
});

module.exports = pool;
