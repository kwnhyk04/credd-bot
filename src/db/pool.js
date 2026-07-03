const fs = require('fs');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: true,
    ca: fs.readFileSync('./prod-ca-2021.crt').toString()
  }
});

pool.on('error', (err) => {
  console.error('[pool] Unexpected client error:', err.message);
});

module.exports = pool;
