process.env.BOSS_IMAGE_REFRESH_ENABLED = 'false';
process.env.RESOURCE_LOGS = 'false';

const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const bossMessages = require('../src/engine/boss/bossMessages');
const bossProgress = require('../src/engine/boss/bossProgress');
const bossRender = require('../src/engine/boss/bossRender');
const bossRuntime = require('../src/engine/boss/bossRuntime');

const guildId = 'boss-refresh-selftest-guild';
const spawnId = 'boss-refresh-selftest-spawn';

function makeState({ currentHp = 10_000, status = 'active' } = {}) {
  return {
    guild_id: guildId,
    spawn_id: spawnId,
    mob_id: 1,
    max_hp: 10_000,
    current_hp: currentHp,
    scaled_atk: 10,
    scaled_def: 5,
    spawn_at: new Date(),
    expires_at: new Date(Date.now() + 100_000),
    status,
    spawn_source: 'natural',
    last_attack_at: new Date(),
    passive_state: {},
  };
}

function makeMob() {
  return {
    mob_id: 1,
    name: 'Medusa',
    mythology: 'Greek',
    base_hp: 1_000,
    hp_per_level: 1,
    base_atk: 10,
    atk_per_level: 1,
    base_def: 5,
    def_per_level: 1,
    base_crit: 0,
    skill_name: null,
    skill_description: null,
  };
}

function payloadText(payload) {
  return JSON.stringify(payload.components[0].toJSON());
}

async function main() {
  const realQuery = pool.query;
  const realConnect = pool.connect;
  const realSetTimeout = global.setTimeout;
  const realClearTimeout = global.clearTimeout;
  const previousImageRefresh = process.env.BOSS_IMAGE_REFRESH_ENABLED;
  const model = { state: makeState(), mob: makeMob(), attackers: [] };
  const edits = [];
  const sends = [];
  let checks = 0;
  let holdEdit = false;
  let editStartedResolve = null;
  let editGate = null;
  let editGateResolve = null;
  let expectPostCommitRead = false;
  const flowEvents = [];

  const check = (condition, message) => {
    checks += 1;
    assert.ok(condition, message);
  };

  const message = {
    id: 'message',
    channelId: 'channel',
    attachments: new Map([
      ['banner', { id: 'banner-id', name: 'boss_banner.webp', url: 'https://cdn.test/banner.webp' }],
    ]),
    async edit(payload) {
      if (Object.hasOwn(payload, 'flags')) {
        throw new Error('Components-V2 flags are immutable on edits');
      }
      edits.push(payload);
      if (holdEdit) {
        holdEdit = false;
        editStartedResolve?.();
        editStartedResolve = null;
        await editGate;
      }
      return this;
    },
  };
  const channel = {
    messages: { fetch: async () => message },
    async send(payload) { sends.push(payload); return message; },
  };
  const client = { channels: { fetch: async () => channel } };

  pool.query = async (sql) => {
    const text = String(sql);
    if (text.includes('FROM boss_state')) {
      if (expectPostCommitRead) {
        flowEvents.push('post-commit-state-read');
        expectPostCommitRead = false;
      }
      return { rows: [model.state] };
    }
    if (text.includes('count(*)::int AS attacker_count')) {
      return { rows: [{ attacker_count: model.attackers.length }] };
    }
    if (text.includes('FROM boss_attack_log')) {
      return {
        rows: [...model.attackers]
          .sort((a, b) => Number(b.total_damage) - Number(a.total_damage))
          .slice(0, 15),
      };
    }
    if (text.includes('FROM mob_roster')) return { rows: [model.mob] };
    if (text.includes('INSERT INTO active_battles')) return { rows: [{ battle_id: 1 }], rowCount: 1 };
    if (text.includes('DELETE FROM active_battles')) return { rows: [], rowCount: 1 };
    throw new Error(`unexpected SQL in boss refresh self-test: ${text.slice(0, 100)}`);
  };

  bossRuntime.liveMessages.set(guildId, { channelId: 'channel', messageId: 'message' });

  try {
    const fullCacheParts = bossRender.bossStatusCacheParts(makeState(), model.mob);
    const damagedCacheParts = bossRender.bossStatusCacheParts(makeState({ currentHp: 9_000 }), model.mob);
    check(fullCacheParts.currentHp !== damagedCacheParts.currentHp,
      'boss status cache key changes with current HP instead of reusing a stale render');
    check(!bossRender.renderBossStatusCard(makeState(), model.mob)
      .equals(bossRender.renderBossStatusCard(makeState({ currentHp: 9_000 }), model.mob)),
    'boss status HP bar render changes after damage');

    model.state = makeState({ currentHp: 9_000 });
    model.attackers = [{ discord_id: 'A', total_damage: 1_000 }];
    await bossMessages.refreshLiveMessageProgress(client, guildId, { telemetryCommand: 'boss:attack' });
    let text = payloadText(edits.at(-1));
    check(text.includes('**HP:** 9,000 / 10,000'), 'single attack refreshes current HP');
    check(text.includes('**#1** · <@A> · 1,000'), 'single attack refreshes accumulated damage');
    check(!Object.hasOwn(edits.at(-1), 'flags'), 'active boss edits omit immutable Components-V2 flags');
    check(sends.length === 0, 'active boss refresh edits the existing message without duplicating it');

    model.state = makeState({ currentHp: 8_500 });
    model.attackers = [
      { discord_id: 'C', total_damage: 1_100 },
      { discord_id: 'A', total_damage: 1_000 },
      { discord_id: 'B', total_damage: 900 },
    ];
    await bossMessages.refreshLiveMessageProgress(client, guildId, { telemetryCommand: 'boss:attack' });
    text = payloadText(edits.at(-1));
    check(text.indexOf('**#1** · <@C>') < text.indexOf('**#2** · <@A>'), 'rank change is reflected immediately');
    check(text.includes('**HP:** 8,500 / 10,000'), 'rank-change refresh uses the same latest HP');

    model.state = makeState({ currentHp: 8_000 });
    model.attackers = [
      ...Array.from({ length: 15 }, (_, index) => ({
        discord_id: `old-${index}`,
        total_damage: 1_000 - index * 10,
      })),
      { discord_id: 'new-top-15', total_damage: 2_000 },
    ];
    await bossMessages.refreshLiveMessageProgress(client, guildId, { telemetryCommand: 'boss:attack' });
    text = payloadText(edits.at(-1));
    check(text.includes('out of 16 challengers'), 'leaderboard reports the full challenger count');
    check(text.includes('**#1** · <@new-top-15> · 2,000'), 'new Top 15 entrant appears immediately');
    check(!text.includes('<@old-14>'), 'the previous fifteenth-place challenger is displaced');

    edits.length = 0;
    model.state = makeState({ currentHp: 7_500 });
    model.attackers = [{ discord_id: 'A', total_damage: 2_500 }];
    let editStarted = new Promise((resolve) => { editStartedResolve = resolve; });
    editGate = new Promise((resolve) => { editGateResolve = resolve; });
    holdEdit = true;
    bossMessages.scheduleBossLiveRefresh(client, guildId, {
      spawnId,
      immediate: true,
    });
    const pending = bossRuntime.pendingBossRefreshes.get(guildId);
    await editStarted;
    model.state = makeState({ currentHp: 7_000 });
    model.attackers = [{ discord_id: 'B', total_damage: 3_500 }, { discord_id: 'A', total_damage: 2_500 }];
    bossMessages.scheduleBossLiveRefresh(client, guildId, { spawnId, immediate: true });
    // Resolve the held edit after the second attack has requested a rerun.
    editGateResolve?.();
    editGateResolve = null;
    await pending.done;
    const rerun = bossRuntime.pendingBossRefreshes.get(guildId);
    if (rerun) await rerun.done;
    text = payloadText(edits.at(-1));
    check(edits.length >= 2, 'rapid attacks perform a coalesced latest-state rerun');
    check(text.includes('**HP:** 7,000 / 10,000'), 'rapid refresh ends at the latest committed HP');
    check(text.includes('**#1** · <@B> · 3,500'), 'rapid refresh ends at the latest leaderboard');

    edits.length = 0;
    model.state = makeState({ currentHp: 6_500 });
    model.attackers = [{ discord_id: 'A', total_damage: 4_000 }];
    bossMessages.scheduleBossLiveRefresh(client, guildId, {
      spawnId,
      immediate: true,
    });
    model.state = makeState({ currentHp: 0, status: 'dead' });
    await bossRuntime.pendingBossRefreshes.get(guildId)?.done;
    check(edits.length === 0, 'a terminal state cannot be overwritten by an active refresh');
    check(bossRuntime.liveMessages.has(guildId), 'terminal refresh cancellation keeps the live-message reference');

    const finalUpdated = await bossMessages.refreshLiveMessage(client, guildId, {
      includeStatusImage: false,
      includeBanner: 'remote-only',
      telemetryCommand: 'boss:final',
    });
    text = payloadText(edits.at(-1));
    check(finalUpdated === true && text.includes('Slain by the united server'), 'final boss state still edits the existing message');
    check(!text.includes('boss:attack:'), 'final boss payload has no active attack button');
    check(sends.length === 0, 'final boss refresh edits the existing message without duplication');

    // Full attack integration: stage the HP/log writes inside a fake
    // transaction and expose them to pool reads only after COMMIT. Start with
    // an empty process-local message map to reproduce a deployment/restart.
    edits.length = 0;
    model.state = { ...makeState(), spawn_source: 'dev' };
    model.attackers = [];
    bossRuntime.liveMessages.delete(guildId);

    const sendsBeforeMissingRef = sends.length;
    const missingRefUpdated = await bossMessages.refreshLiveMessageProgress(client, guildId);
    check(missingRefUpdated === false && sends.length === sendsBeforeMissingRef,
      'post-attack refresh without a message reference never creates a duplicate');

    pool.connect = async () => {
      let stagedState = null;
      let stagedAttackers = null;
      return {
        async query(sql, params = []) {
          const text = String(sql).trim();
          if (text === 'BEGIN') return { rows: [], rowCount: 0 };
          if (text === 'ROLLBACK') {
            stagedState = null;
            stagedAttackers = null;
            return { rows: [], rowCount: 0 };
          }
          if (text === 'COMMIT') {
            model.state = stagedState;
            model.attackers = stagedAttackers;
            flowEvents.push('attack-commit');
            expectPostCommitRead = true;
            return { rows: [], rowCount: 0 };
          }
          if (text.includes('FROM boss_state') && text.includes('FOR UPDATE')) {
            stagedState = { ...model.state };
            stagedAttackers = model.attackers.map((row) => ({ ...row }));
            return { rows: [{ ...model.state }], rowCount: 1 };
          }
          if (text.startsWith('UPDATE boss_state SET current_hp')) {
            stagedState.current_hp = Math.max(0, Number(stagedState.current_hp) - Number(params[2]));
            stagedState.last_attack_at = new Date();
            stagedState.passive_state = JSON.parse(params[3]);
            return { rows: [{ current_hp: stagedState.current_hp }], rowCount: 1 };
          }
          if (text.startsWith('INSERT INTO boss_attack_log')) {
            const discordId = params[2];
            const damage = Number(params[4]);
            const existing = stagedAttackers.find((row) => row.discord_id === discordId);
            if (existing) existing.total_damage += damage;
            else stagedAttackers.push({ discord_id: discordId, total_damage: damage });
            return { rows: [{ id: 1 }], rowCount: 1 };
          }
          if (text.startsWith('UPDATE user_character SET boss_top_damage')) {
            return { rows: [], rowCount: 1 };
          }
          throw new Error(`unexpected transaction SQL in boss refresh self-test: ${text.slice(0, 100)}`);
        },
        release() {},
      };
    };

    const damageQueue = [1_000, 2_500];
    const attackReplies = [];
    const interaction = {
      guildId,
      channelId: 'channel',
      customId: `boss:attack:${guildId}`,
      user: { id: 'attack-user' },
      client,
      message,
      async deferReply() {},
      async editReply(payload) { attackReplies.push(payload); },
    };
    const attackDeps = {
      buildPlayerFighterFn: async () => ({ name: 'Attacker', hp: 10_000 }),
      isBannedFn: async () => false,
      resolveBattleFn: () => {
        const damage = damageQueue.shift();
        return {
          seed: 1,
          winner: 'player',
          outcome: 'boss_timeout',
          mode: 'boss',
          a: { name: 'Attacker' },
          b: { name: 'Medusa', bossPassiveState: {} },
          totals: { netDamage: damage },
          rounds: [],
          bossThresholdEvents: [],
        };
      },
    };

    await bossProgress.handleAttackImpl(interaction, attackDeps);
    await bossProgress.handleAttackImpl(interaction, attackDeps);
    text = payloadText(edits.at(-1));
    check(model.state.current_hp === 6_500, 'successful attacks commit cumulative boss HP damage');
    check(model.attackers.length === 1 && model.attackers[0].total_damage === 3_500,
      'successful attacks commit cumulative user damage ranking totals');
    check(text.includes('**HP:** 6,500 / 10,000'),
      'post-attack message renders the newly committed boss HP');
    check(text.includes('**#1** · <@attack-user> · 3,500'),
      'post-attack message renders the newly committed damage ranking');
    check(flowEvents.filter((event) => event === 'attack-commit').length === 2
      && flowEvents.filter((event) => event === 'post-commit-state-read').length === 2
      && flowEvents.indexOf('attack-commit') < flowEvents.indexOf('post-commit-state-read'),
    'each refresh reads through the pool only after its attack transaction commits');
    check(bossRuntime.liveMessages.get(guildId)?.messageId === message.id,
      'a successful button attack restores the existing live-message reference');
    check(sends.length === sendsBeforeMissingRef,
      'attack recovery edits the clicked boss message without sending a duplicate');
    check(attackReplies.length === 2, 'both successful attacks acknowledge the attacker');

    // Timer-only assertions: scheduler delay remains 15 seconds, while an
    // attack cancels/rearms it at zero and marks an in-flight render to rerun.
    const timers = [];
    const cleared = [];
    global.setTimeout = (fn, delay) => {
      const timer = { fn, delay };
      timers.push(timer);
      return timer;
    };
    global.clearTimeout = (timer) => { cleared.push(timer); };
    bossMessages.scheduleBossLiveRefresh(client, guildId, { spawnId, telemetryCommand: 'scheduler:boss' });
    check(timers.at(-1).delay === 15_000, 'scheduler keeps its debounce delay');
    bossMessages.scheduleBossLiveRefresh(client, guildId, { spawnId, immediate: true });
    const timerPending = bossRuntime.pendingBossRefreshes.get(guildId);
    check(cleared.length === 1 && timers.at(-1).delay === 0, 'attack refresh bypasses the debounce delay');
    check(timerPending.immediate === true, 'pending attack refresh is marked immediate');
    timerPending.running = true;
    bossMessages.scheduleBossLiveRefresh(client, guildId, { spawnId, immediate: true });
    check(timerPending.rerun === true, 'an attack during rendering requests a latest-state rerun');
    timerPending.running = false;
  } finally {
    await bossRuntime.clearPendingBossRefresh(guildId, 'selftest');
    bossRuntime.liveMessages.delete(guildId);
    bossRuntime.currentSpawn.delete(guildId);
    pool.query = realQuery;
    pool.connect = realConnect;
    global.setTimeout = realSetTimeout;
    global.clearTimeout = realClearTimeout;
    if (previousImageRefresh === undefined) delete process.env.BOSS_IMAGE_REFRESH_ENABLED;
    else process.env.BOSS_IMAGE_REFRESH_ENABLED = previousImageRefresh;
  }

  console.log(`BOSS_REFRESH SELFTEST: ${checks} passed`);
}

main().catch((err) => {
  console.error('BOSS_REFRESH SELFTEST: failed');
  console.error(err);
  process.exitCode = 1;
});
