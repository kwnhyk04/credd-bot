'use strict';

require('dotenv').config();

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

function connectionStringWithoutSslParams(raw) {
  const url = new URL(raw);
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) url.searchParams.delete(key);
  return url.toString();
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  process.env.NODE_ENV = 'test';
  const db = new Pool({
    connectionString: connectionStringWithoutSslParams(process.env.DATABASE_URL),
    ssl: false,
    max: 6,
    connectionTimeoutMillis: 10_000,
    query_timeout: 30_000,
  });

  const poolPath = require.resolve('../src/db/pool');
  require.cache[poolPath] = {
    id: poolPath,
    filename: poolPath,
    loaded: true,
    exports: db,
    children: [],
    paths: [],
  };

  const { execute: executeDev } = require('../src/commands/rpg/dev');
  const { updateTicketStatus } = require('../src/commands/rpg/tickets');
  const { processQueuedCalamity } = require('../src/engine/bossSystem');
  const { verifyRequiredSchema } = require('../src/db/schemaGuard');

  try {
    const migration08 = fs.readFileSync(
      path.join(__dirname, 'migrations', '20260803_08_boss_queue_recovery_rls.sql'),
      'utf8'
    );
    await db.query(migration08);

    const rls = await db.query(
      `SELECT c.relname, c.relrowsecurity
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = ANY($1::text[])
        ORDER BY c.relname`,
      [['user_presets', 'tickets', 'supporter_item_grants', 'boss_spawn_queue']]
    );
    assert.equal(rls.rowCount, 4);
    assert(rls.rows.every((row) => row.relrowsecurity === true));
    console.log('RLS', JSON.stringify(rls.rows));

    const devIds = String(process.env.DEV_IDS || '').split(',').map((id) => id.trim()).filter(Boolean);
    const target = await db.query(
      `SELECT discord_id
         FROM users
        WHERE discord_id = ANY($1::varchar[])
        ORDER BY discord_id
        LIMIT 1`,
      [devIds]
    );
    if (!target.rows[0]) throw new Error('No registered DEV_IDS account exists for the dev-sub stacking test');
    const targetId = target.rows[0].discord_id;
    if (!process.argv.includes('--skip-dev-sub')) {
    const before = await db.query(
      `SELECT COALESCE(s.token_balance, 0)::int AS tokens,
              COALESCE(b.custom_deity_token, 0)::int AS deity_tokens
         FROM users u
         LEFT JOIN supporters s ON s.discord_id = u.discord_id
         LEFT JOIN users_bag b ON b.discord_id = u.discord_id
        WHERE u.discord_id = $1`,
      [targetId]
    );
    const balances = [];
    for (let run = 1; run <= 3; run += 1) {
      const replies = [];
      await executeDev({
        author: { id: targetId },
        mentions: { users: { first: () => null } },
        reply: async (payload) => { replies.push(payload); return payload; },
      }, { args: ['sub', 'eternal'] });
      assert.equal(replies.length, 1);
      assert.match(replies[0].content, /stipend paid/);
      const current = await db.query(
        `SELECT s.token_balance::int AS tokens, b.custom_deity_token::int AS deity_tokens
           FROM supporters s
           JOIN users_bag b ON b.discord_id = s.discord_id
          WHERE s.discord_id = $1`,
        [targetId]
      );
      balances.push({ run, ...current.rows[0] });
      assert.equal(current.rows[0].tokens, Number(before.rows[0].tokens) + run * 60);
      assert.equal(current.rows[0].deity_tokens, Number(before.rows[0].deity_tokens) + run);
    }
    console.log('DEV_SUB_STACK', JSON.stringify({ targetId, before: before.rows[0], balances }));
    }

    const ticketId = `audit${Date.now().toString(36)}`;
    await db.query(
      `INSERT INTO tickets (ticket_id, type, user_id) VALUES ($1, 'avatar', $2)`,
      [ticketId, targetId]
    );
    const ticketResults = await Promise.all([
      updateTicketStatus(ticketId, 'done', targetId, db),
      updateTicketStatus(ticketId, 'in_progress', targetId, db),
    ]);
    const ticketFinal = await db.query(
      'SELECT status, completed_at IS NOT NULL AS has_completed_at, completed_by FROM tickets WHERE ticket_id = $1',
      [ticketId]
    );
    assert.equal(ticketFinal.rows[0].status, 'done');
    assert.equal(ticketFinal.rows[0].has_completed_at, true);
    assert.equal(ticketFinal.rows[0].completed_by, targetId);
    console.log('TICKET_CONCURRENCY', JSON.stringify({ ticketResults, final: ticketFinal.rows[0] }));
    await db.query('DELETE FROM tickets WHERE ticket_id = $1', [ticketId]);

    const staleGuild = `as${Date.now().toString(36)}`;
    const stale = await db.query(
      `INSERT INTO boss_spawn_queue
         (guild_id, boss_name, requested_by, status, claim_started_at)
       VALUES ($1, 'Bakunawa', $2, 'spawning', NOW() - INTERVAL '10 minutes')
       RETURNING queue_id`,
      [staleGuild, targetId]
    );
    const recovered = await processQueuedCalamity({}, staleGuild, {
      db,
      spawn: async (_client, _guildId, options) => {
        assert.equal(options.force, false);
        assert.equal(options.bossName, 'Bakunawa');
        return true;
      },
    });
    assert.equal(recovered, true);
    const staleFinal = await db.query(
      'SELECT status, claim_started_at FROM boss_spawn_queue WHERE queue_id = $1',
      [stale.rows[0].queue_id]
    );
    assert.equal(staleFinal.rows[0].status, 'spawned');
    assert.equal(staleFinal.rows[0].claim_started_at, null);

    const failedGuild = `af${Date.now().toString(36)}`;
    const failed = await db.query(
      `INSERT INTO boss_spawn_queue (guild_id, boss_name, requested_by)
       VALUES ($1, 'Fenrir', $2) RETURNING queue_id`,
      [failedGuild, targetId]
    );
    await assert.rejects(
      processQueuedCalamity({}, failedGuild, {
        db,
        spawn: async () => { throw new Error('simulated process failure after claim'); },
      }),
      /simulated process failure/
    );
    const failedFinal = await db.query(
      'SELECT status, claim_started_at FROM boss_spawn_queue WHERE queue_id = $1',
      [failed.rows[0].queue_id]
    );
    assert.equal(failedFinal.rows[0].status, 'pending');
    assert.equal(failedFinal.rows[0].claim_started_at, null);
    console.log('CALAMITY_RECOVERY', JSON.stringify({ stale: staleFinal.rows[0], thrown: failedFinal.rows[0] }));
    await db.query('DELETE FROM boss_spawn_queue WHERE guild_id = ANY($1::varchar[])', [[staleGuild, failedGuild]]);

    const partial = await db.connect();
    let partialError = null;
    try {
      await partial.query('BEGIN');
      await partial.query("SET LOCAL lock_timeout = '5s'");
      await partial.query('ALTER TABLE tickets DROP COLUMN notes');
      try {
        await verifyRequiredSchema(partial);
      } catch (err) {
        partialError = err;
      }
      await partial.query('ROLLBACK');
    } finally {
      partial.release();
    }
    assert(partialError);
    assert.match(partialError.message, /tickets\.notes/);
    console.log('PARTIAL_PREFLIGHT_FAILURE', partialError.message);

    await verifyRequiredSchema(db);
    console.log('COMPLETE_SCHEMA_GUARD passed');
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
