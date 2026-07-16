'use strict';

process.env.RESOURCE_LOGS = 'false';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

// Simulate an assetless production deployment with mocked fetch and no disk writes.
const BASE_URL = 'https://cdn.example.test/bucket';
const VERSION = 'skin-r2-selftest';
const OVERRIDE_FOLDER = 'testers/r2-only-selftest-000';
process.env.ASSET_BASE_URL = BASE_URL;
process.env.ASSET_VERSION = VERSION;
process.env.ASSET_DISK_CACHE_ENABLED = 'false';
process.env.BATTLE_BASE_CACHE_MAX_MB = '1';
process.env.RESULT_BASE_CACHE_MAX_MB = '1';
process.env.BATTLE_RENDER_CACHE_MAX_MB = '2';
process.env.IMAGE_FAST_OPAQUE_ENCODE = 'false';
process.env.BANDWIDTH_LOGS = 'false';
process.env.PERFORMANCE_LOGS = 'false';

const WIDTH = 768;
const HEIGHT = 512;
const SENTINEL = [219, 45, 170, 255];

function sentinelPng() {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = `rgb(${SENTINEL[0]}, ${SENTINEL[1]}, ${SENTINEL[2]})`;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  return canvas.toBuffer('image/png');
}

function textStyle(x, y) {
  return {
    x, y, size: 14, font: 'DejaVu Sans', color: '#ffffff',
    anchor: 'left', max_width: 260,
  };
}

function battleSide(y) {
  return {
    name: textStyle(30, y),
    sub: textStyle(30, y + 24),
    loadout: textStyle(30, y + 48),
    hp_text: textStyle(30, y + 72),
    hp_bar: {
      x: 30, y: y + 86, w: 360, h: 12, radius: 6,
      track: '#111111', fill: '#43d675',
    },
    stats: {
      x: 30, y: y + 116, size: 12, font: 'DejaVu Sans',
      color: '#ffffff', cols: [],
    },
  };
}

const BATTLE_LAYOUT = {
  canvas: { w: WIDTH, h: HEIGHT },
  player: battleSide(50),
  enemy: battleSide(280),
};

const RESULT_LAYOUT = {
  canvas: { w: WIDTH, h: HEIGHT },
  panel: { x: 100, y: 100, w: 568, h: 300 },
};

const remoteObjects = new Map();
const putRemote = (key, body) => remoteObjects.set(key, Buffer.isBuffer(body) ? body : Buffer.from(body));
const folderKey = (name) => `skins/${OVERRIDE_FOLDER}/${name}`;
const png = sentinelPng();

// Only later SET_FILES candidates exist to prove resolution does not depend on local assets.
putRemote(folderKey('founder_profile.png'), png);
putRemote(folderKey('founder_battle.png'), png);
putRemote(folderKey('founder_battle.layout.json'), JSON.stringify(BATTLE_LAYOUT));
putRemote(folderKey('founder_victory.png'), png);
putRemote(folderKey('founder_victory.layout.json'), JSON.stringify(RESULT_LAYOUT));
putRemote(folderKey('founder_defeated.png'), png);
putRemote(folderKey('founder_defeated.layout.json'), JSON.stringify(RESULT_LAYOUT));
putRemote(folderKey('founder_summon.webp'), png);

const networkCalls = [];
global.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  const method = String(init.method || 'GET').toUpperCase();
  const prefix = '/bucket/';
  assert.equal(url.origin, 'https://cdn.example.test', `unexpected network origin: ${url.origin}`);
  assert.ok(url.pathname.startsWith(prefix), `unexpected asset path: ${url.pathname}`);
  const key = decodeURIComponent(url.pathname.slice(prefix.length));
  networkCalls.push({ method, key, search: url.search });
  const body = remoteObjects.get(key);
  if (method === 'HEAD') return new Response(null, { status: body ? 200 : 404 });
  if (method !== 'GET') return new Response(null, { status: 405 });
  return body
    ? new Response(body, { status: 200, headers: { 'content-length': String(body.length) } })
    : new Response('missing', { status: 404 });
};

const {
  assetPath,
  loadCachedImage,
  localAssetPath,
} = require('../src/utils/assets');
const {
  TESTER_AVATAR_VARIANTS,
  TESTER_PROFILE_VARIANTS,
} = require('../src/config/cosmetics');
const { buildEntries: buildCosmeticEntries } = require('./seedCosmetics');
const { seedRows: buildAvatarEntries } = require('../src/engine/avatarSystem');
const { layoutPathFor: profileLayoutPathFor } = require('../src/engine/profileLayoutRenderer');
const { layoutPathFor: statsLayoutPathFor } = require('../src/engine/statsLayoutRenderer');
const {
  resolveSkin,
  resolveStatsSkin,
  resolveSummonAnimation,
} = require('../src/engine/skinResolver');
const {
  loadBattleSkin,
  renderBattleSkinPanel,
  clearBattleBaseCache,
  getBattleBaseCacheStats,
} = require('../src/engine/battleLayoutRenderer');
const {
  loadResultSkin,
  renderResultPanel,
  clearResultBaseCache,
  getResultBaseCacheStats,
} = require('../src/engine/resultLayoutRenderer');
const { buildFlipMessage, buildResultMessage, summonFlipEmoji } = require('../src/engine/renderSummon');
const {
  avatarImageSourceCandidates,
  loadAvatarAsset,
} = require('../src/engine/avatarImageLoader');

function expectedUrl(key) {
  return `${BASE_URL}/${key}?v=${encodeURIComponent(VERSION)}`;
}

function overrideDb(overridePath = OVERRIDE_FOLDER) {
  const rows = ['profile', 'battle', 'battle_result', 'summon'].map((category) => ({
    category,
    cosmetic_id: null,
    override_path: overridePath,
  }));
  return {
    async query(sql) {
      if (sql.includes('SELECT category, cosmetic_id, override_path')) return { rows };
      if (sql.includes('FROM supporters')) return { rows: [] };
      throw new Error(`Unexpected override resolver query: ${sql}`);
    },
  };
}

function storeSummonDb(overrides = {}) {
  const cosmetic = {
    cosmetic_id: 44,
    cosmetic_key: 'c_rune_glow_s1',
    category: 'summon',
    tier: 'chosen',
    display_name: 'Rune Glow',
    token_cost: 3,
    is_base: false,
    has_top_label: false,
    display_filename: 'supporters/supporter_store/card_flip/img/rune_glow.png',
    render_filename: 'supporters/supporter_store/card_flip/c_rune_glow_s1.gif',
    victory_filename: null,
    defeated_filename: null,
    is_active: true,
    skin_code: 's1',
    ...overrides,
  };
  return {
    cosmetic,
    db: {
      async query(sql) {
        if (sql.includes('SELECT category, cosmetic_id, override_path')) {
          return { rows: [{ category: 'summon', cosmetic_id: cosmetic.cosmetic_id, override_path: null }] };
        }
        if (sql.includes('FROM cosmetic_catalog WHERE cosmetic_id')) return { rows: [cosmetic] };
        if (sql.includes('FROM supporters')) return { rows: [] };
        throw new Error(`Unexpected store summon query: ${sql}`);
      },
    },
  };
}

async function pixelAt(imageOrBuffer, x = 2, y = 2) {
  const image = Buffer.isBuffer(imageOrBuffer) ? await loadImage(imageOrBuffer) : imageOrBuffer;
  assert.equal(image.width, WIDTH);
  assert.equal(image.height, HEIGHT);
  const sample = createCanvas(1, 1);
  const ctx = sample.getContext('2d');
  ctx.drawImage(image, -x, -y);
  return [...ctx.getImageData(0, 0, 1, 1).data];
}

async function assertSentinel(imageOrBuffer, label) {
  const actual = await pixelAt(imageOrBuffer);
  for (let i = 0; i < SENTINEL.length; i += 1) {
    assert.ok(
      Math.abs(actual[i] - SENTINEL[i]) <= 2,
      `${label} lost the skin background at channel ${i}: ${actual.join(',')}`
    );
  }
}

function battleSim() {
  const fighter = {
    name: 'Tester', kind: 'player', cls: 'Knight', level: 20,
    weapon: 'Sword', deity: 'Odin', atk: 100, def: 80, crit: 5,
  };
  return {
    mode: 'raid',
    a: fighter,
    b: { ...fighter, name: 'Target', kind: 'mob', cls: 'mob', skill: 'None' },
    snapshots: [{
      round: 1,
      a: { hp: 900, maxHp: 1000, debuffs: [] },
      b: { hp: 500, maxHp: 1000, debuffs: [] },
      actions: null,
    }],
  };
}

async function main() {
  const profileVariant = TESTER_PROFILE_VARIANTS.find(
    (entry) => entry.cosmetic_key === 'tester_1444953283306328075_profile2'
  );
  assert.ok(profileVariant, 'tester profile2 config must be registered');
  const seededProfiles = buildCosmeticEntries().filter(
    (entry) => entry.cosmetic_key === profileVariant.cosmetic_key
  );
  assert.equal(seededProfiles.length, 1, 'tester profile2 must have exactly one catalog seed row');
  assert.deepEqual(
    {
      category: seededProfiles[0].category,
      tier: seededProfiles[0].tier,
      tokenCost: seededProfiles[0].token_cost,
      topLabel: seededProfiles[0].has_top_label,
      display: seededProfiles[0].display_filename,
      render: seededProfiles[0].render_filename,
      skinCode: seededProfiles[0].skin_code,
    },
    {
      category: 'profile',
      tier: 'believer',
      tokenCost: 0,
      topLabel: true,
      display: 'testers/tester_profile2.png',
      render: 'testers/tester_profile2.png',
      skinCode: 'pt5p2',
    }
  );

  const profile2Url = assetPath(`skins/${profileVariant.render_filename}`);
  const sourceBase = `skins/${profileVariant.layout_source_filename}`.replace(/\.png$/, '');
  assert.equal(
    profileLayoutPathFor(profile2Url),
    expectedUrl(`${sourceBase}.layout.json`),
    'crd profile must reuse the existing tester profile layout'
  );
  assert.equal(
    statsLayoutPathFor(profile2Url),
    expectedUrl(`${sourceBase}.stats.layout.json`),
    'crd stats must reuse the existing tester stats layout'
  );
  assert.equal(
    profileLayoutPathFor(localAssetPath(`skins/${profileVariant.render_filename}`)),
    localAssetPath(`${sourceBase}.layout.json`),
    'local alignment tools must reuse the local tester layout path'
  );

  const avatarSeeds = new Map(buildAvatarEntries().map((entry) => [entry.avatar_key, entry]));
  for (const expected of TESTER_AVATAR_VARIANTS) {
    assert.deepEqual(
      avatarSeeds.get(expected.avatar_key),
      expected,
      `${expected.avatar_key} must remain in the avatar catalog seed`
    );
  }

  const localOnlyPath = path.join(process.cwd(), 'assets', 'skins', ...OVERRIDE_FOLDER.split('/'));
  assert.equal(fs.existsSync(localOnlyPath), false, 'R2-only fixture must not exist under local assets');

  const db = overrideDb();
  const profile = await resolveSkin(db, 'r2-user', 'profile');
  const stats = await resolveStatsSkin(db, 'r2-user');
  const battle = await resolveSkin(db, 'r2-user', 'battle');
  const victory = await resolveSkin(db, 'r2-user', 'battle_result', { variant: 'victory' });
  const defeated = await resolveSkin(db, 'r2-user', 'battle_result', { variant: 'defeated' });
  const summon = await resolveSummonAnimation(db, 'r2-user');

  assert.deepEqual(
    [profile.path, stats.path, battle.path, victory.path, defeated.path, summon.path],
    [
      expectedUrl(folderKey('founder_profile.png')),
      expectedUrl(folderKey('founder_profile.png')),
      expectedUrl(folderKey('founder_battle.png')),
      expectedUrl(folderKey('founder_victory.png')),
      expectedUrl(folderKey('founder_defeated.png')),
      expectedUrl(folderKey('founder_summon.webp')),
    ]
  );
  assert.equal(profile.source, 'override');
  assert.equal(stats.source, 'profile-override');
  assert.equal(summon.source, 'override');
  assert.equal(summon.kind, 'tester-media');
  assert.equal(summon.mediaPath, summon.path);

  // Verify profile and stats share one decoded custom R2 background.
  const profileImage = await loadCachedImage(profile.path);
  const statsImage = await loadCachedImage(stats.path);
  assert.strictEqual(profileImage, statsImage, 'profile/stats should share the decoded image cache entry');
  await assertSentinel(profileImage, 'profile/stats skin');

  const loadedBattle = await loadBattleSkin(battle.path);
  assert.ok(loadedBattle?.image, 'R2 battle skin and layout should load');
  const sim = battleSim();
  for (let i = 0; i < 2; i += 1) {
    const rendered = renderBattleSkinPanel(sim, 0, loadedBattle, { mode: 'raid' });
    assert.ok(Buffer.isBuffer(rendered) && rendered.length > 100, 'battle skin should render a nontrivial image');
    await assertSentinel(rendered, `battle skin render ${i + 1}`);
    assert.equal(getBattleBaseCacheStats().entries, 0, 'oversized battle base must bypass the undersized cache');
  }

  for (const [label, resolved, winner] of [
    ['victory', victory, 'a'],
    ['defeated', defeated, 'b'],
  ]) {
    const loadedResult = await loadResultSkin(resolved.path);
    assert.ok(loadedResult?.image, `${label} R2 result skin and layout should load`);
    const rendered = await renderResultPanel({ winner, b: { name: 'Target' } }, null, loadedResult);
    assert.ok(Buffer.isBuffer(rendered) && rendered.length > 100, `${label} result should render a nontrivial image`);
    await assertSentinel(rendered, `${label} result skin`);
    assert.equal(getResultBaseCacheStats().entries, 0, 'oversized result base must bypass the undersized cache');
  }

  // A version query must not make a remote WebP look like a non-image token.
  const blockedMediaPayload = await buildFlipMessage(summon.path);
  const blockedMediaJson = JSON.stringify(blockedMediaPayload.components.map((component) => component.toJSON()));
  assert.ok(!blockedMediaJson.includes(summon.path), 'image extension alone must never authorize summon media');
  assert.deepEqual(blockedMediaPayload.files, []);

  const mediaPayload = await buildFlipMessage(summon.path, {}, { allowMedia: true });
  const mediaJson = JSON.stringify(mediaPayload.components.map((component) => component.toJSON()));
  assert.ok(mediaJson.includes(summon.path), 'versioned summon URL should render as MediaGallery content');
  assert.deepEqual(mediaPayload.files, []);

  const summonResults = [{ name: 'Measured Deity', rarity: 'Remnant', isNew: true }];
  const summonBalances = { beliefShards: 100, sacredRelics: 2 };
  const remoteResult = await buildResultMessage(summonResults, summonBalances, {
    flipPath: summon.path,
    allowMedia: true,
  });
  const remoteResultJson = JSON.stringify(remoteResult.components.map((component) => component.toJSON()));
  assert.deepEqual(remoteResult.files, [], 'remote summon media must never become a bot attachment');
  assert.ok(remoteResultJson.includes('## ✨ Invocation Complete'), 'final image-skin header presentation must be preserved');
  assert.ok(!remoteResultJson.includes(summon.path), 'remote summon animation must disappear from the final result');

  const localFlip = path.join(__dirname, '..', 'assets', 'skins', 'founder', 'founder_summon.webp');
  const localResult = await buildResultMessage(summonResults, summonBalances, {
    flipPath: localFlip,
  });
  const localResultJson = JSON.stringify(localResult.components.map((component) => component.toJSON()));
  assert.deepEqual(localResult.files, [], 'local summon animation must not be loaded or uploaded in the final edit');
  assert.ok(!localResultJson.includes('summonflip.'), 'local summon attachment must not be referenced by the final result');
  assert.ok(localResultJson.includes(summonFlipEmoji(localFlip)), 'non-tester image paths must use the usual header emoji');
  const summonCommandSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'commands', 'rpg', 'summon.js'), 'utf8');
  const summonRendererSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'engine', 'renderSummon.js'), 'utf8');
  assert.ok(/attachments:\s*\[\]/.test(summonCommandSource), 'final summon edit must clear suspense attachments');
  assert.ok(!/existingAnimation|animationUrl/.test(`${summonCommandSource}\n${summonRendererSource}`), 'summon result must not retain suspense media');

  // Store summon skins must resolve to uploaded Discord emojis without probing source GIFs.
  const { db: summonDb, cosmetic } = storeSummonDb();
  const beforeStoreHeads = networkCalls.filter((call) => call.method === 'HEAD').length;
  const storeSummon = await resolveSummonAnimation(summonDb, 'store-user');
  assert.equal(storeSummon.path, cosmetic.cosmetic_key);
  assert.equal(storeSummon.source, 'equipped-emoji');
  assert.equal(storeSummon.kind, 'emoji');
  assert.equal(storeSummon.mediaPath, null);
  assert.equal(
    networkCalls.filter((call) => call.method === 'HEAD').length,
    beforeStoreHeads,
    'Discord-emoji summon skins should not probe their intentionally absent source GIF'
  );
  const emojiPayload = await buildFlipMessage(storeSummon.path);
  const emojiJson = JSON.stringify(emojiPayload.components.map((component) => component.toJSON()));
  assert.ok(emojiJson.includes('1523064836185915555'), 'equipped S1 skin should render the Rune Glow Discord emoji');
  assert.ok(!emojiJson.includes('supporter_store/card_flip'), 'emoji token must not become a broken media URL');
  const emojiResult = await buildResultMessage(summonResults, summonBalances, { flipPath: storeSummon.emojiKey });
  const emojiResultJson = JSON.stringify(emojiResult.components.map((component) => component.toJSON()));
  assert.ok(emojiResultJson.includes('1523064836185915555'), 'equipped skin should also change the final header emoji');
  assert.deepEqual(emojiResult.files, []);

  // Tester catalog rows retain full suspense media, while founder, future, and
  // raw non-tester image overrides are forced through header emojis.
  const { db: testerCatalogDb } = storeSummonDb({
    cosmetic_id: 45,
    cosmetic_key: 'tester_123456789_summon',
    render_filename: `${OVERRIDE_FOLDER}/founder_summon.webp`,
    display_filename: `${OVERRIDE_FOLDER}/founder_summon.webp`,
    skin_code: 'st1',
  });
  const testerCatalogSummon = await resolveSummonAnimation(testerCatalogDb, '123456789');
  assert.equal(testerCatalogSummon.kind, 'tester-media');
  assert.equal(testerCatalogSummon.path, summon.path);
  const testerCatalogPayload = await buildFlipMessage(
    testerCatalogSummon.mediaPath,
    {},
    { allowMedia: testerCatalogSummon.kind === 'tester-media' }
  );
  assert.ok(
    JSON.stringify(testerCatalogPayload.components.map((component) => component.toJSON())).includes(summon.path),
    'tester catalog summon should retain its full-size suspense media'
  );

  const { db: founderDb } = storeSummonDb({
    cosmetic_id: 46,
    cosmetic_key: 'founder_summon',
    render_filename: 'founder/founder_summon.webp',
    display_filename: 'founder/founder_summon.webp',
    skin_code: 'sf',
  });
  const founderSummon = await resolveSummonAnimation(founderDb, 'founder-user');
  assert.equal(founderSummon.kind, 'emoji');
  assert.equal(founderSummon.path, 'founder_summon');
  const founderPayload = await buildFlipMessage(founderSummon.emojiKey);
  const founderJson = JSON.stringify(founderPayload.components.map((component) => component.toJSON()));
  assert.ok(!founderJson.includes('founder_summon.webp'), 'founder summon must not render full-size media');
  assert.deepEqual(founderPayload.files, []);

  const { db: futureDb } = storeSummonDb({
    cosmetic_id: 47,
    cosmetic_key: 'rune_glow',
    render_filename: 'future/nonstandard-summon-image.webp',
    display_filename: 'future/nonstandard-summon-image.webp',
    skin_code: 'future',
  });
  const beforeFutureHeads = networkCalls.filter((call) => call.method === 'HEAD').length;
  const futureSummon = await resolveSummonAnimation(futureDb, 'future-user');
  assert.equal(futureSummon.kind, 'emoji');
  assert.equal(
    networkCalls.filter((call) => call.method === 'HEAD').length,
    beforeFutureHeads,
    'emoji-only future skins must not probe their source image'
  );
  const futurePayload = await buildFlipMessage(futureSummon.emojiKey);
  const futureJson = JSON.stringify(futurePayload.components.map((component) => component.toJSON()));
  assert.ok(futureJson.includes('1523058975392661625'), 'future registered skin keys should change only the header emoji');
  assert.ok(!futureJson.includes('nonstandard-summon-image.webp'));
  assert.deepEqual(futurePayload.files, []);

  const founderOverride = await resolveSummonAnimation(
    overrideDb('founder/founder_summon.webp'),
    'founder-override-user'
  );
  assert.equal(founderOverride.kind, 'emoji');
  assert.equal(founderOverride.emojiKey, 'card_flip');
  assert.ok(!/flipGifExists/.test(`${summonCommandSource}\n${summonRendererSource}`), 'header emoji suspense must not depend on a disk GIF');

  // Retain version queries while trying the historical `acher_*` R2 fallback.
  const canonicalAvatar = assetPath('skins/avatars/male/archer/archer_cyber.png');
  const typoAvatar = assetPath('skins/avatars/male/archer/acher_cyber.png');
  const candidates = avatarImageSourceCandidates(canonicalAvatar);
  assert.ok(candidates.includes(typoAvatar), 'versioned archer avatar candidates should include the acher_* fallback');
  assert.ok(candidates.every((candidate) => candidate.endsWith(`?v=${VERSION}`)), 'avatar candidates must retain ASSET_VERSION');
  const attempts = [];
  const avatarMarker = { width: 10, height: 10 };
  const loadedAvatar = await loadAvatarAsset(async (candidate) => {
    attempts.push(candidate);
    if (candidate === typoAvatar) return avatarMarker;
    throw new Error('fixture missing');
  }, [{ path: canonicalAvatar, avatarSource: 'equipped-avatar' }]);
  assert.strictEqual(loadedAvatar, avatarMarker);
  assert.ok(attempts.includes(typoAvatar));

  // Every request must use the stable version and repeated reads must hit memory caches.
  assert.ok(networkCalls.length > 0);
  assert.ok(networkCalls.every((call) => call.search === `?v=${VERSION}`));
  assert.equal(
    networkCalls.filter((call) => call.method === 'GET' && call.key === folderKey('founder_profile.png')).length,
    1,
    'profile/stats must not redownload the identical R2 skin'
  );

  clearBattleBaseCache();
  clearResultBaseCache();
  console.log('skin R2 selftest passed');
}

main().catch((err) => {
  clearBattleBaseCache();
  clearResultBaseCache();
  console.error(err);
  process.exitCode = 1;
});
