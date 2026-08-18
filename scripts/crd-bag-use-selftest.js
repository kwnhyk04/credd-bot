'use strict';

const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const { CRD_BAG_ITEMS, resolveBagItem } = require('../src/config/crdBagItems');
const {
  CHESTS,
  BAG_ITEMS,
  BAG_ITEMS_EMOJI,
  buildBagOverview,
  buildChestsView,
  buildItemsView,
  getChestCounts,
} = require('../src/engine/bagViews');
const { CHEST_COLUMNS: DEV_CHEST_COLUMNS } = require('../src/commands/rpg/dev');
const {
  fetchWeapons,
  fetchArmors,
  buildWeaponsPage,
  buildArmorsPage,
  GEAR_TIER_STRENGTH,
} = require('../src/commands/rpg/bag');
const { useItem } = require('../src/commands/rpg/use');
const { emoji, emojiForDisplay, gearTierEmoji } = require('../src/utils/emojis');
const { playAnimatedOpen, buildWeaponResultPayload } = require('../src/engine/chestOpen');

function fakeMessage(id = 'bag-user') {
  const replies = [];
  return {
    message: {
      author: { id },
      async reply(payload) { replies.push(payload); return payload; },
    },
    replies,
  };
}

function installModuleStub(filename, exports) {
  const previous = require.cache[filename];
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
  return () => {
    if (previous) require.cache[filename] = previous;
    else delete require.cache[filename];
  };
}

async function main() {
  assert.match(emoji('diamond_open'), /^<a:diamond_open:\d+>$/);
  assert.match(emoji('divine_open'), /^<a:divine_open:\d+>$/);
  assert.match(emojiForDisplay('Kiri', 'Weapon'), /^<:kiri:\d+>$/);
  assert.equal(
    gearTierEmoji('Divine'),
    emoji('eqdivine_icon'),
    'Divine weapon displays must resolve the tier emoji through game_items.txt',
  );

  const revealCalls = [];
  let editPayload = null;
  const revealMessage = {
    async reply(payload) {
      revealCalls.push(payload);
      if (revealCalls.length === 1) {
        return {
          async edit(nextPayload) {
            editPayload = nextPayload;
            throw new Error('simulated stale animation message');
          },
        };
      }
      return { payload };
    },
  };
  await playAnimatedOpen(revealMessage, {
    gifKey: 'diamond_chest',
    animTitle: 'Opening 1 × Diamond Chest…',
    buildResult: () => buildWeaponResultPayload({
      gifKey: 'diamond_chest',
      title: 'Opened 1 × Diamond Chest',
      items: [{ id: 'drop1', gearClass: 'weapon', name: 'Kiri', tier: 'Divine', sockets: 3 }],
      sacredRelics: 1,
      supremeRelics: 2,
      remaining: 0,
      chestLabel: 'Diamond Chest',
      chestEmojiName: 'diamond_chest',
    }),
  });
  const openingJson = JSON.stringify(revealCalls[0].components.map((component) => component.toJSON()));
  assert.match(openingJson, /<a:diamond_open:\d+>/);
  assert.equal(Object.hasOwn(editPayload, 'flags'), false, 'CV2 edit must retain, not re-send, the immutable flag');
  assert.equal(revealCalls.length, 2, 'failed result edit must fall back to a fresh result reply');
  assert.equal(revealCalls[1].flags, 32768, 'fresh fallback result must set IsComponentsV2');
  const resultJson = JSON.stringify(revealCalls[1].components.map((component) => component.toJSON()));
  assert.match(resultJson, /Opened 1 × Diamond Chest/);
  assert.match(resultJson, /Kiri/);

  assert.deepEqual(
    GEAR_TIER_STRENGTH,
    ['Divine', 'Supreme', 'Legendary', 'Mythic', 'Rare', 'Common'],
  );
  const inventoryUser = { id: 'bag-user' };
  const weaponPayload = buildWeaponsPage({
    user: inventoryUser,
    total: 1,
    page: 0,
    weapons: [{
      weapon_id: 'weapon1', name: 'Kiri', tier: 'Divine', type: 'Sword',
      enhancement: 11, is_locked: false, equipped: false, curr_atk: 3200,
      crit: 20, socket_count: 2,
    }],
  });
  const weaponJson = JSON.stringify(weaponPayload.components.map((component) => component.toJSON()));
  assert(weaponJson.includes(
    `\`weapon1\` ${emojiForDisplay('Kiri', 'Weapon')} **Kiri** +10\\n-# ${gearTierEmoji('Divine')} Divine`
  ));
  assert(!weaponJson.includes(`\`weapon1\` ${gearTierEmoji('Divine')}`));

  const armorPayload = buildArmorsPage({
    user: inventoryUser,
    total: 1,
    page: 0,
    armors: [{
      armor_id: 'armor1', name: 'Mail of Brokkr', tier: 'Supreme', type: 'Heavy',
      enhancement: 6, is_locked: false, equipped: false, curr_hp: 20000,
      curr_def: 1200, socket_count: 2,
    }],
  });
  const armorJson = JSON.stringify(armorPayload.components.map((component) => component.toJSON()));
  assert(armorJson.includes(
    `\`armor1\` ${emojiForDisplay('Mail of Brokkr', 'Armor')} **Mail of Brokkr** +5\\n-# ${gearTierEmoji('Supreme')} Supreme`
  ));
  assert(!armorJson.includes(`\`armor1\` ${gearTierEmoji('Supreme')}`));

  const tierQueries = [];
  const originalTierQuery = pool.query;
  pool.query = async (sql) => {
    tierQueries.push(sql);
    if (sql.includes('SELECT count(*)::int AS total')) return { rows: [{ total: 0 }] };
    return { rows: [] };
  };
  try {
    await fetchWeapons('bag-user', 0);
    await fetchArmors('bag-user', 0);
  } finally {
    pool.query = originalTierQuery;
  }
  const weaponOrderQuery = tierQueries.find((sql) => sql.includes('JOIN weapon_roster wr'));
  const armorOrderQuery = tierQueries.find((sql) => sql.includes('JOIN armor_roster ar'));
  for (const [sql, alias, inventoryAlias] of [
    [weaponOrderQuery, 'wr', 'uw'],
    [armorOrderQuery, 'ar', 'ua'],
  ]) {
    assert(sql, `${alias} inventory query must be captured`);
    let priorPosition = -1;
    GEAR_TIER_STRENGTH.forEach((tier, index) => {
      const rank = GEAR_TIER_STRENGTH.length - index;
      const position = sql.indexOf(`WHEN '${tier}' THEN ${rank}`);
      assert(position > priorPosition, `${alias} must order ${tier} at strength rank ${rank}`);
      priorPosition = position;
    });
    assert.match(
      sql,
      new RegExp(`ORDER BY CASE ${alias}\\.tier[\\s\\S]*?END DESC, ${inventoryAlias}\\.enhancement DESC`),
    );
  }

  const bagItemsIcon = emoji(BAG_ITEMS_EMOJI);
  assert.match(bagItemsIcon, /^<:bag_items:\d+>$/);
  const overviewPayload = await buildBagOverview(
    { id: 'bag-user' },
    { credux: 1, beliefShards: 2 },
  );
  const overviewJson = JSON.stringify(overviewPayload.components.map((component) => component.toJSON()));
  assert(overviewJson.includes(`${bagItemsIcon} **Bag Items**`));
  assert(overviewJson.includes('`crd bag items`'));

  const itemsPayload = await buildItemsView(
    { id: 'bag-user' },
    { cc: 1, sacred: 2, supreme: 3, at: 4, dt: 5 },
  );
  const itemsJson = JSON.stringify(itemsPayload.components.map((component) => component.toJSON()));
  assert(itemsJson.includes(`## ${bagItemsIcon} <@bag-user>'s Bag Items`));
  for (const item of BAG_ITEMS) {
    assert(
      itemsJson.includes(`\`${item.code}\` ${emoji(item.emojiName)}`),
      `${item.code} must be inline code before its item emoji`,
    );
  }
  const zeroItemsPayload = await buildItemsView(
    { id: 'bag-user' },
    { cc: 1, sacred: 0, supreme: 0, at: 0, dt: 0 },
  );
  const zeroItemsJson = JSON.stringify(zeroItemsPayload.components.map((component) => component.toJSON()));
  assert(zeroItemsJson.includes('`cc`'));
  for (const id of ['sr', 'supr', 'at', 'dt']) assert.equal(zeroItemsJson.includes(`\`${id}\``), false);
  assert.equal(itemsJson.includes('chests:id:'), false);

  const chestPayload = await buildChestsView(
    { id: 'bag-user' },
    { sc: 1, gc: 2, dmc: 3, supc: 4, gnc: 5, btc: 6, bgtc: 7 },
  );
  const chestComponents = chestPayload.components[0].toJSON().components;
  const chestRowCodes = chestComponents
    .map((component) => /^`([^`]+)` /.exec(component.content || '')?.[1])
    .filter(Boolean);
  assert.deepEqual(chestRowCodes, ['sc', 'gc', 'dmc', 'supc', 'gnc', 'btc', 'bgtc']);
  const rowIndex = (code) => chestComponents.findIndex(
    (component) => component.content?.startsWith(`\`${code}\` `),
  );
  assert.equal(chestComponents[rowIndex('gnc') + 1].type, 14);
  assert.equal(rowIndex('btc'), rowIndex('gnc') + 2);
  assert.equal(rowIndex('bgtc'), rowIndex('btc') + 1);
  const chestJson = JSON.stringify(chestPayload.components.map((component) => component.toJSON()));
  assert.equal(chestJson.includes('chests:id:'), false);
  assert(chestJson.includes('chests:rates:bag-user'));

  assert.deepEqual(CRD_BAG_ITEMS.map((item) => item.id), ['cc', 'sr', 'supr', 'at', 'dt']);
  assert.deepEqual(BAG_ITEMS.map((item) => item.code), ['cc', 'sr', 'supr', 'at', 'dt']);
  assert.equal(CHESTS.some((item) => item.code === 'sr' || item.code === 'supr'), false);
  assert(CHESTS.some((item) => item.code === 'dmc'));
  assert(CHESTS.some((item) => item.code === 'gnc'));
  assert.equal(DEV_CHEST_COLUMNS.divine, 'genesis_chest');
  assert.equal(DEV_CHEST_COLUMNS.gnc, 'genesis_chest');
  assert.equal(resolveBagItem(' SR ').id, 'sr');
  assert.equal(resolveBagItem('1'), null);
  assert.equal(resolveBagItem('gc'), null);

  const originalQuery = pool.query;
  pool.query = async () => ({ rows: [{
    silver_chest: 1,
    gold_chest: 2,
    boss_treasure_chest: 3,
    boss_golden_chest: 4,
    supreme_chest: 5,
    diamond_chest: 6,
    genesis_chest: 7,
      sacred_relics: 8,
      supreme_relics: 9,
      change_class: 10,
      custom_avatar_token: 11,
      custom_deity_token: 12,
    }] });
  try {
    assert.deepEqual(await getChestCounts('bag-user'), {
      sc: 1, gc: 2, btc: 3, bgtc: 4, supc: 5, dmc: 6, gnc: 7,
      sacred: 8, supreme: 9, cc: 10, at: 11, dt: 12,
    });
  } finally {
    pool.query = originalQuery;
  }

  const openPath = require.resolve('../src/commands/rpg/open');
  const changePath = require.resolve('../src/commands/rpg/changeClass');
  const inventory = { sr: 1, supr: 1 };
  const effects = [];
  let failRelic = false;
  let gate = Promise.resolve();
  const restoreOpen = installModuleStub(openPath, {
    async openRelic(message, id) {
      const prior = gate;
      let release;
      gate = new Promise((resolve) => { release = resolve; });
      await prior;
      try {
        if (inventory[id] < 1) return message.reply({ content: 'not owned' });
        if (failRelic) throw new Error('effect failed');
        effects.push(id);
        inventory[id]--;
        return message.reply({ content: `used ${id}` });
      } finally {
        release();
      }
    },
  });
  let classStarts = 0;
  let failClass = false;
  const restoreChange = installModuleStub(changePath, {
    async start(message) {
      classStarts++;
      if (failClass) throw new Error('class flow failed');
      return message.reply({ content: 'class flow started' });
    },
  });

  let ccOwned = 1;
  let dbQueries = 0;
  pool.query = async () => {
    dbQueries++;
    return { rows: [{ change_class: ccOwned }] };
  };
  try {
    const sacred = fakeMessage();
    await useItem(sacred.message, ['sr']);
    assert.equal(inventory.sr, 0);
    assert.deepEqual(effects, ['sr']);

    const supreme = fakeMessage();
    await useItem(supreme.message, ['supr']);
    assert.equal(inventory.supr, 0);
    assert.deepEqual(effects, ['sr', 'supr']);

    inventory.sr = 1;
    failRelic = true;
    await assert.rejects(useItem(fakeMessage().message, ['sr']), /effect failed/);
    assert.equal(inventory.sr, 1);
    failRelic = false;

    inventory.sr = 1;
    const concurrentA = fakeMessage();
    const concurrentB = fakeMessage();
    await Promise.all([useItem(concurrentA.message, ['sr']), useItem(concurrentB.message, ['sr'])]);
    assert.equal(inventory.sr, 0);
    assert.equal([concurrentA, concurrentB].filter((entry) => entry.replies[0].content === 'used sr').length, 1);

    const classChange = fakeMessage();
    await useItem(classChange.message, ['cc']);
    assert.equal(classStarts, 1);
    assert.equal(ccOwned, 1);

    failClass = true;
    await assert.rejects(useItem(fakeMessage().message, ['cc']), /class flow failed/);
    assert.equal(ccOwned, 1);
    failClass = false;

    ccOwned = 0;
    const missing = fakeMessage();
    await useItem(missing.message, ['cc']);
    assert.match(missing.replies[0].content, /don't own/);

    const beforeRejectQueries = dbQueries;
    for (const [id, pattern] of [
      ['1', /Shop product id/],
      ['gc', /is a chest/],
      ['db', /is a rune bag/],
      ['mystery', /Unknown item id/],
    ]) {
      const rejected = fakeMessage();
      await useItem(rejected.message, [id]);
      assert.match(rejected.replies[0].content, pattern);
    }
    assert.equal(dbQueries, beforeRejectQueries);

    const otherCategory = new Map([['cc', { category: 'chest' }]]);
    assert(otherCategory.has('cc'));
    assert.equal(resolveBagItem('cc').use, 'classChange');
  } finally {
    pool.query = originalQuery;
    restoreOpen();
    restoreChange();
  }

  console.log('CRD BAG AND USE SELFTEST: passed');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
