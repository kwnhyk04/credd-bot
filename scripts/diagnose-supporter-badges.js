'use strict';

require('dotenv').config();
const { isRemoteAssetsEnabled, remoteAssetAvailable } = require('../src/utils/assets');

const candidates = [
  'skins/supporters/believer.png',
  'skins/supporters/chosen.png',
  'skins/supporters/eternal.png',
  'skins/supporters/founder.png',
  'skins/supporters/badge/believer.png',
  'skins/supporters/badge/chosen.png',
  'skins/supporters/badge/eternal.png',
  'skins/supporters/badge/founder.png',
];

async function main() {
  if (!isRemoteAssetsEnabled()) throw new Error('ASSET_BASE_URL is not configured.');
  for (const candidate of candidates) {
    console.log(`${candidate}: ${await remoteAssetAvailable(candidate)}`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
