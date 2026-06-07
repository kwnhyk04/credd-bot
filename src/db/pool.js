const { Pool } = require('pg');
const { DATABASE_URL } = require('../config/config');

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('[pool] Unexpected client error:', err.message);
});

module.exports = pool;
