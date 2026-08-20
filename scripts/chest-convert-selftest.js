'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const chest = require('../src/commands/rpg/chestConvert');
const aliases = require('../src/config/aliases');
const { parseMessage } = require('../src/handlers/commandHandler');

let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    return;
  }
  failed += 1;
  console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ''}`);
}

async function expect(name, fn) {
  try {
    await fn();
    passed += 1;
  } catch (err) {
    failed += 1;
    console.error(`FAIL: ${name} — ${err.message}`);
  }
}

class ChestClient {
  constructor({ type, bag, submissions = new Set(), failOnLog = false, failOnCommit = false }) {
    this.type = type;
    this.bag = { ...bag };
    this.submissions = submissions;
    this.failOnLog = failOnLog;
    this.failOnCommit = failOnCommit;
    this.snapshot = null;
    this.pendingSubmission = null;
    this.sql = [];
    this.params = [];
    this.rollbackCount = 0;
    this.commitCount = 0;
    this.logs = [];
  }

  async query(sql, params = []) {
    const normalized = sql.trim();
    this.sql.push(normalized);
    this.params.push(params);

    if (normalized === 'BEGIN') {
      this.snapshot = { ...this.bag };
      this.pendingSubmission = null;
      return { rows: [] };
    }
    if (normalized === 'ROLLBACK') {
      this.rollbackCount += 1;
      if (this.snapshot) this.bag = { ...this.snapshot };
      this.pendingSubmission = null;
      return { rows: [] };
    }
    if (normalized === 'COMMIT') {
      if (this.failOnCommit) throw new Error('simulated commit failure');
      if (this.pendingSubmission) this.submissions.add(this.pendingSubmission);
      this.commitCount += 1;
      this.snapshot = null;
      this.pendingSubmission = null;
      return { rows: [] };
    }
    if (normalized.includes('INSERT INTO essence_exchange_submissions')) {
      if (this.submissions.has(params[0])) return { rows: [] };
      this.pendingSubmission = params[0];
      return { rows: [{ submission_id: params[0] }] };
    }
    if (normalized.includes('FROM users_bag') && normalized.includes('FOR UPDATE')) {
      return { rows: [{ ...this.bag }] };
    }
    if (normalized.startsWith('UPDATE users_bag')) {
      const def = chest.conversionDefinitions[this.type];
      const sourceAmount = Number(params[1]);
      const outputAmount = Number(params[2]);
      if (Number(this.bag[def.sourceColumn]) < sourceAmount) return { rowCount: 0, rows: [] };
      this.bag[def.sourceColumn] -= sourceAmount;
      this.bag[def.destinationColumn] += outputAmount;
      return { rowCount: 1, rows: [] };
    }
    if (normalized.includes('INSERT INTO game_logs')) {
      if (this.failOnLog) throw new Error('simulated log failure');
      this.logs.push(params);
      return { rows: [] };
    }
    if (normalized.includes('FROM users_bag')) return { rows: [{ ...this.bag }] };
    throw new Error(`unexpected query: ${normalized}`);
  }

  release() {}
}

function bagFor(type, sourceAmount, destinationAmount = 0) {
  const def = chest.conversionDefinitions[type];
  return {
    silver_chest: 0,
    gold_chest: 0,
    diamond_chest: 0,
    boss_treasure_chest: 0,
    boss_golden_chest: 0,
    [def.sourceColumn]: sourceAmount,
    [def.destinationColumn]: destinationAmount,
  };
}

function modalInteraction(raw, userId = '42') {
  const calls = { reply: [], defer: 0, edit: [] };
  return {
    calls,
    user: { id: userId },
    fields: { getTextInputValue: () => raw },
    reply: async (payload) => { calls.reply.push(payload); return payload; },
    deferReply: async () => { calls.defer += 1; },
    editReply: async (payload) => { calls.edit.push(payload); return payload; },
  };
}

async function run() {
  const defs = chest.conversionDefinitions;
  const expected = {
    silver_gold: ['silver_chest', 'gold_chest', 20],
    gold_diamond: ['gold_chest', 'diamond_chest', 10],
    diamond_boss_golden: ['diamond_chest', 'boss_golden_chest', 10],
    boss_treasure_boss_golden: ['boss_treasure_chest', 'boss_golden_chest', 15],
  };

  check('all four fixed conversion definitions are present', chest.CONVERSION_TYPES.length === 4);
  for (const [type, [source, destination, rate]] of Object.entries(expected)) {
    const def = defs[type];
    check(`${type} uses canonical fields and rate`, def.sourceColumn === source
      && def.destinationColumn === destination && def.rate === rate);
  }

  check('dynamic maximum preserves remainder', chest.maxConvertibleSource('silver_gold', {
    silver_chest: 127,
  }) === 120 && chest.maxConvertibleOutput('silver_gold', { silver_chest: 127 }) === 6);
  check('source quantity parser rejects unsafe and non-integer input', [
    '', '0', '-20', '20.5', 'abc', 'NaN', 'Infinity', '1e2', '9007199254740992',
  ].every((value) => chest.parseSourceAmount(value) === null));
  check('source quantity parser accepts positive whole input', chest.parseSourceAmount('020') === 20);
  check('conversion-unit validation rejects a remainder', !chest.isCompleteConversion(21, 'silver_gold')
    && chest.isCompleteConversion(100, 'silver_gold'));

  await expect('convert button opens the same modal flow', async () => {
    let shown;
    await chest.handleConvert({
      user: { id: '42' },
      showModal: async (modal) => { shown = modal.toJSON(); },
    }, '42', 'silver_gold');
    assert.equal(shown.title, 'Convert Chests');
    assert.match(shown.custom_id, /^chestx:amount:42:silver_gold:[0-9a-f-]{36}$/);
    assert.equal(shown.components[0].components[0].label, 'Source Chest Quantity');
    assert.equal(shown.components[0].components[0].placeholder, 'Enter a multiple of 20');
  });

  const payload = chest.buildPayload({
    silver_chest: 127, gold_chest: 4, diamond_chest: 0,
    boss_treasure_chest: 0, boss_golden_chest: 0,
  }, 'silver_gold', '42');
  const payloadJson = payload.components.map((component) => component.toJSON());
  const payloadText = JSON.stringify(payloadJson);
  check('initial view uses Components V2 and owner-scoped controls', payload.flags > 0
    && payloadText.includes('chestx:type:42')
    && payloadText.includes('chestx:convert:42:silver_gold'));
  check('initial view shows the canonical chest emojis', payloadText.includes('silver_chest')
    && payloadText.includes('gold_chest'));

  for (const [type, [, destination, rate]] of Object.entries(expected)) {
    const sourceAmount = rate * 5;
    const client = new ChestClient({ type, bag: bagFor(type, sourceAmount, 2) });
    const result = await chest.convertBulk(
      client,
      '42',
      type,
      sourceAmount,
      `11111111-1111-4111-8111-${String(Object.keys(expected).indexOf(type) + 1).padStart(12, '0')}`,
    );
    check(`${type} converts complete source quantity`, result.status === 'done'
      && result.sourceAmount === sourceAmount
      && result.outputAmount === 5
      && client.bag[defs[type].sourceColumn] === 0
      && client.bag[destination] === 7);
    check(`${type} conversion commits one atomic update`, client.commitCount === 1
      && client.sql.filter((sql) => sql.startsWith('UPDATE users_bag')).length === 1);
  }

  for (const [value, message] of [
    ['0', 'positive whole-number'],
    ['-20', 'positive whole-number'],
    ['20.5', 'positive whole-number'],
    ['21', 'multiples of 20'],
  ]) {
    const interaction = modalInteraction(value);
    await chest.handleModalSubmit(interaction, '42', 'silver_gold', '22222222-2222-4222-8222-222222222222');
    check(`invalid input ${value} is rejected before transaction`, interaction.calls.reply.length === 1
      && interaction.calls.reply[0].content.includes(message)
      && interaction.calls.defer === 0);
  }

  const insufficientClient = new ChestClient({ type: 'silver_gold', bag: bagFor('silver_gold', 19) });
  const insufficient = await chest.convertBulk(
    insufficientClient,
    '42',
    'silver_gold',
    20,
    '33333333-3333-4333-8333-333333333333',
  );
  check('insufficient balance rejects without negative balance', insufficient.status === 'insufficient'
    && insufficient.maximumSource === 0
    && insufficientClient.bag.silver_chest === 19
    && insufficientClient.bag.gold_chest === 0
    && insufficientClient.rollbackCount === 1);

  const staleClient = new ChestClient({ type: 'silver_gold', bag: bagFor('silver_gold', 19) });
  const stale = await chest.convertBulk(
    staleClient,
    '42',
    'silver_gold',
    20,
    '44444444-4444-4444-8444-444444444444',
  );
  check('confirmation re-checks a stale balance under the row lock', stale.status === 'insufficient'
    && staleClient.sql.some((sql) => sql.includes('FOR UPDATE'))
    && !staleClient.sql.some((sql) => sql.startsWith('UPDATE users_bag')));

  const failedClient = new ChestClient({
    type: 'silver_gold',
    bag: bagFor('silver_gold', 20, 3),
    failOnLog: true,
  });
  await expect('transaction failure rolls back both sides', async () => {
    await assert.rejects(
      chest.convertBulk(failedClient, '42', 'silver_gold', 20, '55555555-5555-4555-8555-555555555555'),
      /simulated log failure/,
    );
    assert.equal(failedClient.bag.silver_chest, 20);
    assert.equal(failedClient.bag.gold_chest, 3);
    assert.equal(failedClient.commitCount, 0);
    assert.ok(failedClient.rollbackCount >= 1);
  });

  const submissions = new Set();
  const firstClient = new ChestClient({ type: 'gold_diamond', bag: bagFor('gold_diamond', 20), submissions });
  const submissionId = '66666666-6666-4666-8666-666666666666';
  const first = await chest.convertBulk(firstClient, '42', 'gold_diamond', 10, submissionId);
  const beforeRetry = { ...firstClient.bag };
  const retry = await chest.convertBulk(firstClient, '42', 'gold_diamond', 10, submissionId);
  check('duplicate modal submission is idempotent', first.status === 'done'
    && retry.status === 'duplicate'
    && firstClient.bag.gold_chest === beforeRetry.gold_chest
    && firstClient.bag.diamond_chest === beforeRetry.diamond_chest
    && firstClient.commitCount === 1);

  const ccMessage = { author: { bot: false, id: '42' }, guild: { id: 'guild' }, content: 'crd cc' };
  const fullMessage = { author: { bot: false, id: '42' }, guild: { id: 'guild' }, content: 'crd convert chest' };
  const ccParsed = parseMessage(ccMessage);
  const fullParsed = parseMessage(fullMessage);
  check('shortcut maps to the canonical convert command', aliases.cc === 'convert chest'
    && ccParsed?.command === 'convert' && ccParsed.args[0] === 'chest'
    && fullParsed?.command === 'convert' && fullParsed.args[0] === 'chest');

  const interactionSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'handlers', 'interactionHandler.js'), 'utf8');
  check('component router sends chest select/modal/button events to one module', interactionSource.includes("namespace === 'chestx' && action === 'type'")
    && interactionSource.includes("namespace === 'chestx' && action === 'amount'")
    && interactionSource.includes("namespace === 'chestx' && action === 'convert'")
    && interactionSource.includes("chestx: 'convert'"));

  const openSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'engine', 'chestOpen.js'), 'utf8');
  const dropSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'config', 'dropRates.js'), 'utf8');
  check('chest opening and drop configuration remain outside the conversion module', !openSource.includes('chestx:')
    && !dropSource.includes('chestx:'));

  console.log(`CHEST_CONVERT ${JSON.stringify({ passed, failed })}`);
  if (failed > 0) process.exitCode = 1;
}

run().catch((err) => {
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
