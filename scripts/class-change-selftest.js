'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const pool = require('../src/db/pool');

const supporterPath = require.resolve('../src/engine/supporterTokens');
const previousSupporterModule = require.cache[supporterPath];
require.cache[supporterPath] = {
  id: supporterPath,
  filename: supporterPath,
  loaded: true,
  exports: {
    async grantTokensTx(client, discordId, amount, reason, reference) {
      client.__grantTokens(discordId, amount, reason, reference);
      return { balance: client.__supporterBalance() };
    },
  },
};

const changeClass = require('../src/commands/rpg/changeClass');

function cloneState(state) {
  return {
    bag: { ...state.bag },
    character: { ...state.character },
    ownedAvatars: state.ownedAvatars.map((row) => ({ ...row })),
    avatarCatalog: state.avatarCatalog.map((row) => ({ ...row })),
    equippedAvatar: state.equippedAvatar,
    hasSupporter: state.hasSupporter,
    supporterTokens: state.supporterTokens,
    refunds: state.refunds.map((row) => ({ ...row })),
    cosmeticCatalog: state.cosmeticCatalog.map((row) => ({ ...row })),
    ownedCosmetics: new Set(state.ownedCosmetics),
    equippedBattle: state.equippedBattle,
    logs: state.logs.map((row) => ({ ...row })),
  };
}

function baseState() {
  return {
    bag: { change_class: 1, credux: 123, gold_chest: 7 },
    character: {
      class: 'Fighter', combat_level: 42, combat_exp: 12345,
      believer_level: 18, believer_exp: 999, equipped_weapon_id: 'w1',
      equipped_armor_id: 'a1', gender: 'male', pvp_rating: 7777,
    },
    ownedAvatars: [
      { avatar_id: 1, avatar_key: 'fighter_gm', class_name: 'Fighter', style: 'genesis', gender: 'male', token_cost: 15 },
      { avatar_id: 2, avatar_key: 'fighter_founder', class_name: 'Fighter', style: 'founder', gender: 'avatar', token_cost: 0 },
    ],
    avatarCatalog: [
      { avatar_id: 3, avatar_key: 'mage_founder', class_name: 'Mage', style: 'founder', gender: 'avatar', token_cost: 0, is_active: true },
    ],
    equippedAvatar: 1,
    hasSupporter: true,
    supporterTokens: 4,
    refunds: [],
    cosmeticCatalog: [
      { cosmetic_id: 10, cosmetic_key: 'class_battle_fighter', is_active: true },
      { cosmetic_id: 11, cosmetic_key: 'class_battle_mage', is_active: true },
    ],
    ownedCosmetics: new Set([10, 99]),
    equippedBattle: 10,
    logs: [],
  };
}

function installFakePool(shared, { failOn = null } = {}) {
  let locked = false;
  const waiters = [];
  const stats = { connects: 0, commits: 0, rollbacks: 0 };

  async function acquire() {
    if (locked) await new Promise((resolve) => waiters.push(resolve));
    locked = true;
  }

  function releaseLock() {
    locked = false;
    const next = waiters.shift();
    if (next) next();
  }

  pool.connect = async () => {
    stats.connects++;
    let tx = null;
    let ownsLock = false;
    const client = {
      release() {
        if (ownsLock) { ownsLock = false; releaseLock(); }
      },
      __grantTokens(discordId, amount, reason, reference) {
        tx.supporterTokens += Number(amount);
        tx.refunds.push({ discordId, amount: Number(amount), reason, reference });
      },
      __supporterBalance() { return tx.supporterTokens; },
      async query(sql, params = []) {
        if (failOn && sql.includes(failOn)) throw new Error('configured dependent failure');
        if (sql === 'BEGIN') return { rows: [] };
        if (sql === 'COMMIT') {
          Object.assign(shared, cloneState(tx));
          stats.commits++;
          if (ownsLock) { ownsLock = false; releaseLock(); }
          return { rows: [] };
        }
        if (sql === 'ROLLBACK') {
          stats.rollbacks++;
          if (ownsLock) { ownsLock = false; releaseLock(); }
          return { rows: [] };
        }
        if (sql.includes('SELECT change_class FROM users_bag')) {
          await acquire();
          ownsLock = true;
          tx = cloneState(shared);
          return { rows: [{ change_class: tx.bag.change_class }] };
        }
        if (sql.includes('SELECT class FROM user_character')) return { rows: [{ class: tx.character.class }] };
        if (sql.startsWith('UPDATE user_character SET class')) {
          tx.character.class = params[1];
          return { rows: [] };
        }
        if (sql.includes('SELECT avatar_id FROM equipped_avatars')) {
          return { rows: tx.equippedAvatar == null ? [] : [{ avatar_id: tx.equippedAvatar }] };
        }
        if (sql.includes('FROM user_avatars ua') && sql.includes('ac.token_cost')) {
          return { rows: tx.ownedAvatars.filter((row) => row.class_name.toLowerCase() === String(params[1]).toLowerCase()).map((row) => ({ ...row })) };
        }
        if (sql.includes('SELECT 1 FROM supporters')) return { rows: tx.hasSupporter ? [{ '?column?': 1 }] : [] };
        if (sql.includes('SELECT avatar_id FROM avatar_catalog')) {
          const row = tx.avatarCatalog.find((entry) => entry.style === params[0] && entry.class_name.toLowerCase() === String(params[1]).toLowerCase() && entry.is_active);
          return { rows: row ? [{ avatar_id: row.avatar_id }] : [] };
        }
        if (sql.startsWith('DELETE FROM user_avatars')) {
          tx.ownedAvatars = tx.ownedAvatars.filter((row) => String(row.avatar_id) !== String(params[1]));
          return { rows: [] };
        }
        if (sql.includes('INSERT INTO user_avatars')) {
          const row = tx.avatarCatalog.find((entry) => String(entry.avatar_id) === String(params[1]));
          if (row && !tx.ownedAvatars.some((entry) => String(entry.avatar_id) === String(row.avatar_id))) tx.ownedAvatars.push({ ...row });
          return { rows: [] };
        }
        if (sql.includes('INSERT INTO equipped_avatars')) {
          tx.equippedAvatar = params[1];
          return { rows: [] };
        }
        if (sql.startsWith('DELETE FROM equipped_avatars')) {
          tx.equippedAvatar = null;
          return { rows: [] };
        }
        if (sql.includes('SELECT cosmetic_key, cosmetic_id FROM cosmetic_catalog')) {
          return { rows: tx.cosmeticCatalog.filter((row) => params.includes(row.cosmetic_key)).map((row) => ({ ...row })) };
        }
        if (sql.includes('INSERT INTO user_cosmetics')) {
          tx.ownedCosmetics.add(params[1]);
          return { rows: [] };
        }
        if (sql.startsWith('UPDATE equipped_skins')) {
          if (String(tx.equippedBattle) === String(params[1])) tx.equippedBattle = params[2];
          return { rows: [] };
        }
        if (sql.startsWith('DELETE FROM user_cosmetics')) {
          tx.ownedCosmetics.delete(params[1]);
          return { rows: [] };
        }
        if (sql.startsWith('UPDATE users_bag SET change_class')) {
          if (tx.bag.change_class < 1) return { rows: [] };
          tx.bag.change_class--;
          return { rows: [{ change_class: tx.bag.change_class }] };
        }
        if (sql.includes('INSERT INTO game_logs')) {
          tx.logs.push({ action: 'Class Change', previous: params[1], current: params[2] });
          return { rows: [] };
        }
        throw new Error(`Unexpected class-change query: ${sql}`);
      },
    };
    return client;
  };

  return stats;
}

function fakeInteraction(userId = 'class-user') {
  const calls = { reply: [], edit: [], follow: [], deferred: 0 };
  return {
    interaction: {
      user: { id: userId },
      async deferUpdate() { calls.deferred++; },
      async reply(payload) { calls.reply.push(payload); },
      async editReply(payload) { calls.edit.push(payload); },
      async followUp(payload) { calls.follow.push(payload); },
    },
    calls,
  };
}

async function main() {
  const root = path.join(__dirname, '..');
  const changeSource = fs.readFileSync(path.join(root, 'src/commands/rpg/changeClass.js'), 'utf8');
  const createSource = fs.readFileSync(path.join(root, 'src/commands/rpg/create.js'), 'utf8');
  assert(changeSource.includes("'change-class-preview-card'"));
  assert(changeSource.includes('chgclass:'));
  assert(changeSource.includes('const CHANGE_BRAND'));
  assert.equal(changeSource.includes("require('./create')"), false);
  assert(createSource.includes('create:class:'));

  const firstPayload = changeClass.changeClassSelectPayload('class-user', 'Fighter');
  const secondPayload = changeClass.changeClassSelectPayload('class-user', 'Fighter');
  assert.notEqual(firstPayload.components[0], secondPayload.components[0]);
  firstPayload.components[0].setAccentColor(0x000000);
  assert.notEqual(firstPayload.components[0].toJSON().accent_color, secondPayload.components[0].toJSON().accent_color);
  assert.match(JSON.stringify(secondPayload.components.map((item) => item.toJSON())), /Change Character/);
  const buttons = secondPayload.components[1].toJSON().components;
  assert.equal(buttons.find((button) => button.label === 'Fighter').disabled, true);

  const originalConnect = pool.connect;
  try {
    const state = baseState();
    const originalCharacter = { ...state.character };
    const stats = installFakePool(state);
    const success = fakeInteraction();
    await changeClass.handleConfirm(success.interaction, 'Mage', 'class-user');
    assert.equal(stats.commits, 1);
    assert.equal(state.bag.change_class, 0);
    assert.equal(state.character.class, 'Mage');
    assert.deepEqual({ ...state.character, class: originalCharacter.class }, originalCharacter);
    assert.equal(state.bag.credux, 123);
    assert.equal(state.bag.gold_chest, 7);
    assert.equal(state.supporterTokens, 19);
    assert.deepEqual(state.refunds.map((row) => [row.amount, row.reason]), [[15, 'avatar_refund']]);
    assert.equal(state.ownedAvatars.some((row) => row.avatar_id === 1), false);
    assert.equal(state.ownedAvatars.some((row) => row.avatar_id === 3), true);
    assert.equal(state.equippedAvatar, null);
    assert.equal(state.ownedCosmetics.has(10), false);
    assert.equal(state.ownedCosmetics.has(11), true);
    assert.equal(state.ownedCosmetics.has(99), true);
    assert.equal(state.equippedBattle, 11);
    assert.equal(state.logs.length, 1);

    const cancelState = baseState();
    const cancelStats = installFakePool(cancelState);
    const cancelled = fakeInteraction();
    await changeClass.handleCancel(cancelled.interaction, 'class-user');
    assert.equal(cancelStats.connects, 0);
    assert.equal(cancelState.bag.change_class, 1);

    const timeoutState = baseState();
    installFakePool(timeoutState);
    await Promise.resolve();
    assert.equal(timeoutState.bag.change_class, 1);
    assert.equal(timeoutState.character.class, 'Fighter');

    const invalidState = baseState();
    const invalidStats = installFakePool(invalidState);
    await changeClass.handleConfirm(fakeInteraction().interaction, 'NotAClass', 'class-user');
    assert.equal(invalidStats.connects, 0);
    assert.equal(invalidState.bag.change_class, 1);

    const currentState = baseState();
    const currentStats = installFakePool(currentState);
    await changeClass.handleConfirm(fakeInteraction().interaction, 'Fighter', 'class-user');
    assert.equal(currentStats.commits, 0);
    assert.equal(currentStats.rollbacks, 1);
    assert.equal(currentState.bag.change_class, 1);

    const failureState = baseState();
    const failureStats = installFakePool(failureState, { failOn: 'UPDATE user_character SET class' });
    const originalError = console.error;
    console.error = () => {};
    try {
      await changeClass.handleConfirm(fakeInteraction().interaction, 'Mage', 'class-user');
    } finally {
      console.error = originalError;
    }
    assert.equal(failureStats.commits, 0);
    assert.equal(failureStats.rollbacks, 1);
    assert.equal(failureState.character.class, 'Fighter');
    assert.equal(failureState.bag.change_class, 1);

    const concurrentState = baseState();
    const concurrentStats = installFakePool(concurrentState);
    await Promise.all([
      changeClass.handleConfirm(fakeInteraction().interaction, 'Mage', 'class-user'),
      changeClass.handleConfirm(fakeInteraction().interaction, 'Mage', 'class-user'),
    ]);
    assert.equal(concurrentStats.commits, 1);
    assert.equal(concurrentState.character.class, 'Mage');
    assert.equal(concurrentState.bag.change_class, 0);
    assert.equal(concurrentState.logs.length, 1);
  } finally {
    pool.connect = originalConnect;
    if (previousSupporterModule) require.cache[supporterPath] = previousSupporterModule;
    else delete require.cache[supporterPath];
  }

  console.log('CLASS CHANGE SELFTEST: passed');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
