'use strict';

/**
 * COMBAT LOG — the one event-ordering pipeline for every battle mode.
 *
 * PROBLEM THIS REPLACES
 * The log used to be a flat string array re-sequenced once per round by slicing
 * ranges: [actor-1 attack] → [actor-1 registry logs] → [DOT] → … . Because the
 * registry's round-phase logs were hoisted as a BLOCK after the whole attack
 * segment, an outgoing-damage modifier ("Bloodhunter — outgoing damage +10%")
 * printed AFTER the on-hit status it had modified, and — worse — after the defeat
 * message, which read as effects being applied to a corpse.
 *
 * THE MODEL
 * Every event carries a PRIORITY. The engine sets an ambient source channel while it
 * runs each phase (weapon registry, blessing registry, defender stack, DOT tick, etc.),
 * and every `log.push(...)` inside that phase inherits it. Hooks that apply statuses
 * explicitly select STATUS priority, keeping event type separate from source category.
 *
 * Attack-bound hooks (`bs.onAttack` / `bs.onLandedHit` / the enemy variants) are
 * registered during the passive phase but fire during the action. They capture the
 * channel that was ambient at registration unless the hook supplies an explicit event
 * priority, so one proc can log its damage modifier under WEAPON and its debuff under
 * STATUS without hard-coding the passive's name into the logger.
 *
 * ORDERING
 * A round's events are grouped into BLOCKS, each starting at an ATTACK-priority
 * entry, and each block is stable-sorted by priority. Blocks keep their arrival
 * order, so attack #1 and attack #2 never interleave; within a block the ladder is:
 *
 *    ATTACK → weapon/armor/mob-skill → blessing/echo → deity
 *           → defensive reaction → reflect/counter → post-attack (lifesteal)
 *           → class → rune → status application/stack change
 *           → DOT → round end → DEFEAT
 *
 * The ladder mirrors what the resolver actually does inside one attack: the outgoing
 * modifiers scale the damage, the defender stack (guards, damage reduction, reflect)
 * consumes it, and only then do the landed-hit riders — lifesteal, the class passive,
 * on-hit status stacks — resolve against a target confirmed alive. That is why a
 * defensive reaction prints directly under the attack that caused it and above
 * Thorns/DOT in PvP too, rather than trailing the attacker's own status lines.
 *
 * The defeat message is finally hoisted to the very end of the round, so nothing can
 * ever print after it.
 *
 * Execution order is untouched: this module decides DISPLAY order only, and the
 * engine's own death checks — not the logger — are what stop effects being applied to
 * a dead target.
 */

/**
 * Source categories in resolution order. Values are spaced so a new category can be
 * slotted between two existing ones without renumbering.
 */
const LOG_PRIORITY = Object.freeze({
  /** The attack line itself. Also starts a new ordering block. */
  ATTACK: 10,
  /** Outgoing modifiers from equipment: weapons, relics, future gear effects. */
  WEAPON: 20,
  /** Equipped-armor passives (utility lines; reactions to a hit use DEFENSIVE). */
  ARMOR: 24,
  /** Mob/boss skill lines, which resolve on the player's perspective. */
  MOB_SKILL: 28,
  /** Deity blessing attack modifiers. */
  BLESSING: 30,
  /** Echo blessing modifiers (the weaker second blessing slot). */
  ECHO_BLESSING: 35,
  /** Deity passive effects that are not attack modifiers. */
  DEITY: 40,
  /**
   * Defensive reactions after the defender is hit (Phalanx Wall, guards, barriers).
   * Ranked here — above the landed-hit riders — because the defender stack is what
   * consumes the incoming damage, so its line belongs directly under the attack entry
   * and above Thorns/DOT.
   */
  DEFENSIVE: 45,
  /** Reflection and counterattacks (Thorns, Loki's counter, Dwarven Forge). */
  REFLECT: 48,
  /** Resolved-damage riders: lifesteal, stored-damage release, title effects. */
  POST_ATTACK: 52,
  /** Class passive application or stack update (Bleed, stun, pierce, overcharge…). */
  CLASS: 55,
  /** Socketed effect runes. */
  RUNE: 60,
  /** Status effect application or stack change (Burn/Poison/Freeze/DEF-down…). */
  STATUS: 70,
  /** Damage-over-time resolution. */
  DOT: 100,
  /** End-of-round bookkeeping (sudden death, expiry heals). */
  ROUND_END: 105,
  /** The defeat message. Always the final entry of the round. */
  DEFEAT: 120,
});

const PRIORITY_NAMES = Object.freeze(
  Object.fromEntries(Object.entries(LOG_PRIORITY).map(([k, v]) => [v, k]))
);

/**
 * DOT resolution order, shared by every mode so Poison/Burn/Bleed always tick — and
 * print — in the same sequence regardless of the order the debuffs were applied in.
 * Tags not listed sort after these and keep their mutual order.
 */
const DOT_RESOLUTION_ORDER = Object.freeze([
  'venom', 'poison', 'burn', 'bleed', 'thor_paralyze_dot', 'hp_pct_dot',
]);

/** Sort key for a DOT tag; unlisted tags sort last but stay mutually stable. */
function dotOrderIndex(tag) {
  const at = DOT_RESOLUTION_ORDER.indexOf(tag);
  return at < 0 ? DOT_RESOLUTION_ORDER.length : at;
}

/**
 * An append-only log of `{ text, priority, seq }`. Array-like enough for the engine's
 * existing slice/splice/length usage, but every entry knows where it belongs.
 */
class CombatLog {
  constructor(defaultChannel = LOG_PRIORITY.STATUS) {
    this.entries = [];
    this._seq = 0;
    this._channel = defaultChannel;
    this._defaultChannel = defaultChannel;
  }

  get length() { return this.entries.length; }

  /** The priority a bare string push is tagged with right now. */
  get channel() { return this._channel; }

  set channel(priority) { this._channel = priority; }

  /** Build a detached entry stamped with this log's sequence (for splice buffers). */
  entry(text, priority = this._channel) {
    return { text: String(text), priority, seq: this._seq++ };
  }

  /**
   * Append. Strings are tagged with the ambient channel; already-built entries keep
   * their own priority and sequence, so splicing a run out and pushing it back later
   * does not reclassify it.
   */
  push(...items) {
    for (const item of items) {
      if (item == null) continue;
      if (typeof item === 'object' && typeof item.text === 'string') {
        this.entries.push(item);
      } else {
        this.entries.push(this.entry(item));
      }
    }
    return this.entries.length;
  }

  /** Run `fn` with `priority` as the ambient channel, restoring it afterwards. */
  at(priority, fn) {
    const previous = this._channel;
    this._channel = priority;
    try {
      return fn();
    } finally {
      this._channel = previous;
    }
  }

  /** Wrap `fn` so it always runs under `priority` (used for deferred hooks). */
  bind(priority, fn) {
    return (...args) => this.at(priority, () => fn(...args));
  }

  slice(start, end) { return this.entries.slice(start, end); }

  splice(start, deleteCount) {
    return deleteCount === undefined
      ? this.entries.splice(start)
      : this.entries.splice(start, deleteCount);
  }

  /** Plain strings, in current storage order — the shape renderers consume. */
  texts() { return this.entries.map((e) => e.text); }
}

/**
 * Order one segment: split into blocks at each ATTACK entry, stable-sort every block
 * by priority. Blocks keep arrival order, so a primary attack and the additional
 * attack that follows it never trade modifiers.
 */
function orderEvents(entries) {
  const blocks = [];
  let current = [];
  for (const e of entries) {
    if (e.priority === LOG_PRIORITY.ATTACK && current.length) {
      blocks.push(current);
      current = [];
    }
    current.push(e);
  }
  if (current.length) blocks.push(current);

  const out = [];
  for (const block of blocks) {
    out.push(...block.slice().sort((a, b) => (a.priority - b.priority) || (a.seq - b.seq)));
  }
  return out;
}

/**
 * Last pass over a fully assembled round: the defeat message moves to the very end.
 * A battle resolves exactly one death, so this normally moves a single entry — but it
 * is written as a stable partition so a mode that ever logs two cannot reorder them.
 */
function finalizeRound(entries) {
  const body = [];
  const defeat = [];
  for (const e of entries) {
    (e.priority === LOG_PRIORITY.DEFEAT ? defeat : body).push(e);
  }
  return [...body, ...defeat];
}

/** Convenience: order every segment, finalize, flatten to the renderer's string array. */
function renderRound(segments) {
  const ordered = [];
  for (const segment of segments) ordered.push(...orderEvents(segment));
  return finalizeRound(ordered).map((e) => e.text);
}

module.exports = {
  LOG_PRIORITY,
  PRIORITY_NAMES,
  DOT_RESOLUTION_ORDER,
  dotOrderIndex,
  CombatLog,
  orderEvents,
  finalizeRound,
  renderRound,
};
