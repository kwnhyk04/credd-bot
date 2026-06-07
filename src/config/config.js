require('dotenv').config();

function require_env(key) {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env variable: ${key}`);
  return val;
}

module.exports = {
  BOT_TOKEN:    require_env('BOT_TOKEN'),
  CLIENT_ID:    require_env('CLIENT_ID'),
  DATABASE_URL: require_env('DATABASE_URL'),
  DEV_IDS:      require_env('DEV_IDS').split(',').map(s => s.trim()).filter(Boolean),
};
