'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  CUSTOM_AVATAR_TOKEN_PRICE,
  STYLE_COST,
  STYLE_LABEL,
  avatarShortId,
  buildAvatarPage,
  buildAvatarPreview,
  canonicalAvatarAssetPath,
  customAvatarTokenPurchaseMessage,
  genesisAvatarAssetPath,
  purchaseCustomAvatarToken,
  resolveStatsAvatar,
} = require('../src/engine/avatarSystem');
const avatarPool = require('../src/db/pool');
const { loadAvatarAsset } = require('../src/engine/avatarImageLoader');
const { relativeAssetPath } = require('../src/utils/assets');
const {
  getProfileImageCache,
  getProfileImageCacheStats,
  setProfileImageCache,
  signature,
} = require('../src/utils/profileImageCache');

async function main() {
  const classes = ['archer', 'fighter', 'knight', 'mage', 'swordsman'];
  const genders = ['male', 'female'];
  const registered = [];
  for (const className of classes) {
    for (const gender of genders) {
      const expected = `skins/avatars/genesis/${gender}/genesis_${className}_${gender}.png`;
      assert.equal(genesisAvatarAssetPath(className, gender), expected);
      assert.equal(canonicalAvatarAssetPath({ class_name: className, gender, style: 'genesis' }), expected);
      registered.push(expected);
    }
  }
  assert.equal(new Set(registered).size, 10);
  assert.equal(
    registered.some((assetPath) => /divine/i.test(assetPath)),
    false,
    'Genesis avatar assets must never be routed through the Divine weapon namespace',
  );
  assert.equal(CUSTOM_AVATAR_TOKEN_PRICE, 30);
  assert.equal(STYLE_COST.genesis, 15);
  assert.equal(STYLE_LABEL.genesis, 'Genesis');
  const avatarSystemSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'engine', 'avatarSystem.js'),
    'utf8',
  );
  assert.doesNotMatch(avatarSystemSource, /skins\/avatars\/divine/i);
  assert.equal(avatarShortId({ avatar_key: 'tester_ta', style: 'tester', gender: 'male' }), 'ta');
  assert.equal(avatarShortId({ avatar_key: 'tester_712', style: 'tester', gender: 'male' }), '712');
  assert.equal(avatarShortId({ avatar_key: 'fighter_cm', style: 'cyber', gender: 'male' }), 'cm');
  assert.equal(avatarShortId({ avatar_key: 'custom_special_skin', style: 'custom', gender: 'female' }), 'special_skin');
  assert.equal(avatarShortId({ style: 'cyber', gender: 'male' }), 'cm');

  assert.equal(
    genesisAvatarAssetPath('  MAGE ', ' FEMALE '),
    'skins/avatars/genesis/female/genesis_mage_female.png'
  );
  for (const [className, gender] of [
    ['', 'male'], ['cleric', 'male'], ['../mage', 'male'], ['mage/../../etc', 'male'],
    ['mage', ''], ['mage', 'other'], ['mage', '../female'], ['mage', 'female/../../x'],
  ]) {
    assert.equal(genesisAvatarAssetPath(className, gender), null);
  }

  assert.equal(
    canonicalAvatarAssetPath({ class_name: 'Mage', gender: 'female', style: 'webtoon' }),
    'skins/avatars/female/mage/mage_webtoon.png'
  );
  assert.equal(canonicalAvatarAssetPath({ class_name: 'Mage', gender: 'avatar', style: 'founder' }), null);

  const oldPath = genesisAvatarAssetPath('fighter', 'male');
  const newPath = genesisAvatarAssetPath('mage', 'male');
  assert.notEqual(oldPath, newPath);
  assert.match(newPath, /genesis_mage_male\.png$/);

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  let fallback;
  try {
    fallback = await loadAvatarAsset(
      async () => { throw new Error('storage detail must stay private'); },
      [{ path: newPath, avatarSource: 'equipped-avatar' }]
    );
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(fallback, null);
  assert.deepEqual(warnings, [`[avatar] missing asset: ${newPath}`]);
  assert.equal(warnings[0].includes('storage detail'), false);

  const sigA = signature(['profile', 'user-a', 'Fighter']);
  const sigB = signature(['profile', 'user-b', 'Knight']);
  setProfileImageCache('user-a', sigA, 'https://example.invalid/a.webp');
  setProfileImageCache('user-b', sigB, 'https://example.invalid/b.webp');
  const before = getProfileImageCacheStats().entries;
  genesisAvatarAssetPath('mage', 'male');
  assert.equal(getProfileImageCacheStats().entries, before);
  assert.equal(getProfileImageCache('user-b', sigB), 'https://example.invalid/b.webp');

  const changeSource = fs.readFileSync(path.join(__dirname, '..', 'src/commands/rpg/changeClass.js'), 'utf8');
  assert.equal(/cache\.clear\s*\(|clearAll|flushAll/i.test(changeSource), false);
  assert(changeSource.includes("UPDATE user_character SET class = $2"));

  const grantSource = fs.readFileSync(
    path.join(__dirname, 'migrations', '20260721_11_genesis_dev_avatar_grants.sql'),
    'utf8',
  );
  assert.match(grantSource, /CROSS JOIN public\.avatar_catalog ac/);
  assert.match(grantSource, /lower\(ac\.style\) = 'genesis'/);
  assert.match(grantSource, /ON CONFLICT \(discord_id, avatar_id\) DO NOTHING/);
  assert.doesNotMatch(
    grantSource,
    /genesis_dev_grant_targets/,
    'dev grants must not depend on a statement-scoped CTE or temp relation',
  );
  assert.match(
    grantSource,
    /INSERT INTO public\.user_avatars[\s\S]*?FROM \(VALUES[\s\S]*?'980773258238492762'::text[\s\S]*?'1508745825315196979'::text[\s\S]*?\) AS t\(discord_id\)[\s\S]*?CROSS JOIN public\.avatar_catalog ac/,
    'the grant INSERT must carry both dev ids directly',
  );
  assert.doesNotMatch(grantSource, /UPDATE public\.avatar_catalog/i);

  const avatarSource = fs.readFileSync(path.join(__dirname, '..', 'src/engine/avatarSystem.js'), 'utf8');
  const avatarCommandSource = fs.readFileSync(path.join(__dirname, '..', 'src/commands/rpg/avatar.js'), 'utf8');
  const statsCommandSource = fs.readFileSync(path.join(__dirname, '..', 'src/commands/rpg/stats.js'), 'utf8');
  assert.match(avatarSource, /AND lower\(class_name\) = lower\(\$1\)/);
  assert.match(avatarSource, /strpos\(avatar_key, '_'\)[\s\S]+substring\(avatar_key FROM strpos\(avatar_key, '_'\) \+ 1\)/);
  assert.match(avatarSource, /lower\(style\) NOT IN \('founder', 'tester'\)/);
  assert.match(avatarCommandSource, /row\.class_name[\s\S]+character\.class/);
  assert.match(
    statsCommandSource,
    /data\.avatarAssetAvailable\s*=\s*await remoteAssetAvailable/,
    'stats must include the advisory avatar availability result in its canvas cache input',
  );
  assert.doesNotMatch(
    statsCommandSource,
    /data\.avatarPath\s*=\s*null/,
    'a failed HEAD probe must not erase the equipped path before the renderer attempts GET',
  );
  assert.match(
    statsCommandSource,
    /const STATS_RENDER_REV = 29;/,
    'stats cache must be busted after equipped-avatar, class-icon, and deity display changes',
  );

  const equippedGenesisDb = {
    async query(sql) {
      if (sql.includes('FROM equipped_avatars')) {
        return {
          rows: [{
            avatar_id: 9001,
            avatar_key: 'swordsman_gm',
            asset_path: 'skins/avatars/genesis/male/genesis_swordsman_male.png',
            class_name: 'Swordsman',
            gender: 'male',
            style: 'genesis',
          }],
        };
      }
      throw new Error(`Unexpected equipped-avatar query: ${sql}`);
    },
  };
  const resolvedGenesis = await resolveStatsAvatar(equippedGenesisDb, 'avatar-user', 'Swordsman');
  assert.equal(
    relativeAssetPath(resolvedGenesis),
    'skins/avatars/genesis/male/genesis_swordsman_male.png',
    'stats must resolve the equipped Genesis avatar instead of the class default',
  );

  const avatarDb = {
    async query(sql) {
      if (sql.includes('SELECT class FROM user_character')) {
        return { rows: [{ class: 'Fighter' }] };
      }
      if (sql.includes('FROM avatar_catalog') && sql.includes('WHERE is_active = TRUE')) {
        return { rows: [] };
      }
      if (sql.includes('FROM user_avatars') || sql.includes('FROM equipped_avatars')) {
        return { rows: [] };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  const avatarPayload = await buildAvatarPage(avatarDb, 'avatar-user', {
    page: 0,
    mode: 'collection',
  });
  const avatarButtons = avatarPayload.components[1].toJSON().components;
  const avatarButtonIds = avatarButtons.map((button) => button.custom_id);
  assert.equal(new Set(avatarButtonIds).size, avatarButtonIds.length);
  assert.match(avatarButtonIds[0], /:0:prev$/);
  assert.match(avatarButtonIds[1], /:0:next$/);
  assert(avatarButtons.every((button) => button.disabled));

  function catalogRows(total) {
    const styles = ['cyber', 'anime', 'webtoon', 'genesis'];
    return Array.from({ length: total }, (_, index) => ({
      avatar_id: index + 1,
      avatar_key: `fighter_avatar_${index + 1}`,
      display_name: `Avatar ${String(index + 1).padStart(2, '0')}`,
      class_name: 'Fighter',
      gender: index % 2 ? 'female' : 'male',
      style: styles[index % styles.length],
      token_cost: 9,
      asset_path: `missing/avatar_${index + 1}.png`,
    }));
  }

  function shopDb(total, balance = 1_000) {
    const rows = catalogRows(total);
    return {
      async query(sql) {
        if (sql.includes('SELECT class FROM user_character')) return { rows: [{ class: 'Fighter' }] };
        if (sql.includes('FROM avatar_catalog') && sql.includes('token_cost > 0')) return { rows };
        if (sql.includes('FROM user_avatars') || sql.includes('FROM equipped_avatars')) return { rows: [] };
        if (sql.includes('FROM supporters')) return { rows: [{ token_balance: balance }] };
        return { rows: [], rowCount: 0 };
      },
    };
  }

  const publicShop = await buildAvatarPage(shopDb(12), 'shop-user', { page: 0, mode: 'shop' });
  const publicJson = publicShop.components[0].toJSON();
  const publicText = publicJson.components
    .filter((component) => component.type === 10)
    .map((component) => component.content)
    .join('\n');
  const publicBody = publicJson.components
    .filter((component) => component.type === 10)
    .sort((a, b) => b.content.split('\n').length - a.content.split('\n').length)[0];
  assert(publicBody);
  assert.equal(publicBody.content.split('\n').length, 10);
  assert(publicText.includes('Page **1/2**'));
  assert(publicText.includes('Tokens: **1000**'));
  const publicControls = publicShop.components[1].toJSON().components;
  assert.deepEqual(publicControls.map((button) => button.label), ['Previous', 'Next', 'Preview']);
  assert.match(publicControls[2].custom_id, /:0:preview$/);

  const emptyPreview = await buildAvatarPreview(shopDb(0), 'shop-user');
  assert.equal(emptyPreview.components.length, 1);
  assert.equal(
    emptyPreview.components[0].toJSON().components.some((component) => component.type === 1),
    false
  );

  const singlePreview = await buildAvatarPreview(shopDb(1), 'shop-user');
  const singleButtons = singlePreview.components[0].toJSON().components
    .find((component) => component.type === 1).components;
  assert(singleButtons[0].disabled && singleButtons[1].disabled);
  assert.match(singleButtons[0].custom_id, /:0$/);
  assert.match(singleButtons[1].custom_id, /:0$/);
  assert.equal(singleButtons[4].label, 'Buy Token · 30');
  assert.equal(singleButtons[4].disabled, false);

  const pairFirst = await buildAvatarPreview(shopDb(2), 'shop-user', { page: 0 });
  const pairFirstButtons = pairFirst.components[0].toJSON().components
    .find((component) => component.type === 1).components;
  assert.match(pairFirstButtons[0].custom_id, /:1$/);
  assert.match(pairFirstButtons[1].custom_id, /:1$/);
  const pairSecond = await buildAvatarPreview(shopDb(2), 'shop-user', { page: 1 });
  const pairSecondButtons = pairSecond.components[0].toJSON().components
    .find((component) => component.type === 1).components;
  assert.match(pairSecondButtons[0].custom_id, /:0$/);
  assert.match(pairSecondButtons[1].custom_id, /:0$/);

  const fullPreview = await buildAvatarPreview(shopDb(12), 'shop-user', { page: 0 });
  const fullButtons = fullPreview.components[0].toJSON().components
    .find((component) => component.type === 1).components;
  assert.match(fullButtons[0].custom_id, /:11$/);
  assert.match(fullButtons[1].custom_id, /:1$/);

  const unaffordable = await buildAvatarPreview(shopDb(1, 0), 'shop-user');
  const unaffordableButtons = unaffordable.components[0].toJSON().components
    .find((component) => component.type === 1).components;
  assert.equal(unaffordableButtons[3].label, '9 tokens');
  assert.equal(unaffordableButtons[3].disabled, true);
  assert.equal(unaffordableButtons[4].disabled, true);

  const exactTokenBalance = await buildAvatarPreview(shopDb(1, 30), 'shop-user');
  const exactTokenButtons = exactTokenBalance.components[0].toJSON().components
    .find((component) => component.type === 1).components;
  assert.equal(exactTokenButtons[4].label, 'Buy Token · 30');
  assert.equal(exactTokenButtons[4].disabled, false);

  const shortTokenBalance = await buildAvatarPreview(shopDb(1, 29), 'shop-user');
  const shortTokenButtons = shortTokenBalance.components[0].toJSON().components
    .find((component) => component.type === 1).components;
  assert.equal(shortTokenButtons[4].label, 'Buy Token · 30');
  assert.equal(shortTokenButtons[4].disabled, true);
  assert.match(customAvatarTokenPurchaseMessage(0), /for 30 supporter tokens\. Balance: \*\*0\*\*/);

  function customTokenPurchaseClient(startingBalance) {
    const state = {
      balance: startingBalance,
      itemBalance: 0,
      ledger: [],
      charged: 0,
      committed: false,
      rolledBack: false,
      released: false,
    };
    return {
      state,
      client: {
        async query(sql, params = []) {
          const statement = String(sql).trim();
          if (statement === 'BEGIN') return { rows: [], rowCount: 0 };
          if (statement === 'COMMIT') {
            state.committed = true;
            return { rows: [], rowCount: 0 };
          }
          if (statement === 'ROLLBACK') {
            state.rolledBack = true;
            return { rows: [], rowCount: 0 };
          }
          if (statement.startsWith('SELECT token_balance FROM supporters')) {
            return { rows: [{ token_balance: state.balance }], rowCount: 1 };
          }
          if (statement.startsWith('INSERT INTO supporter_token_ledger')) {
            state.ledger.push(params);
            return { rows: [], rowCount: 1 };
          }
          if (statement.startsWith('UPDATE supporters SET token_balance = token_balance -')) {
            state.charged = Number(params[1]);
            state.balance -= state.charged;
            return { rows: [{ token_balance: state.balance }], rowCount: 1 };
          }
          if (statement.startsWith('INSERT INTO users_bag AS bag')) {
            state.itemBalance += Number(params[1]);
            return { rows: [{ custom_avatar_token: state.itemBalance }], rowCount: 1 };
          }
          throw new Error(`Unexpected custom-token purchase query: ${statement}`);
        },
        release() {
          state.released = true;
        },
      },
    };
  }

  const exactPurchase = customTokenPurchaseClient(30);
  const shortPurchase = customTokenPurchaseClient(29);
  const purchaseClients = [exactPurchase.client, shortPurchase.client];
  const originalPoolConnect = avatarPool.connect;
  avatarPool.connect = async () => purchaseClients.shift();
  try {
    const bought = await purchaseCustomAvatarToken('custom-avatar-buyer');
    assert.deepEqual(bought, { status: 'bought', balance: 0, itemBalance: 1 });
    assert.equal(exactPurchase.state.charged, 30);
    assert.deepEqual(
      exactPurchase.state.ledger[0],
      ['custom-avatar-buyer', -30, 'custom_avatar_token_shop', 'custom_avatar_token'],
    );
    assert.equal(exactPurchase.state.committed, true);
    assert.equal(exactPurchase.state.itemBalance, 1);
    assert.equal(exactPurchase.state.released, true);

    const insufficient = await purchaseCustomAvatarToken('short-custom-avatar-buyer');
    assert.deepEqual(insufficient, { status: 'insufficient', balance: 29 });
    assert.equal(shortPurchase.state.ledger.length, 0);
    assert.equal(shortPurchase.state.itemBalance, 0);
    assert.equal(shortPurchase.state.rolledBack, true);
    assert.equal(shortPurchase.state.released, true);
  } finally {
    avatarPool.connect = originalPoolConnect;
  }

  console.log('GENESIS AVATAR SELFTEST: passed');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
