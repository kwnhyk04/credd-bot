'use strict';

const assert = require('node:assert/strict');

process.env.ASSET_BASE_URL = 'https://cdn.example.test/bucket';
process.env.ASSET_VERSION = 'asset-r2-fallback-selftest';
process.env.ASSET_DISK_CACHE_ENABLED = 'false';
process.env.R2_ACCOUNT_ID = 'account';
process.env.R2_ACCESS_KEY_ID = 'access';
process.env.R2_SECRET_ACCESS_KEY = 'secret';
process.env.R2_BUCKET = 'bucket';

const expected = Buffer.from('authenticated-r2-object');
const calls = [];
global.fetch = async (input, options = {}) => {
  const url = new URL(String(input));
  const method = String(options.method || 'GET').toUpperCase();
  calls.push({ host: url.hostname, method, path: url.pathname });
  if (url.hostname === 'cdn.example.test') throw new Error('public endpoint unavailable');
  if (url.hostname === 'account.r2.cloudflarestorage.com' && method === 'GET') {
    return new Response(expected, { status: 200 });
  }
  return new Response(null, { status: 404 });
};

async function main() {
  const { fetchAssetBuffer } = require('../src/utils/assets');
  const actual = await fetchAssetBuffer('classes/battle_base/battle_swordsman.png');
  assert.deepEqual(actual, expected);
  assert(calls.some((call) => call.host === 'cdn.example.test' && call.method === 'GET'));
  assert(calls.some((call) => call.host === 'account.r2.cloudflarestorage.com' && call.method === 'GET'));
  console.log('ASSET R2 FALLBACK SELFTEST: passed');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
