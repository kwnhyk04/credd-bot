'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { PermissionFlagsBits } = require('discord.js');
const {
  buildPlayerFighter,
  computeClassBattleStats,
} = require('../src/engine/statAssembly');
const { execute: executeProfile } = require('../src/commands/rpg/profile');
const {
  postOfficialRedirect,
  redirectChannelIssue,
} = require('../src/engine/bossSystem');
const { verifyRequiredSchema } = require('../src/db/schemaGuard');

const root = path.join(__dirname, '..');
const source = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function playerRow(overrides = {}) {
  return {
    class: 'Fighter', combat_level: 1, username: 'Tester',
    deity_name: 'Odin', d1_batk: 100, d1_bhp: 200, d1_bdef: 50,
    d1_unlocked_sigils: 5, d1_ascended: false, d1_enhancement: 1,
    deity2_name: null, deity3_name: null, echo_deity_name: null,
    w_native: null, a_native: null,
    ...overrides,
  };
}

async function fighterFor(row) {
  const queries = [];
  const db = {
    async query(sql) {
      queries.push(sql);
      return { rows: [row] };
    },
  };
  return { fighter: await buildPlayerFighter(db, '123'), sql: queries[0] };
}

function fakeRedirectChannel({ guildId = 'guild', sendAllowed = true } = {}) {
  let sends = 0;
  const channel = {
    id: 'channel', guildId, type: 0, archived: false,
    isTextBased: () => true,
    isSendable: () => true,
    isThread: () => false,
    permissionsFor: () => ({
      has: (permission) => permission === PermissionFlagsBits.ViewChannel || sendAllowed,
    }),
    send: async () => { sends += 1; return { id: 'message' }; },
  };
  return { channel, sends: () => sends };
}

async function main() {
  const classStats = computeClassBattleStats('Fighter', 1);

  const existing = await fighterFor(playerRow());
  assert.equal(existing.fighter.atk, classStats.atk + 75);
  assert(existing.sql.includes('COALESCE(ud.sigils, 0) AS d1_unlocked_sigils'));

  const zero = await fighterFor(playerRow({ d1_unlocked_sigils: 0 }));
  assert.equal(zero.fighter.atk, classStats.atk + 50);

  const missing = await fighterFor(playerRow({ deity_name: null }));
  assert.equal(missing.fighter.atk, classStats.atk);

  const profileSource = source('src/commands/rpg/profile.js');
  const statsSource = source('src/commands/rpg/stats.js');
  const raidSource = source('src/commands/rpg/raid.js');
  assert(profileSource.includes('AS d1_unlocked_sigils'));
  assert(statsSource.includes('AS d1_unlocked_sigils'));
  assert(raidSource.includes('buildPlayerFighter(pool, discordId)'));

  const replies = [];
  const logs = [];
  const originalError = console.error;
  console.error = (...args) => logs.push(args);
  try {
    await executeProfile({
      author: {
        id: '123', username: 'Tester', displayAvatarURL: () => 'avatar', defaultAvatarURL: 'fallback',
      },
      guild: { id: 'guild', members: { cache: new Map() } },
      getMention: () => null,
      reply: async (payload) => { replies.push(payload); },
    }, {
      db: { query: async () => { throw new Error('database unavailable'); } },
    });
  } finally {
    console.error = originalError;
  }
  assert.equal(logs.length, 1);
  assert.equal(logs[0][0], '[profile] command failed');
  assert(logs[0][1].error instanceof Error);
  assert.equal(replies.length, 1);
  assert(!replies[0].content.includes('database unavailable'));

  const valid = fakeRedirectChannel();
  const validClient = { user: { id: 'bot' }, channels: { fetch: async () => valid.channel } };
  assert.equal(redirectChannelIssue(valid.channel, 'guild', validClient.user), null);
  assert(await postOfficialRedirect(validClient, 'guild', 'channel', { force: true }));
  assert.equal(valid.sends(), 1);

  const blocked = fakeRedirectChannel({ guildId: 'blocked-guild', sendAllowed: false });
  const blockedClient = { user: { id: 'bot' }, channels: { fetch: async () => blocked.channel } };
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args);
  try {
    assert.equal(
      redirectChannelIssue(blocked.channel, 'blocked-guild', blockedClient.user),
      'missing Send Messages'
    );
    assert.equal(await postOfficialRedirect(blockedClient, 'blocked-guild', 'channel'), null);
    assert.equal(await postOfficialRedirect(blockedClient, 'blocked-guild', 'channel'), null);
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(blocked.sends(), 0);
  assert.equal(warnings.length, 1);

  await assert.rejects(
    verifyRequiredSchema({ query: async () => ({ rows: [{ column_name: 'sigils' }] }) }),
    /user_deities\.ascended/
  );
  await verifyRequiredSchema({
    query: async () => ({ rows: [{ column_name: 'sigils' }, { column_name: 'ascended' }] }),
  });

  const migration = source('scripts/migrations/20260711_add_deity_ascension_progress.sql');
  assert(migration.includes('ADD COLUMN IF NOT EXISTS sigils'));
  assert(migration.includes('ADD COLUMN IF NOT EXISTS ascended'));
  assert(migration.includes('user_deities_sigils_check'));

  console.log('SCHEMA DRIFT SELFTEST: passed');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
