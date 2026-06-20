'use strict';

/**
 * commandContext.js — the dual-input adapter (Phase 11).
 *
 * Every command handler is `execute(ctx)`. `ctx` wraps EITHER a prefix `Message`
 * (MessageContext) OR a slash `ChatInputCommandInteraction` (InteractionContext) behind one
 * interface, so a handler runs unchanged on both paths:
 *
 *   ctx.userId / ctx.user / ctx.guildId / ctx.guild / ctx.channel / ctx.client
 *   ctx.args            string[] — prefix: tokens after the command; slash: produced by the
 *                       command's arg-assembler (canonical token array, incl. literal subcommands).
 *   ctx.isSlash         boolean
 *   ctx.interactionId   message.id (prefix) | interaction.id (slash) — unique key suffix for collectors
 *   ctx.reply(opts)     -> Promise<Message>  (HARD requirement on BOTH paths: bestow/duel/casino
 *                       attach createMessageComponentCollector to the returned message)
 *   ctx.editReply(opts) -> edit the reply
 *   ctx.deferReply(opts)-> no-op (prefix) | interaction.deferReply (slash)
 *   ctx.getMention(i)   -> User  (prefix: i-th @mention; slash: i-th resolved User option)
 *
 * `ephemeral:true` is honored ONLY on the slash path (bot-channel rejection + error fallback);
 * it is dropped on the prefix path. Components V2 payloads (`flags: IsComponentsV2`) pass through
 * unchanged on both paths.
 */

const { MessageFlags } = require('discord.js');

/** Translate the `ephemeral:true` convenience into Discord's flag bitfield (slash only). */
function applyEphemeral(opts, ephemeral) {
  const { ephemeral: _e, ...rest } = opts || {};
  if (!ephemeral) return rest;
  return { ...rest, flags: (rest.flags || 0) | MessageFlags.Ephemeral };
}

/** Clear the Ephemeral bit for editReply (the IsComponentsV2 flag, if any, is preserved). */
function clearEphemeral(opts) {
  const { ephemeral: _e, ...rest } = opts || {};
  if (typeof rest.flags === 'number') {
    const f = rest.flags & ~MessageFlags.Ephemeral;
    return { ...rest, flags: f || undefined };
  }
  return rest;
}

class MessageContext {
  constructor(message, args) {
    this.message = message;
    this.args = args;
    this.isSlash = false;
  }

  get userId() { return this.message.author.id; }
  get user() { return this.message.author; }
  // Convenience passthroughs — let handlers keep `message.author`/`message.mentions` semantics
  // behind a `const message = ctx` shim on the prefix path (slash uses ctx.getMention instead).
  get author() { return this.message.author; }
  get mentions() { return this.message.mentions; }
  get member() { return this.message.member; }
  get guildId() { return this.message.guild ? this.message.guild.id : null; }
  get guild() { return this.message.guild || null; }
  get channel() { return this.message.channel; }
  get client() { return this.message.client; }
  get interactionId() { return this.message.id; }

  /** Returns the sent Message (so callers can attach collectors). `ephemeral` is ignored. */
  reply(opts) {
    const { ephemeral: _e, ...rest } = opts || {};
    return this.message.reply({
      ...rest,
      allowedMentions: rest.allowedMentions || { repliedUser: false },
    });
  }

  editReply(opts) {
    const { ephemeral: _e, ...rest } = opts || {};
    return this.message.edit(rest);
  }

  deferReply() { return Promise.resolve(null); }

  getMention(i = 0) {
    const users = this.message.mentions && this.message.mentions.users;
    if (!users) return null;
    return [...users.values()][i] || null;
  }
}

class InteractionContext {
  /** @param mentions User[] resolved from the slash User options, in declaration order. */
  constructor(interaction, args, mentions = []) {
    this.interaction = interaction;
    this.args = args;
    this._mentions = mentions;
    this.isSlash = true;
    this._deferred = false;
    this._replied = false;
  }

  get userId() { return this.interaction.user.id; }
  get user() { return this.interaction.user; }
  get author() { return this.interaction.user; } // shim parity; slash has no `mentions`
  get member() { return this.interaction.member; }
  get guildId() { return this.interaction.guildId || null; }
  get guild() { return this.interaction.guild || null; }
  get channel() { return this.interaction.channel; }
  get client() { return this.interaction.client; }
  get interactionId() { return this.interaction.id; }

  async deferReply(opts = {}) {
    await this.interaction.deferReply(applyEphemeral({}, opts.ephemeral));
    this._deferred = true;
  }

  /** Returns the sent Message on both states (fresh reply or edit of a deferred reply). */
  async reply(opts) {
    if (this._deferred || this._replied) {
      return this.interaction.editReply(clearEphemeral(opts));
    }
    await this.interaction.reply(applyEphemeral(opts, opts && opts.ephemeral));
    this._replied = true;
    return this.interaction.fetchReply();
  }

  async editReply(opts) {
    return this.interaction.editReply(clearEphemeral(opts));
  }

  getMention(i = 0) { return this._mentions[i] || null; }
}

module.exports = { MessageContext, InteractionContext };
