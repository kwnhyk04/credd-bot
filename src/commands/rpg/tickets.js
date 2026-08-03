'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
} = require('discord.js');
const pool = require('../../db/pool');
const { smallDivider: sep } = require('../../utils/componentsV2');
const { ownerGate } = require('../../engine/skinShopViews');

const PAGE_SIZE = 10;
const VIEWS = Object.freeze([
  Object.freeze({ key: 'avatar_open', label: 'Avatar work queue', type: 'avatar', open: true }),
  Object.freeze({ key: 'deity_open', label: 'Custom Deity work queue', type: 'deity', open: true }),
  Object.freeze({ key: 'avatar_done', label: 'Completed Avatar tickets', type: 'avatar', open: false }),
  Object.freeze({ key: 'deity_done', label: 'Completed Custom Deity tickets', type: 'deity', open: false }),
]);

function reply(message, content) {
  return message.reply({ content, allowedMentions: { repliedUser: false } });
}

function viewFor(key) {
  return VIEWS.find((view) => view.key === key) || VIEWS[0];
}

function statusLabel(status) {
  return status === 'in_progress' ? 'Ongoing' : status === 'done' ? 'Done' : 'Queued';
}

async function fetchView(view, page) {
  const where = view.open
    ? `type = $1 AND status IN ('queued', 'in_progress')`
    : `type = $1 AND status = 'done'`;
  const order = view.open
    ? 'created_at ASC, ticket_id ASC'
    : 'completed_at DESC NULLS LAST, ticket_id DESC';
  const count = await pool.query(`SELECT count(*)::int AS total FROM tickets WHERE ${where}`, [view.type]);
  const total = Number(count.rows[0]?.total || 0);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.max(0, Math.min(Number(page) || 0, pageCount - 1));
  const rows = await pool.query(
    `SELECT ticket_id, type, user_id, status, created_at, completed_at
       FROM tickets
      WHERE ${where}
      ORDER BY ${order}
      LIMIT $2 OFFSET $3`,
    [view.type, PAGE_SIZE, safePage * PAGE_SIZE]
  );
  return { total, pageCount, page: safePage, rows: rows.rows };
}

function ticketLines(rows) {
  if (!rows.length) return '*No tickets in this view.*';
  return rows.map((row) => {
    const when = row.status === 'done' ? row.completed_at : row.created_at;
    const stamp = when ? `<t:${Math.floor(new Date(when).getTime() / 1000)}:f>` : 'unknown time';
    return `**\`${row.ticket_id}\`** · <@${row.user_id}> · ${statusLabel(row.status)} · ${stamp}`;
  }).join('\n');
}

async function buildTicketsView(ownerId, { key = VIEWS[0].key, page = 0 } = {}) {
  const view = viewFor(key);
  const data = await fetchView(view, page);
  const container = new ContainerBuilder()
    .setAccentColor(0x9b59b6)
    .addTextDisplayComponents((td) => td.setContent('## Supporter Ticket Queue'))
    .addTextDisplayComponents((td) => td.setContent(`-# ${view.label} · Page **${data.page + 1}/${data.pageCount}** · ${data.total} ticket${data.total === 1 ? '' : 's'}`))
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent(ticketLines(data.rows)))
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent('-# Update with `crd update ticket <ticket_id> <in_progress|done>`. `in_progress` displays as **Ongoing**.'));

  const select = new StringSelectMenuBuilder()
    .setCustomId(`tickets:category:${ownerId}`)
    .setPlaceholder('Choose a ticket view')
    .addOptions(VIEWS.map((item) => ({ label: item.label, value: item.key, default: item.key === view.key })));
  const nav = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`tickets:page:${ownerId}:${view.key}:${data.page}:prev`).setLabel('Previous').setStyle(ButtonStyle.Secondary).setDisabled(data.pageCount <= 1),
    new ButtonBuilder().setCustomId(`tickets:page:${ownerId}:${view.key}:${data.page}:next`).setLabel('Next').setStyle(ButtonStyle.Secondary).setDisabled(data.pageCount <= 1),
  );
  return {
    components: [container, new ActionRowBuilder().addComponents(select), nav],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

async function list(message, { args } = {}) {
  if (args?.length && String(args[0]).toLowerCase() !== 'tickets') {
    return reply(message, 'Usage: `crd supporter tickets`.');
  }
  return message.reply(await buildTicketsView(message.author.id));
}

async function updateTicketStatus(ticketId, next, actorId, db = pool) {
  if (!['in_progress', 'done'].includes(next)) throw new RangeError('Unsupported ticket status');
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query(
      'SELECT ticket_id, status FROM tickets WHERE ticket_id = $1 FOR UPDATE',
      [ticketId]
    );
    if (!current.rows[0]) {
      await client.query('ROLLBACK');
      return { status: 'not_found' };
    }
    const before = current.rows[0].status;
    if (before === next) {
      await client.query('ROLLBACK');
      return { status: 'unchanged', before, after: before };
    }
    if (before === 'done') {
      await client.query('ROLLBACK');
      return { status: 'completed', before, after: before };
    }
    const result = next === 'done'
      ? await client.query(
        `UPDATE tickets
            SET status = 'done', updated_at = NOW(), completed_at = NOW(), completed_by = $2
          WHERE ticket_id = $1
          RETURNING ticket_id, status`,
        [ticketId, actorId]
      )
      : await client.query(
        `UPDATE tickets
            SET status = 'in_progress', updated_at = NOW()
          WHERE ticket_id = $1
          RETURNING ticket_id, status`,
        [ticketId]
      );
    await client.query('COMMIT');
    return { status: 'updated', before, after: result.rows[0].status };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function update(message, args) {
  if ((args[0] || '').toLowerCase() !== 'ticket') {
    return reply(message, 'Usage: `crd update ticket <ticket_id> <in_progress|done>`.');
  }
  const ticketId = String(args[1] || '').trim().toLowerCase();
  const next = String(args[2] || '').trim().toLowerCase();
  if (!ticketId || !['in_progress', 'done'].includes(next)) {
    return reply(message, 'Usage: `crd update ticket <ticket_id> <in_progress|done>`.');
  }
  const result = await updateTicketStatus(ticketId, next, message.author.id);
  if (result.status === 'not_found') return reply(message, `Ticket \`${ticketId}\` was not found.`);
  if (result.status === 'unchanged') return reply(message, `Ticket \`${ticketId}\` is already **${statusLabel(next)}**.`);
  if (result.status === 'completed') return reply(message, `Ticket \`${ticketId}\` is already completed and cannot move backward.`);
  return reply(message, `Updated ticket \`${ticketId}\`: **${statusLabel(result.before)}** → **${statusLabel(result.after)}**.`);
}

async function handleInteraction(interaction) {
  const parts = interaction.customId.split(':');
  const action = parts[1];
  const ownerId = parts[2];
  if (!ownerGate(interaction, ownerId)) return;
  let key = VIEWS[0].key;
  let page = 0;
  if (action === 'category') {
    key = interaction.values?.[0] || key;
  } else if (action === 'page') {
    key = parts[3] || key;
    page = Number(parts[4] || 0) + (parts[5] === 'next' ? 1 : -1);
  } else {
    return;
  }
  await interaction.deferUpdate();
  await interaction.editReply(await buildTicketsView(ownerId, { key, page }));
}

module.exports = {
  execute: list,
  list,
  update,
  updateTicketStatus,
  buildTicketsView,
  handleInteraction,
};
