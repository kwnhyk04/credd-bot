'use strict';

/**
 * BATTLE ENGINE — CREDD BOT v4 (Phase 6)
 *
 * The pure combat resolver every battle feature (raid / duel / boss) calls.
 * PURITY CONTRACT: no DB, no Discord, no Math.random. All randomness comes from
 * one seeded stream (rngOf(seed), injectable for tests via opts.rng). Given the
 * same fighters + seed the result is byte-identical.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RNG DRAW ORDER (part of the contract — a seed fully determines a battle):
 *   PRE-BATTLE
 *     1. actor-order roll (1 draw; SKIPPED when the mob has special_flags.first_strike
 *        OR when mode === 'boss' — [v4.2] the player always acts first vs a boss, so no
 *        draw is consumed. first_strike (Sleipnir) is checked BEFORE the boss branch and
 *        still keeps the boss first. raid/duel always consume the order draw.)
 *   PER ROUND
 *     2. pre-rolls, in actor order, for each PLAYER-kind side:
 *        a. crit pre-roll (1 draw, ALWAYS — voided if the side is skip-CC'd; also voided,
 *           with the draw still consumed, on a Mage's overcharge round (every 3rd) where the
 *           entire attack cannot crit — §13.1)
 *        b. class-stun pre-roll (1 draw, only if class passive is 'stun')
 *     3. passive phase (registry-internal draws, in invocation order):
 *        raid/boss → A.weapon → A.deity → mob skill (all on A's perspective)
 *        duel      → first actor's weapon → deity, then second actor's weapon → deity
 *     4. actions in actor order:
 *        PLAYER attack: main-hit variance (1 draw) → [Swordsman] bleed draw (1, only
 *        when the main hit lands — RESERVED for stream stability; the bleed value is now
 *        a deterministic 3%/stack) → [labrys 2nd hit] crit (1) + variance (1) →
 *        [extra_turn] crit (1) + variance (1) + [Swordsman] bleed (1)
 *        MOB attack: per sub-hit → crit (1 draw) + variance (1 draw)
 *
 * ROUND PIPELINE (§35.1/§13.1, rulings R1–R9):
 *   round start → reset per-round scratch + derived flags → latch input flags
 *   (enemy_is_* / hit_received / player_was_critted) → determine skip-CC →
 *   pre-rolls (R1 latch: crit_landed_this_hit / stun_just_applied refer to THIS
 *   round's main hit) → passive phase (each passive exactly once per round; death
 *   check after every registry call) → consume hydra local regen / bathala HP flag →
 *   clear consumed latches → actions in actor order; after each side acts, its DOT
 *   ticks before the next side can act → stat-debuff expiry, sudden-death drain (round ≥ 30),
 *   snapshot per mode cadence. Hard cap round 50 (§35.3).
 *
 * LOG DISPLAY ORDER ([Jun-2026]): execution is UNCHANGED (passives resolve before the
 *   attacks to set up the hits), but each round's log is re-sequenced for readability to
 *   [attacks + their own DOT] → [passive procs] → [sudden-death], so a side's proc reads
 *   as the consequence shown after its attack. Only sim.rounds[].events ordering changes.
 *
 * SNAPSHOT CADENCE ([v4.2], mode-dependent — the renderer's edit loop consumes
 *   whatever arrives; the start + final snapshots are always present):
 *     duel/raid → rounds 1,4,16,…   boss → every 3rd round
 *
 * MAGE OVERCHARGE ([v4.2], §11/§13.1; [Jun-2026] stacks damage%): the charge accumulator
 *   is gone. On every 3rd round (rounds 3,6,9,…) the Mage's MAIN hit is ×(2.5 + damage%/100)
 *   ([v4.4] base was ×3) AND the entire attack's crit is suppressed (pre-roll latch voided,
 *   nextAttackAutoCrit ignored) — STRICT no-crit. The damage-% lane (weapon bonusDmgPct +
 *   procced damageBonusPct; e.g. a 200% proc → ×4.5) now stacks ADDITIVELY onto the 2.5
 *   base, and ATK-mult procs (Mjolnir) already fold in via effATK. Rider hits in the same
 *   action (Labrys 2nd, Glacial Bow extra) are NOT the overcharge attack — they keep fresh
 *   crit rolls and the normal multiplier.
 *   Skip-CC on a multiple of 3 → the action never runs → that overcharge is simply lost
 *   (no carry-over); the next fires on the next multiple of 3.
 *
 * DAMAGE PIPELINE (per hit) — ONE unified rule (§35.2 / config/combat):
 *   base = effATK × (1 − effDEF/(effDEF+200)) × variance(0.90–1.10)
 *   then exactly one multiplier:
 *     overcharge (Mage 3rd round): ×(2.5 + damage%/100), no crit (damage% stacks; ATK-mult via effATK)
 *     otherwise:                   ×((critLevel ? 2.0 : 1) + damage%/100)
 *   critLevel = a rolled crit OR a Double (Idiyanale, a guaranteed crit-level hit that DOES
 *   take the rider). damage% = weapon bonusDmgPct + procced sources (Katana +30, future
 *   deity blessings via scratch.damageBonusPct), summed additively, applied to crit AND
 *   non-crit. Supreme 50% → ×1.5 / ×2.5; Supreme + double → ×2.5; Supreme + deity 50% (proc)
 *   → ×2.0 / ×3.0. Mob "X% ATK" nukes are a clean ×(pct) and do
 *   not also crit. (+X% ATK riders scale effATK pre-mitigation — see playerAtkMult.)
 *   → floor → defender stack (R3) → apply → death check (§35.3 first-to-0, R5)
 *
 * DEFENDER STACK (R3, fixed order):
 *   player defender: negations (amihan → loki+counter → gridr → skjaldmaer; a fully
 *   evaded hit consumes nothing) → multiplicative reductions (heimdall 50% one-shot →
 *   athena 40% ×2 → odin 25% on even turns → steel kite 15% → pelte 25% → njord 30%) →
 *   ×(1 + Σ bonusIncomingDmgMult) → Knight ×0.80 → sidapa lethal reprieve →
 *   apply → reflects on FINAL applied damage (enderby 30% + Tyr 20% + Mayari 15%; skipped when
 *   the hit was lethal — R5).
 *   mob defender: sigbin evade (round-scoped) → dwarf stone-skin absorb (consumed).
 *
 * DEF_DOWN COMBINATION (R8): all def_down sources (the def_down debuff — itself
 * merged highest-value — and the Laevateinn stack) combine HIGHEST-WINS, never
 * multiplicatively. Armor pierce is a separate highest-wins lane, gated by
 * armor_pierce immunity (incl. Gungnir full pierce and Archer class pierce).
 */

const PASSIVE_REGISTRY = require('./passiveRegistry');
const { CRIT_MULT, OVERCHARGE_MULT, hitMultiplier } = require('../config/combat');

const MAX_ROUNDS = 50;
const SUDDEN_DEATH_FROM = 30;     // player sides lose 10% max HP at end of every round ≥ 30 (mobs/bosses exempt)
const SUDDEN_DEATH_PCT = 0.10;
const SNAPSHOT_EVERY = 3;
const MITIGATION_K = 200;         // §12: 1 − DEF/(DEF+200)
const ARCHER_PIERCE = 0.25;
const KNIGHT_DR = 0.80;
const INCOMING_DR_FLOOR = 0.25;   // [v5] combined damage-reduction floor: post-DEF incoming never < 25%
const TOTAL_EVADE_CAP = 0.40;     // [v5] total evade across all sources (enforced in the registry)
const OVERCHARGE_EVERY = 3;       // [v4.2] fires on rounds 3, 6, 9, …
const BLEED_PCT_PER_STACK = 0.03;
const BLEED_MAX_STACKS = 10;
const KNIGHT_OUTGOING_BONUS = 0.30;

const SKIP_TAGS = ['stun', 'paralyze', 'freeze', 'petrify', 'charm', 'confuse', 'miss'];
// thor_paralyze is a DOT (Thor's Mjolnir's Wrath) with a separate 10%/turn partial-skip
// rolled in act() — deliberately NOT a SKIP_TAG (those are a guaranteed 100% skip).
const DOT_TAGS = ['bleed', 'burn', 'hp_pct_dot', 'thor_paralyze'];
const DOT_DEATH_TEXT = {
  bleed: 'bleeding',
  burn: 'burning',
  hp_pct_dot: 'rot',
  thor_paralyze: 'paralysis',
};

const ACTION_TAG_LABELS = {
  bleed: 'Bleed', burn: 'Burn', hp_pct_dot: 'Rot', stun: 'Stun', freeze: 'Freeze',
  paralyze: 'Paralyze', petrify: 'Petrify', charm: 'Charm', confuse: 'Confuse',
  miss: 'Miss', def_down: 'DEF Down', atk_down: 'ATK Down', crit_down: 'CRIT Down',
  thor_paralyze: 'Paralysis', frostbite: 'Frostbite',
};

function actionState(side) {
  return {
    hp: side.hp,
    debuffs: side.debuffs.map((d) => ({ tag: d.tag, turnsLeft: d.turnsLeft, value: d.value })),
  };
}

function combatantName(side) {
  return String(side?.name || side?.in?.username || side?.in?.displayName || side?.in?.name || 'Combatant');
}

function actionNameForWeapon(name) {
  const n = String(name || '').toLowerCase();
  if (/bow|crossbow/.test(n)) return 'Arrow Volley';
  if (/staff|wand|caduceus/.test(n)) return 'Arcane Burst';
  if (/hammer|mjolnir/.test(n)) return 'Crushing Blow';
  if (/spear|trident|gungnir/.test(n)) return 'Piercing Thrust';
  if (/shield|aegis/.test(n)) return 'Shield Bash';
  if (/fist|knuckle|glove|jarngreipr/.test(n)) return 'Heavy Blow';
  if (/sword|blade|katana|cutlass|labrys|axe/.test(n)) return 'Blade Strike';
  return 'Battle Strike';
}

function passiveActionName(side, events) {
  const sources = [side.in.weaponName, side.in.deityName].filter(Boolean);
  for (let i = events.length - 1; i >= 0; i--) {
    for (const source of sources) {
      const marker = `${source}:`;
      const at = events[i].indexOf(marker);
      if (at < 0) continue;
      const action = events[i].slice(at + marker.length).split('—')[0].trim();
      if (action) return action;
    }
  }
  return null;
}

function damageFromEvents(side, events) {
  let damage = 0;
  let crit = false;
  let evaded = false;
  for (const event of events) {
    const isOwnHit = event.includes(`${side.name} attacks for **`) ||
      event.includes(`${side.name} strikes again for **`) ||
      event.includes(`${side.name} strikes for **`) ||
      event.includes(`${side.name} strikes (hit `);
    if (!isOwnHit) continue;
    const m = /for \*\*(\d+) DMG\*\*/.exec(event);
    if (m) damage += Number(m[1]);
    if (event.includes('CRIT!')) crit = true;
    if (event.includes('evaded')) evaded = true;
  }
  return { damage, crit, evaded };
}

function inflictedDebuffs(before, after) {
  const old = new Map(before.debuffs.map((d) => [d.tag, d]));
  return after.debuffs.filter((d) => {
    const prev = old.get(d.tag);
    return !prev || d.turnsLeft > prev.turnsLeft || Number(d.value) > Number(prev.value);
  });
}

/** Compact, structured turn text for layout-driven battle action boxes. */
function summarizeAction(side, opp, beforeSelf, beforeOpp, afterSelf, afterOpp, events) {
  const unable = events.some((e) => e.includes(`${side.name} is unable to act`));
  const hit = damageFromEvents(side, events);
  const effects = inflictedDebuffs(beforeOpp, afterOpp);

  let title;
  if (unable) title = 'Unable to act';
  else if (side.kind === 'mob') title = side.in.skillName || 'Enemy Strike';
  else title = `Casts ${passiveActionName(side, events) || actionNameForWeapon(side.in.weaponName)}`;

  const detail = [];
  if (hit.damage > 0) detail.push(`−${hit.damage.toLocaleString()} HP to ${opp.name}${hit.crit ? ' (CRIT)' : ''}`);
  else if (hit.evaded) detail.push('Attack evaded');

  for (const effect of effects.slice(0, 2)) {
    const label = ACTION_TAG_LABELS[effect.tag] || effect.tag.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    detail.push(`${label} inflicted (${effect.turnsLeft} turn${effect.turnsLeft === 1 ? '' : 's'})`);
  }

  const healed = Math.max(0, afterSelf.hp - beforeSelf.hp);
  if (healed > 0) detail.push(`+${healed.toLocaleString()} HP recovered`);
  if (unable && detail.length === 0) {
    const tags = beforeSelf.debuffs.filter((d) => SKIP_TAGS.includes(d.tag)).map((d) => d.tag);
    if (tags.length) detail.push(tags.join(', '));
  }
  if (detail.length === 0) detail.push('No damage dealt');

  return { title, detail: detail.join(' • ') };
}

function isPowerOfFourRound(round) {
  if (round < 1) return false;
  let n = round;
  while (n > 1 && n % 4 === 0) n /= 4;
  return n === 1;
}

/** Seeded LCG in [0,1). Same generator the renderer's replay relies on. */
function rngOf(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/**
 * Resolve a full battle.
 * @param {object} a  player fighter (statAssembly.buildPlayerFighter shape)
 * @param {object} b  mob fighter (raid/boss) or second player fighter (duel)
 * @param {object} opts { mode: 'raid'|'duel'|'boss', seed, rng? (test override) }
 * @returns {{ winner:'a'|'b', outcome:string, rounds:Array, snapshots:Array,
 *             a:object, b:object, seed:number, mode:string, totals:object }}
 */
function resolveBattle(a, b, opts = {}) {
  const mode = opts.mode || 'raid';
  const seed = (opts.seed != null ? opts.seed : Date.now()) >>> 0;
  const rng = opts.rng || rngOf(seed);

  // ── per-side battle state ─────────────────────────────────────────────────
  const initSide = (f, fallbackKind) => ({
    in: f,
    kind: f.kind || fallbackKind,
    name: f.name,
    hp: f.hp, maxHp: f.hp,
    atk: f.atk, def: f.def, crit: Number(f.crit) || 0,
    bonusDmgPct: Number(f.bonusDmgPct) || 0,   // unified damage % from the weapon (§35.2)
    classPassive: f.classPassive || null,
    weaponPassiveKey: f.weaponPassiveKey || 'none',
    armorPassiveKey: f.armorPassiveKey || 'none',   // [v5] equipped-armor passive
    deityBlessingKey: f.deityBlessingKey || 'none',
    echoBlessingKey: f.echoBlessingKey || 'none',
    skillKey: f.skillKey || 'none',
    immunityTags: Array.isArray(f.immunityTags) ? f.immunityTags : [],
    specialFlags: f.specialFlags || {},
    isBoss: f.mobType === 'boss',
    debuffs: [],            // [{tag, turnsLeft, value}]
    flags: {},              // durable bs.flags.* (docs/ENGINE_HOOKS.md)
    statusImmune: false,
    scratch: null,          // per-round (reset before passives)
    skipped: false,         // skip-CC'd this round
    critRollValue: 1,       // pre-rolled crit draw for this round's main hit
    stunPreRoll: 0,         // Fighter class stun turns rolled for this round (0/1/2)
    tookHitThisRound: false,
    tookHitLastRound: false,
    bathalaExtraHp: 0,      // currently-applied Bathala HP bonus
  });

  const A = initSide(a, 'player');
  const B = initSide(b, mode === 'duel' ? 'player' : 'mob');
  // Boss fights read the SHARED pool % (§35.4) — Phase 7 passes poolHp/poolMaxHp.
  if (b.poolMaxHp != null) B.maxHp = b.poolMaxHp;
  if (b.poolHp != null) B.hp = Math.min(b.poolHp, B.maxHp);

  // damageDealtToEnemy/enemyLocalRegen feed the boss net-damage rule;
  // damageDealtToPlayer is the symmetric A-side tally (pvp_logs opponent_damage).
  const totals = { damageDealtToEnemy: 0, damageDealtToPlayer: 0, enemyLocalRegen: 0, netDamage: 0 };
  const shared = { round: 0, events: [] };

  // ── HP mutation hub (totals accounting) ────────────────────────────────────
  const setHp = (side, v) => {
    const nv = Math.max(0, Math.min(Math.round(v), side.maxHp));
    const delta = nv - side.hp;
    side.hp = nv;
    if (side === B) {
      if (delta < 0) totals.damageDealtToEnemy += -delta;
      else if (delta > 0) totals.enemyLocalRegen += delta;
    } else if (delta < 0) {
      totals.damageDealtToPlayer += -delta;
    }
  };
  const damage = (side, amount) => setHp(side, side.hp - Math.max(0, Math.floor(amount)));
  const heal = (side, amount) => setHp(side, side.hp + Math.max(0, Math.floor(amount)));

  // ── debuff helpers (§13.1: refresh don't stack/extend; highest value wins) ─
  const findDebuff = (side, tag) => side.debuffs.find((d) => d.tag === tag);
  const debuffValue = (side, tag) => { const d = findDebuff(side, tag); return d ? d.value : 0; };
  const addDebuff = (side, tag, turns, value = 0) => {
    // Stuns never refresh while active, regardless of source. Once a stun expires,
    // every source also respects the one-round recovery window. Keeping this in the
    // central debuff path prevents Fighter + stun-deity combinations from bypassing
    // the class-level guard and producing a permanent lock.
    if (tag === 'stun') {
      if (findDebuff(side, 'stun')) return false;
      if (side.flags.stun_immune_until != null && shared.round <= side.flags.stun_immune_until) {
        return false;
      }
    }
    // [v5] armor defensive hooks on a player recipient (anting / salakot). Both run
    // at debuff-apply time so they catch CC from passives AND attacks. Existing fights
    // (no v5 armor) leave these flags falsy → byte-identical behavior.
    if (side.kind === 'player') {
      const immune = side.flags.immune_cc_types;
      if (Array.isArray(immune) && immune.includes(tag)) {
        shared.events.push(`🧿 ${side.name} is immune to ${ACTION_TAG_LABELS[tag] || tag} (Charmed Hide)!`);
        return false;
      }
      const negate = side.flags.salakot_negate_chance || 0;
      if (negate > 0 && rng() < negate) {
        shared.events.push(`🪬 ${side.name} negates an incoming ${ACTION_TAG_LABELS[tag] || tag} (Spirit Ward)!`);
        return false;
      }
    }
    const ex = findDebuff(side, tag);
    if (ex) {
      ex.turnsLeft = Math.max(ex.turnsLeft, turns);
      ex.value = Math.max(ex.value, value);
    } else {
      // Skip-CC applied this round is directional and gates the recipient's next
      // turn. It arms at round start, so it never cancels an action already due.
      side.debuffs.push({ tag, turnsLeft: turns, value, armed: false });
    }
    return true;
  };
  const sideImmune = (side, tag) => {
    if (side.kind !== 'mob') return false;
    if (side.isBoss && tag === 'hp_pct_dot') return true; // §35.4 auto-immunity
    return side.immunityTags.includes('all_debuffs') || side.immunityTags.includes(tag);
  };
  const tryApplyDebuff = (side, tag, turns, value = 0) => {
    if (sideImmune(side, tag)) return false;
    if (side.kind === 'player' && side.statusImmune) return false;
    return addDebuff(side, tag, turns, value);
  };
  const canApplyFighterStun = (target) => {
    if (sideImmune(target, 'stun')) return false;
    if (target.kind === 'player' && target.statusImmune) return false;
    if (findDebuff(target, 'stun')) return false;
    return target.flags.stun_immune_until == null || shared.round > target.flags.stun_immune_until;
  };

  // ── perspectives (the registry's bs view; docs/ENGINE_HOOKS.md contract) ──
  const makePerspective = (self, opp) => ({
    rng,
    get currentTurn() { return shared.round; },
    get playerATK() { return self.atk; },
    get playerHP() { return self.hp; },
    set playerHP(v) { setHp(self, v); },
    get playerMaxHP() { return self.maxHp; },
    get playerDEF() { return self.def; },
    get playerCrit() { return self.crit; },
    get enemyATK() { return opp.atk; },
    get enemyHP() { return opp.hp; },
    set enemyHP(v) { setHp(opp, v); },
    get enemyMaxHP() { return opp.maxHp; },
    get enemyDEF() { return opp.def; },
    get flags() { return self.flags; },
    get log() { return shared.events; },
    get playerStatusImmune() { return self.statusImmune; },
    set playerStatusImmune(v) { self.statusImmune = !!v; },
    // proc-granted damage % (Katana, future deity blessings) — summed with the weapon's
    // durable bonusDmgPct; resets each round (only active while the source procs). §35.2
    get damageBonusPct() { return self.scratch.damageBonusPct; },
    set damageBonusPct(v) { self.scratch.damageBonusPct = v; },
    get bonusIncomingDmgMult() { return self.scratch.bonusIncomingDmgMult; },
    set bonusIncomingDmgMult(v) { self.scratch.bonusIncomingDmgMult = v; },
    get playerAtkMult() { return self.scratch.playerAtkMult; },
    set playerAtkMult(v) { self.scratch.playerAtkMult = v; },
    get playerDefMult() { return self.scratch.playerDefMult; },
    set playerDefMult(v) { self.scratch.playerDefMult = v; },
    get ignoreDefPct() { return self.scratch.ignoreDefPct; },
    set ignoreDefPct(v) { self.scratch.ignoreDefPct = v; },
    get nextAttackAutoCrit() { return self.scratch.nextAttackAutoCrit; },
    set nextAttackAutoCrit(v) { self.scratch.nextAttackAutoCrit = v; },
    get nextAttackDouble() { return self.scratch.nextAttackDouble; },
    set nextAttackDouble(v) { self.scratch.nextAttackDouble = v; },
    enemyImmune: (tag) => sideImmune(opp, tag),
    applyDebuff: (tag, turns, value = 0) => tryApplyDebuff(opp, tag, turns, value),
    applyPlayerDebuff: (tag, turns, value = 0) => {
      if (self.statusImmune) return;
      addDebuff(self, tag, turns, value);
    },
    hasPlayerDebuff: (tag) => (tag === 'any' ? self.debuffs.length > 0 : !!findDebuff(self, tag)),
    clearPlayerDebuffs: () => { self.debuffs.length = 0; },
  });

  const PA = makePerspective(A, B);
  const PB = B.kind === 'player' ? makePerspective(B, A) : null;
  const perspectiveOf = (side) => (side === A ? PA : PB);
  const oppOf = (side) => (side === A ? B : A);

  // ── battle result ──────────────────────────────────────────────────────────
  let result = null; // { winner: 'a'|'b', outcome: string }
  const applyDefeatPassives = (winner) => {
    if (winner.kind !== 'player') return;
    if (winner.flags.soul_drain_active) {
      const before = winner.hp;
      heal(winner, winner.maxHp * 0.20);
      const restored = winner.hp - before;
      if (restored > 0) shared.events.push(`🌊 ${winner.name} claims the fallen soul and recovers ${restored} HP!`);
    }
    if (winner.weaponPassiveKey === 'spear_of_ares') {
      const before = winner.flags.spear_of_ares_stack || 0;
      winner.flags.spear_of_ares_stack = Math.min(0.40, before + 0.10);
      if (winner.flags.spear_of_ares_stack > before) {
        shared.events.push('🩸 Spear of Ares: Bloodlust — Defeat grants an immediate ATK stack!');
      }
    }
  };
  const win = (side, outcome) => {
    if (result) return;
    applyDefeatPassives(side);
    result = { winner: side === A ? 'a' : 'b', outcome };
  };
  /** Death check in causal order (§35.3 first-to-0). Returns true if battle over. */
  const checkDeaths = (outcome) => {
    if (result) return true;
    if (A.hp <= 0) { win(B, outcome); return true; }
    if (B.hp <= 0) { win(A, outcome); return true; }
    return false;
  };

  // ── effective stats ────────────────────────────────────────────────────────
  const effAtk = (S, extraAtkMult = 0) => {
    const mult = S.kind === 'player' ? S.scratch.playerAtkMult : 0;
    const classBonus = S.classPassive === 'damage_reduction' ? KNIGHT_OUTGOING_BONUS : 0;
    return Math.max(0, S.atk * (1 + mult + extraAtkMult + classBonus - debuffValue(S, 'atk_down')));
  };
  const effCritChance = (S) =>
    Math.max(0, S.crit * (1 - debuffValue(S, 'crit_down')));

  /** Defender's effective DEF vs attacker S (R8 def_down highest-wins; pierce gated). */
  const effDef = (S, O, { mainHit = false } = {}) => {
    let def = O.def;
    if (O.kind === 'player') {
      const shred = Math.max(debuffValue(O, 'def_down'), (S.flags.zeus_def_shred_stacks || 0) * 0.05);
      def *= Math.max(0, 1 + O.scratch.playerDefMult - shred);
    } else {
      def *= (S.flags.enemy_def_mult || 1.0);
      const shred = Math.max(
        debuffValue(O, 'def_down'),
        S.flags.laevateinn_sword_def_stack || 0,
        (S.flags.zeus_def_shred_stacks || 0) * 0.05
      );
      def *= Math.max(0, 1 - shred);
    }
    if (S.kind === 'player') {
      const pierceImmune = sideImmune(O, 'armor_pierce');
      if (!pierceImmune) {
        if (mainHit && S.flags.gungnir_full_pierce) return 0;
        let pierce = S.scratch.ignoreDefPct;
        if (S.classPassive === 'pierce') pierce = Math.max(pierce, ARCHER_PIERCE);
        if (mainHit && S.flags.crossbow_pierce) pierce = Math.max(pierce, 0.25);
        def *= Math.max(0, 1 - pierce);
      }
    }
    return Math.max(0, def);
  };

  const mitigated = (atkValue, defValue) =>
    atkValue * (1 - defValue / (defValue + MITIGATION_K));

  // ── defender stack (R3) ────────────────────────────────────────────────────
  /**
   * Apply one computed hit to the defender. Returns { applied, negated }.
   * info: { crit, attacker } — crit drives player_was_critted latch & reflects.
   */
  const recordReceivedCrit = (side) => {
    side.flags.player_was_critted = true;
    side.flags.player_crits_received = (side.flags.player_crits_received || 0) + 1;
    if (side.deityBlessingKey === 'vidar_silent_vengeance') {
      if (!side.flags.vidar_auto_crit_pending) {
        side.flags.vidar_auto_crit_pending = true;
        shared.events.push('⚔️ Vidar: Silent Vengeance — Auto-CRIT next attack!');
      }
      side.flags.vidar_crit_latch_handled = true;
    }
  };
  const armLowHpAttackPassives = (side) => {
    if (side.deityBlessingKey === 'vidar_silent_vengeance'
        && !side.flags.vidar_low_hp_used
        && side.hp < side.maxHp * 0.50) {
      side.flags.vidar_low_hp_used = true;
      side.flags.vidar_auto_crit_pending = true;
      shared.events.push('⚔️ Vidar: Silent Vengeance — Wounded! Guaranteed CRIT!');
    }
  };
  const applyHitToDefender = (S, O, dmg, info = {}) => {
    if (O.kind === 'mob') {
      // mob defenses live on the attacking player's flags (mob skills run there)
      if (S.flags.sigbin_evade_check && !S.flags.tyrfing_no_miss) {
        shared.events.push(`👤 ${O.name} evades the attack!`);
        return { applied: 0, negated: true };
      }
      if (S.flags.dwarf_shield_active) {
        const absorbed = Math.min(dmg, S.flags.dwarf_shield_cap || 0);
        dmg -= absorbed;
        S.flags.dwarf_shield_active = false;
        if (absorbed > 0) shared.events.push(`⛏️ ${O.name}'s Stone Skin absorbs ${absorbed} damage!`);
      }
      // Skadi: Frostbite amplifies all incoming damage on the frozen-then-thawed enemy.
      if (findDebuff(O, 'frostbite')) dmg *= 1.5;
      damage(O, dmg);
      checkDeaths('attack');
      return { applied: Math.floor(dmg), negated: false };
    }

    // player defender — negation rolls first (consume nothing on full evade, R3)
    const F = O.flags;
    if (F.amihan_evade_check && !S.flags.tyrfing_no_miss) {
      shared.events.push(`💨 ${O.name} evades the attack (Tailwind)!`);
      F.amihan_evade_bonus_stacks = (F.amihan_evade_bonus_stacks || 0) + 1;
      return { applied: 0, negated: true };
    }
    if (F.loki_evade_check && !S.flags.tyrfing_no_miss) {
      shared.events.push(`🃏 ${O.name} evades the attack (Illusory Double)!`);
      const counter = Math.max(0, Math.floor(F.loki_counter_dmg || 0));
      if (counter > 0) {
        damage(S, counter);
        shared.events.push(`🃏 Loki's counter strikes ${S.name} for ${counter} DMG!`);
        checkDeaths('counter');
      }
      return { applied: 0, negated: true };
    }
    if (F.gridr_ignore_check) {
      shared.events.push(`👊 ${O.name} ignores the incoming damage (Ironhide)!`);
      return { applied: 0, negated: true };
    }
    if (F.skjaldmaer_ignore_check) {
      shared.events.push(`🛡️ ${O.name} ignores the incoming damage (Shieldmaiden's Guard)!`);
      return { applied: 0, negated: true };
    }
    if (F.valkyrie_evade_check && !S.flags.tyrfing_no_miss) { // [v5] armor evade (total-evade cap enforced in the registry)
      shared.events.push(`🪽 ${O.name} evades the attack (Chooser's Grace)!`);
      return { applied: 0, negated: true };
    }

    // [v5] post-DEF baseline for the combined damage-reduction floor (computed below).
    const postDefDmg = dmg;

    // multiplicative reductions, fixed order (R3)
    if (F.heimdall_first_hit_available && !F.heimdall_first_hit_used) {
      dmg *= 0.5;
      F.heimdall_first_hit_used = true;
      F.heimdall_first_hit_available = false;
      shared.events.push(`👁️ Heimdall negates 50% of the first hit on ${O.name}!`);
    } else if (info.crit && F.heimdall_crit_guard) {
      // For the rest of the battle (after the first hit), incoming crits are cut by 30%.
      dmg *= 0.70;
      shared.events.push(`👁️ Heimdall blunts a critical hit on ${O.name} (-30%)!`);
    }
    if (F.athena_shield_active && (F.athena_hits_absorbed || 0) < 2) {
      dmg *= 0.6;
      F.athena_hits_absorbed = (F.athena_hits_absorbed || 0) + 1;
      if (F.athena_hits_absorbed >= 2) F.athena_shield_active = false;
      shared.events.push(`🛡️ Athena's Aegis absorbs 40% (${F.athena_hits_absorbed}/2)!`);
    } else if ((F.athena_hits_absorbed || 0) >= 2) {
      dmg *= 0.90;
      shared.events.push("🛡️ Athena's Aegis reduces the incoming hit by 10%!");
    }
    let odinDamageBefore = null;
    let afterOdinMultiplier = 1;
    if (F.odin_foresight_block) {
      odinDamageBefore = dmg;
      dmg *= 0.75;
    }
    const applyLaterReduction = (multiplier) => {
      dmg *= multiplier;
      if (odinDamageBefore != null) afterOdinMultiplier *= multiplier;
    };
    if (F.steel_kite_shield_block) applyLaterReduction(0.85);
    if (F.pelte_block_check) applyLaterReduction(1 - (F.pelte_block_pct || 0));
    if (F.njord_block_check) applyLaterReduction(1 - (F.njord_block_pct || 0));
    if (F.echo_njord_block_check) applyLaterReduction(1 - (F.echo_njord_block_pct || 0));

    applyLaterReduction(1 + O.scratch.bonusIncomingDmgMult);
    if (O.classPassive === 'damage_reduction') applyLaterReduction(KNIGHT_DR);
    // [v5] combined damage-reduction floor — no stack of reductions can cut a hit
    // below 25% of its post-DEF value (Blueprint 1.5 / Gear Overhaul §E).
    const drFloor = postDefDmg * INCOMING_DR_FLOOR;
    if (postDefDmg > 0 && dmg < drFloor) dmg = drFloor;
    dmg = Math.max(0, Math.floor(dmg));
    if (odinDamageBefore != null) {
      const withoutOdin = Math.max(0, Math.floor(Math.max(
        odinDamageBefore * afterOdinMultiplier,
        postDefDmg > 0 ? drFloor : 0
      )));
      const prevented = Math.max(0, withoutOdin - dmg);
      F.odin_prevented_damage = (F.odin_prevented_damage || 0) + prevented;
    }

    // sidapa lethal reprieve (once per battle): survive at 1 HP, then heal 30% max HP
    // and gain +50% ATK for the rest of the battle (folded into effATK by the registry).
    if (dmg >= O.hp && F.sidapa_reprieve_available && !F.sidapa_reprieve_used) {
      F.sidapa_reprieve_used = true;
      F.sidapa_reprieve_available = false;
      const applied = O.hp - 1;
      setHp(O, 1);
      const revive = Math.floor(O.maxHp * 0.30);
      setHp(O, Math.min(1 + revive, O.maxHp));
      F.sidapa_atk_bonus = 0.50;
      O.tookHitThisRound = true;
      if (info.crit) recordReceivedCrit(O);
      shared.events.push(`🌙 Sidapa's Death's Reprieve! ${O.name} survives, heals ${revive} HP, ATK +50%!`);
      return { applied, negated: false };
    }

    damage(O, dmg);
    O.tookHitThisRound = true;
    if (info.crit) recordReceivedCrit(O);
    if (O.hp > 0) armLowHpAttackPassives(O);

    if (checkDeaths('attack')) return { applied: dmg, negated: false }; // R5: lethal hit ends battle pre-reflect

    // reflects on the FINAL applied damage
    let reflectPct = 0;
    if (F.enderby_reflect_check) reflectPct += 0.30;
    if (F.tyr_reflect > 0) reflectPct += F.tyr_reflect;
    if (F.mayari_reflect > 0) reflectPct += F.mayari_reflect;
    if (F.mail_brokkr_reflect > 0) reflectPct += F.mail_brokkr_reflect; // [v5] Mail of Brokkr 15%
    if (F.rune_thorns_reflect > 0) reflectPct += F.rune_thorns_reflect; // [v5 Phase 2] Thorns rune
    if (reflectPct > 0 && dmg > 0) {
      const refl = Math.floor(dmg * reflectPct);
      if (refl > 0) {
        damage(S, refl);
        shared.events.push(`🔁 ${O.name} reflects ${refl} damage back at ${S.name}!`);
        checkDeaths('reflect');
      }
    }
    return { applied: dmg, negated: false };
  };

  /** Resolve effects whose final text says an attack/hit applies or rolls them. */
  const applyLandedHitPassives = (S, O) => {
    if (S.flags.laevateinn_staff_on_hit) {
      if (tryApplyDebuff(O, 'burn', 2, S.atk * 0.10)) {
        shared.events.push('🔥 Laevateinn Staff: Flickering Flame — Burn (10% ATK, 2 turns)!');
      }
    }
    if (S.flags.apolaki_on_hit) {
      if (tryApplyDebuff(O, 'burn', 1, S.atk * 0.10)) {
        shared.events.push('☀️ Apolaki: Solar Burn — Enemy scorched (10% ATK Burn)!');
      }
    }
    if (S.flags.surt_on_hit) {
      const nextStack = Math.min((S.flags.surt_burn_stack || 0) + 0.05, 0.30);
      if (tryApplyDebuff(O, 'burn', 2, S.atk * nextStack)) {
        S.flags.surt_burn_stack = nextStack;
        shared.events.push(`🔥 Surt: Muspell's Flame — Burn ${Math.round(nextStack * 100)}% ATK/turn!`);
      }
    }
    if (S.flags.thor_on_hit && rng() < 0.30) {
      const stunned = tryApplyDebuff(O, 'stun', 1);
      const paralyzed = tryApplyDebuff(O, 'thor_paralyze', 3, S.atk * 0.20);
      const effects = [stunned ? 'Stunned' : '', paralyzed ? 'Paralyzed (3 turns)' : ''].filter(Boolean);
      if (effects.length) shared.events.push(`⚡ Thor: Mjolnir's Wrath — Enemy ${effects.join(' & ')}!`);
    }
    if (S.flags.skadi_on_hit && rng() < 0.30) {
      if (tryApplyDebuff(O, 'freeze', 1)) {
        shared.events.push("❄️ Skadi: Winter's Hunt — Enemy Frozen!");
      }
    }
    if (S.flags.poseidon_on_hit && rng() < 0.30) {
      const stunned = tryApplyDebuff(O, 'stun', 1);
      const shredded = tryApplyDebuff(O, 'def_down', 2, 0.30);
      if (stunned || shredded) {
        const effects = [stunned ? 'Stunned' : '', shredded ? 'DEF -30% for 2 turns' : ''].filter(Boolean);
        shared.events.push(`🌊 Poseidon: Tidal Force — Enemy ${effects.join(' & ')}!`);
      }
    }
  };

  // ── player attack action ───────────────────────────────────────────────────
  const playerAttack = (S, O) => {
    // Durable "next attack" effects are consumed only when an attack actually begins.
    // A stun, freeze, charm, or Dizzy miss therefore cannot silently discard them.
    const amihanStacks = Math.max(0, Number(S.flags.amihan_evade_bonus_stacks) || 0);
    if (amihanStacks > 0) {
      S.scratch.playerAtkMult += amihanStacks * 0.20;
      S.flags.amihan_evade_bonus_stacks = 0;
      shared.events.push(`💨 Amihan: Tailwind — Evade momentum! ATK +${amihanStacks * 20}%!`);
    }
    if (S.flags.idiyanale_attack_bonus_pending) {
      S.scratch.playerAtkMult += S.flags.idiyanale_attack_bonus_pending;
      S.flags.idiyanale_attack_bonus_pending = 0;
    }
    if (S.flags.mimir_attack_bonus_pending) {
      S.scratch.playerAtkMult += S.flags.mimir_attack_bonus_pending;
      S.flags.mimir_attack_bonus_pending = 0;
    }
    if (S.flags.artemis_auto_crit_pending) {
      S.scratch.nextAttackAutoCrit = true;
      S.flags.artemis_auto_crit_pending = false;
      if (S.flags.artemis_first_attack_pending) {
        S.flags.artemis_first_attack_pending = false;
        S.flags.artemis_first_used = true;
      }
    }
    if (S.flags.vidar_auto_crit_pending) {
      S.scratch.nextAttackAutoCrit = true;
      S.flags.vidar_auto_crit_pending = false;
    }
    // Mage Overcharge: on every 3rd round the MAIN hit is ×(2.5 + damage%/100) ([v4.4] base
    // was ×3) AND the entire attack's crit is suppressed (pre-roll latch & nextAttackAutoCrit
    // both voided — STRICT no-crit). The damage-% lane stacks additively onto the 2.5 base
    // ([Jun-2026]); ATK-mult procs fold in earlier via effATK. Only the main hit qualifies —
    // rider hits later in the same action (Labrys 2nd, Glacial Bow extra) keep their own crit
    // rolls and the normal multiplier.
    const overchargeRound = S.classPassive === 'overcharge' && shared.round % OVERCHARGE_EVERY === 0;

    const doHit = ({ atkScale, mainHit, critKnown }) => {
      if (result) return;
      const def = effDef(S, O, { mainHit });
      let crit;
      if (critKnown != null) crit = critKnown;
      else crit = rng() * 100 < effCritChance(S); // secondary hits roll fresh
      const variance = 0.9 + rng() * 0.2;

      // Damage multiplier — ONE unified rule (§35.2 / config/combat). The damage-% bonus
      // (weapon bonusDmgPct + procced sources via scratch.damageBonusPct, e.g. Katana or a
      // deity) stacks additively and applies to BOTH crit and non-crit:
      //   hit = base × ((critLevel ? 2.0 : 1.0) + damage%/100)
      // Double (Idiyanale) is a GUARANTEED crit-level hit — same 2.0 base + damage%, so it
      // stacks with the rider (Supreme + double → ×2.5; Supreme + deity 50% + double → ×3.0).
      // Overcharge (Mage 3rd round) is its own lane: ×(2.5 + damage%/100), no crit.
      const overchargeFired = mainHit && overchargeRound;
      const doubled = mainHit && S.scratch.nextAttackDouble && !overchargeFired;
      const critApplied = crit && !overchargeFired && !doubled;
      const critLevel = critApplied || doubled; // double = guaranteed crit-level multiplier

      const surtVsBurning = Boolean(S.flags.surt_on_hit && findDebuff(O, 'burn'));
      let dmg = mitigated(effAtk(S, surtVsBurning ? 0.50 : 0) * atkScale, def) * variance;
      if (overchargeFired) {
        // [Jun-2026] Overcharge stacks the damage-% lane ADDITIVELY onto the ×2.5 base,
        // still with NO crit: e.g. a 200% damage-% proc → ×(2.5 + 2.0) = ×4.5. ATK-mult
        // procs (e.g. Mjolnir) already fold in earlier through effAtk. A plain Mage
        // (damage% 0) stays a clean ×2.5.
        const damagePct = S.bonusDmgPct + S.scratch.damageBonusPct;
        dmg *= OVERCHARGE_MULT + damagePct / 100;
      } else {
        const damagePct = S.bonusDmgPct + S.scratch.damageBonusPct;
        dmg *= hitMultiplier(critLevel, damagePct);
      }
      if (mainHit && S.flags.odin_foresight_bonus > 0) {
        const bonus = Math.floor(S.flags.odin_foresight_bonus);
        dmg += bonus;
        S.flags.odin_foresight_bonus = 0;
        shared.events.push(`🪄 Odin: All-Father's Foresight — released ${bonus} stored damage!`);
      }
      dmg = Math.max(0, Math.floor(dmg));

      const tag = overchargeFired ? ' *(Overcharge!)*'
        : doubled ? ' *(Double!)*'
        : critApplied ? ' *(CRIT!)*' : '';
      const res = applyHitToDefender(S, O, dmg, { crit: critApplied });
      shared.events.push(
        `⚔️ ${S.name} ${mainHit ? 'attacks' : 'strikes again'} for **${res.applied} DMG**` +
        `${tag}${res.negated ? ' *(evaded)*' : ''}`
      );
      if (!res.negated && surtVsBurning) {
        shared.events.push("🔥 Surt: Muspell's Flame — +50% vs a burning enemy!");
      }
      if (result) {
        // Magwayen drains every landed hit, including the blow that defeats the enemy.
        // Other on-hit riders remain below because they must not run after resolution.
        const attackerWon = result.winner === (S === A ? 'a' : 'b');
        if (attackerWon && res.applied > 0 && S.flags.soul_drain_active) {
          heal(S, res.applied * 0.15);
        }
        return;
      }

      // class on-hit effects (landed main hit only)
      if (mainHit && !res.negated) {
        if (S.flags.crossbow_pierce) S.flags.crossbow_pierce = false;
        if (S.classPassive === 'stun' && S.stunPreRoll > 0) {
          // Stun-lock guard: a new Fighter stun cannot be applied while the target is
          // already stunned or during the recovery round. addDebuff() enforces the same
          // rule centrally for every other stun source, so mixed passives cannot refresh it.
          if (canApplyFighterStun(O)) {
            const stunned = addDebuff(O, 'stun', S.stunPreRoll);
            if (stunned) {
              shared.events.push(`👊 ${S.name}'s blow stuns ${O.name} for ${S.stunPreRoll} turn${S.stunPreRoll > 1 ? 's' : ''}!`);
              const bash = Math.max(0, Math.floor(dmg * 0.50));
              const bashResult = applyHitToDefender(S, O, bash, { crit: false });
              shared.events.push(`💥 ${S.name} follows with Bash for **${bashResult.applied} DMG**!`);
              O.flags.dizzy_pending = true;
              shared.events.push(`💫 ${O.name} is Dizzy; its next attack has a 15% miss chance.`);
              if (result) return;
            }
          }
        }
      }
      if (!res.negated) applyLandedHitPassives(S, O);
      // Every landed Swordsman attack adds one 3% Bleed stack and refreshes it to 2 turns.
      // Ten stacks cap the additive value at 30%; later hits only refresh the duration.
      // Requires the swordsman to actually act — a skip-CC'd turn never reaches here.
      // The per-attack rng draw is KEPT (consumed, unused) for draw-order stream stability
      // now that the value is deterministic.
      if (S.classPassive === 'bleed' && !res.negated && !sideImmune(O, 'bleed')) {
        if (O.kind !== 'player' || !O.statusImmune) {
          rng(); // reserved draw — stream stability (bleed value is deterministic now)
          const ex = findDebuff(O, 'bleed');
          const stacks = Math.min(BLEED_MAX_STACKS, (ex && ex.stacks ? ex.stacks : 0) + 1);
          const value = stacks * BLEED_PCT_PER_STACK * S.atk;
          if (ex) { ex.turnsLeft = 2; ex.value = Math.max(ex.value, value); ex.stacks = stacks; }
          else O.debuffs.push({ tag: 'bleed', turnsLeft: 2, value, stacks, armed: false });
        }
      }
      // per-instance heals
      if (res.applied > 0) {
        if (S.flags.japanese_bo_active) heal(S, res.applied * 0.5);
        if (S.flags.soul_drain_active) heal(S, res.applied * 0.15);
        if (S.flags.echo_soul_drain_active) heal(S, res.applied * 0.05);
        if (S.flags.rune_lifesteal_pct > 0) heal(S, res.applied * S.flags.rune_lifesteal_pct);
      }
      if (mainHit && S.flags.gungnir_full_pierce) S.flags.gungnir_full_pierce = false;
    };

    // main hit (crit pre-rolled at round start; auto-crit flags can upgrade it) —
    // an overcharge round suppresses the crit entirely (§13.1), latch and all.
    const mainCrit = !overchargeRound
      && ((S.critRollValue * 100 < effCritChance(S)) || S.scratch.nextAttackAutoCrit);
    doHit({ atkScale: 1, mainHit: true, critKnown: mainCrit });
    if (result) return;

    // labrys 2nd hit (rider — both hits crit-eligible)
    if (S.flags.labrys_double_hit) {
      S.flags.labrys_double_hit = false;
      doHit({ atkScale: S.flags.labrys_second_hit_pct || 0.70, mainHit: false });
      if (result) return;
    }

    // post-attack burst procs (resolve even if the attack was evaded — they are
    // separate effects, not attack damage)
    if (S.flags.instakill_check) {
      S.flags.instakill_check = false;
      if (mode === 'duel') {
        shared.events.push('💀 Death Charm blocked: instant kill is disabled in duels.');
      } else if (O.isBoss) {
        shared.events.push('💀 Death Charm blocked: instant kill is disabled against bosses.');
      } else {
        shared.events.push(`💀 Death Charm! ${O.name} is instantly slain!`);
        setHp(O, 0);
        if (checkDeaths('instakill')) return;
      }
    }
    if (S.flags.rupture_check) {
      S.flags.rupture_check = false;
      if (!O.isBoss && !sideImmune(O, 'hp_pct_dot')) {
        const burst = Math.floor(O.maxHp * (S.flags.rupture_pct || 0));
        damage(O, burst);
        shared.events.push(`🌿 Rupture bursts ${O.name} for ${burst} DMG!`);
        if (checkDeaths('rupture')) return;
      }
    }
    if (S.flags.hemorrhage_check) {
      S.flags.hemorrhage_check = false;
      if (!O.isBoss && !sideImmune(O, 'hp_pct_dot')) {
        const burst = Math.floor(O.maxHp * (S.flags.hemorrhage_pct || 0));
        damage(O, burst);
        shared.events.push(`🏹 Hemorrhage tears ${O.name} for ${burst} DMG!`);
        if (checkDeaths('hemorrhage')) return;
      }
    }

    // extra turn rider (Glacial Bow) — one additional attack, same round, no
    // re-run of passives, riders already consumed, fresh crit roll
    if (S.flags.extra_turn) {
      S.flags.extra_turn = false;
      doHit({ atkScale: 1, mainHit: false });
    }
  };

  // ── mob attack action ──────────────────────────────────────────────────────
  const mobAttack = (S, O) => {
    // mob offense riders live on the defending player's flags (registry wrote them there)
    const F = O.flags;
    const subHits = Math.max(1, Number(S.specialFlags.multi_attack) || 1);
    const subPct = subHits > 1 ? Number(S.specialFlags.multi_attack_pct) || 1 : 1;
    const atkBase = F.enemy_atk_override != null
      ? F.enemy_atk_override
      : S.atk * (F.enemy_atk_mult || 1.0);

    // A "X% ATK" nuke round (enemy_atk_mult set by the mob skill) IS the mob's big hit —
    // it does not also crit-multiply, so a nuke stays a clean ×(pct) and never spikes to
    // ×4 (mirrors the player overcharge/double rule). Plain rounds still crit normally.
    const nukeRound = (F.enemy_atk_mult || 1) > 1;
    for (let i = 0; i < subHits && !result; i++) {
      const crit = rng() * 100 < S.crit;          // enemy authored crit, uncapped
      const critApplied = crit && !nukeRound;
      const variance = 0.9 + rng() * 0.2;
      let dmg = mitigated(atkBase * subPct, effDef(S, O)) * variance;
      if (i === 0) dmg += F.enemy_bonus_damage || 0;  // rider once per round (R4)
      if (critApplied) dmg *= CRIT_MULT;
      dmg = Math.max(0, Math.floor(dmg));
      const res = applyHitToDefender(S, O, dmg, { crit: critApplied });
      shared.events.push(
        `💀 ${S.name} strikes ${subHits > 1 ? `(hit ${i + 1}/${subHits}) ` : ''}for **${res.applied} DMG**` +
        `${critApplied ? ' *(CRIT!)*' : ''}${res.negated ? ' *(evaded)*' : ''}`
      );
    }
  };

  const act = (S) => {
    if (result) return;
    const O = oppOf(S);
    if (S.flags.tyrfing_no_miss) {
      const armedMisses = S.debuffs.filter((d) => d.tag === 'miss' && d.armed);
      if (armedMisses.length) {
        for (const debuff of armedMisses) debuff.turnsLeft -= 1;
        S.debuffs = S.debuffs.filter((d) => d.turnsLeft > 0);
        shared.events.push(`🗡️ ${S.name}'s Tyrfing curse overcomes Miss; the attack cannot miss.`);
      }
    }
    // Skip-CC gates only on ARMED tags. Existing CC arms at round start; new
    // skip-CC applied during this round gates the recipient's next turn.
    const skipTags = S.debuffs.filter((d) => SKIP_TAGS.includes(d.tag) && d.armed);
    if (skipTags.length > 0) {
      const hadStun = skipTags.some((d) => d.tag === 'stun');
      const hadFreeze = skipTags.some((d) => d.tag === 'freeze');
      for (const d of skipTags) d.turnsLeft -= 1;
      S.debuffs = S.debuffs.filter((d) => d.turnsLeft > 0);
      // On the round a stun wears off, grant a 1-round immunity window so the Fighter
      // class passive can't immediately re-chain it (see the stun-lock guard above).
      if (hadStun && !S.debuffs.some((d) => d.tag === 'stun')) {
        S.flags.stun_immune_until = shared.round + 1;
      }
      // Skadi: when a Freeze wears off the victim is left Frostbitten (+50% damage taken).
      // turnsLeft 2 so it reliably covers the next round's incoming attack ("1 turn").
      if (hadFreeze && !S.debuffs.some((d) => d.tag === 'freeze')) {
        addDebuff(S, 'frostbite', 2);
        shared.events.push(`🧊 ${S.name} is Frostbitten — takes +50% damage!`);
      }
      shared.events.push(`⏸️ ${S.name} is unable to act (${skipTags.map((d) => d.tag).join(', ')})!`);
      return;
    }
    // Thor: while Paralyzed (a DOT tag), a 10% chance each turn to skip the action. The
    // draw is taken only while the debuff is present (conditional, like Dizzy above).
    if (S.debuffs.some((d) => d.tag === 'thor_paralyze') && rng() < 0.10) {
      shared.events.push(`⚡ ${S.name} is paralyzed and cannot move!`);
      return;
    }
    if (S.flags.dizzy_pending) {
      S.flags.dizzy_pending = false;
      const misses = rng() < 0.15;
      if (misses && !S.flags.tyrfing_no_miss) {
        shared.events.push(`💫 ${S.name} misses its attack due to Dizzy!`);
        return;
      }
      shared.events.push(misses
        ? `🗡️ ${S.name}'s Tyrfing curse overcomes Dizzy; the attack cannot miss.`
        : `💫 ${S.name} overcomes Dizzy and attacks.`);
    }
    if (S.kind === 'player') playerAttack(S, O);
    else mobAttack(S, O);
  };

  // ── round-start bookkeeping ────────────────────────────────────────────────
  const resetScratch = (side) => {
    side.scratch = {
      damageBonusPct: 0,
      bonusIncomingDmgMult: 0,
      playerAtkMult: 0,
      playerDefMult: 0,
      ignoreDefPct: 0,
      nextAttackAutoCrit: false,
      nextAttackDouble: false,
    };
    // per-round DERIVED flags the registry re-establishes every round
    side.flags.enemy_bonus_damage = 0;
    side.flags.enemy_atk_mult = undefined;
    side.flags.enemy_def_mult = undefined;
    side.flags.enemy_atk_override = null;
    side.flags.bathala_hp_fraction = 0; // [Jun-2026 §4] registry re-sets the ramp each round
    // [v5] armor-derived per-round flags (the armor passive re-establishes them each round)
    side.flags.evade_chance_used = 0;
    side.flags.mail_brokkr_reflect = 0;
    side.flags.salakot_negate_chance = 0;
    side.flags.immune_cc_types = null;
    side.flags.valkyrie_evade_check = false;
    // [v5 Phase 2] socketed effect-rune per-round flags (the rune runner re-sets them).
    side.flags.rune_thorns_reflect = 0;
    side.flags.rune_warding_pct = 0;
    side.flags.rune_lifesteal_pct = 0;
    // input latches (engine-set, read by the registry this round)
    side.tookHitLastRound = side.tookHitThisRound;
    side.tookHitThisRound = false;
    side.flags.hit_received_this_turn = side.tookHitLastRound;
  };

  const setInputFlags = (side) => {
    const O = oppOf(side);
    side.flags.enemy_is_stunned = !!findDebuff(O, 'stun');
    side.flags.enemy_is_bleeding = !!findDebuff(O, 'bleed');
    side.flags.enemy_is_burning = !!findDebuff(O, 'burn');
  };

  const applyBathala = (side) => {
    // [Jun-2026 §4] HP ramps with the Bathala stack: target bonus = floor(base maxHP × frac),
    // where frac is the registry's per-round ramp (0.05 → 0.50). As the bonus grows, max AND
    // current HP rise together (heals as it ramps — patch assumption); if it ever shrinks,
    // current is re-clamped to the lowered max.
    const target = Math.floor(side.in.hp * (side.flags.bathala_hp_fraction || 0));
    const delta = target - side.bathalaExtraHp;
    if (delta !== 0) {
      side.maxHp += delta;
      side.bathalaExtraHp = target;
      setHp(side, side.hp + (delta > 0 ? delta : 0)); // grow heals; shrink just re-clamps
    }
  };

  const runRegistry = (key, perspective) => {
    if (result) return;
    const fn = PASSIVE_REGISTRY[key] || PASSIVE_REGISTRY.none;
    fn(perspective);
    checkDeaths('passive');
  };

  /**
   * [v5 Phase 2 §2.4] Apply a player's socketed EFFECT runes for this round. Runs
   * in the passive phase (after the armor passive, before actions) on the bearer's
   * perspective. Stat-% runes already folded into base stats at assembly — here we
   * only handle combat-effect families. Sums within a family across sockets:
   *   piercing → ignoreDefPct (highest-wins lane) · aegis_rune → incoming reduction
   *   thorns → reflect % · warding → incoming-DOT cut · vampiric → lifesteal %
   *   venom → on-hit flat Burn DOT (2 turns). No runes → no-op (byte-identical).
   */
  const applyRunes = (side, P) => {
    if (result) return;
    const runes = side.in.effectRunes;
    if (!Array.isArray(runes) || runes.length === 0) return;
    let pierce = 0, incoming = 0, thorns = 0, warding = 0, lifesteal = 0, venom = 0;
    for (const r of runes) {
      const v = Number(r.value) || 0;
      switch (r.effect_key) {
        case 'piercing':   pierce += v; break;
        case 'aegis_rune': incoming += v; break;
        case 'thorns':     thorns += v; break;
        case 'warding':    warding += v; break;
        case 'vampiric':   lifesteal += v; break;
        case 'venom':      venom = Math.max(venom, v); break; // refresh, highest-wins
        default: break;
      }
    }
    if (pierce > 0) P.ignoreDefPct = Math.max(P.ignoreDefPct, Math.min(pierce, 100) / 100);
    if (incoming > 0) P.bonusIncomingDmgMult += -(Math.min(incoming, 100) / 100);
    side.flags.rune_thorns_reflect = thorns / 100;
    side.flags.rune_warding_pct = Math.min(warding, 100) / 100;
    side.flags.rune_lifesteal_pct = lifesteal / 100;
    if (venom > 0) P.applyDebuff('burn', 2, P.playerATK * (venom / 100));
    checkDeaths('passive');
  };

  // ── snapshots ──────────────────────────────────────────────────────────────
  const snapSide = (side) => ({
    hp: side.hp,
    maxHp: side.maxHp,
    debuffs: side.debuffs.map((d) => ({ tag: d.tag, turnsLeft: d.turnsLeft })),
  });
  let lastActions = {
    a: { title: 'Ready', detail: 'Awaiting first action' },
    b: { title: 'Ready', detail: 'Awaiting first action' },
  };
  const snap = (round, tag = null) => ({
    round,
    a: snapSide(A),
    b: snapSide(B),
    actions: { a: { ...lastActions.a }, b: { ...lastActions.b } },
    ...(tag ? { tag } : {}),
  });
  const snapshots = [snap(0, 'start')];

  // ── actor order ────────────────────────────────────────────────────────────
  let aFirst;
  if (B.specialFlags.first_strike) {
    aFirst = false; // Sleipnir: boss takes the very first action (checked before mode, no roll)
  } else if (A.specialFlags.first_strike) {
    aFirst = true;
  } else if (mode === 'boss') {
    aFirst = true;  // [v4.2] player ALWAYS attacks first vs a boss — no order draw consumed
  } else {
    aFirst = rng() < 0.5; // raid/duel keep the 50/50 roll
  }
  const order = aFirst ? [A, B] : [B, A];

  // ── main loop ──────────────────────────────────────────────────────────────
  const rounds = [];
  for (let round = 1; round <= MAX_ROUNDS && !result; round++) {
    shared.round = round;
    shared.events = [];
    const actionStartA = actionState(A);
    const actionStartB = actionState(B);

    const captureActions = () => {
      const actionEndA = actionState(A);
      const actionEndB = actionState(B);
      lastActions = {
        a: summarizeAction(A, B, actionStartA, actionStartB, actionEndA, actionEndB, shared.events),
        b: summarizeAction(B, A, actionStartB, actionStartA, actionEndB, actionEndA, shared.events),
      };
    };
    const captureActionFor = (actor) => {
      const actionEndA = actionState(A);
      const actionEndB = actionState(B);
      if (actor === A) {
        lastActions.a = summarizeAction(A, B, actionStartA, actionStartB, actionEndA, actionEndB, shared.events);
      } else {
        lastActions.b = summarizeAction(B, A, actionStartB, actionStartA, actionEndB, actionEndA, shared.events);
      }
    };
    const tickDotsForSide = (side) => {
      if (result) return;
      for (const d of side.debuffs) {
        if (!DOT_TAGS.includes(d.tag)) continue;
        let tick = d.tag === 'hp_pct_dot'
          ? Math.floor(side.maxHp * d.value)
          : Math.floor(d.value);
        // [v5 Phase 2] Warding rune reduces incoming DOT damage on the bearer.
        if (side.flags.rune_warding_pct > 0) tick = Math.floor(tick * (1 - side.flags.rune_warding_pct));
        if (tick > 0) {
          damage(side, tick);
          const name = combatantName(side);
          shared.events.push(`🩸 ${name} suffers ${tick} ${ACTION_TAG_LABELS[d.tag] || 'DOT'} damage!`);
          if (checkDeaths('dot')) {
            shared.events.push(`💀 ${name} died from ${DOT_DEATH_TEXT[d.tag] || 'damage'}!`);
            break;
          }
        }
        d.turnsLeft -= 1;
      }
      side.debuffs = side.debuffs.filter((d) => !DOT_TAGS.includes(d.tag) || d.turnsLeft > 0);
    };

    // 1. round start: scratch + latches
    for (const side of order) resetScratch(side);
    for (const side of order) setInputFlags(side);
    // [Jun-2026 §2] ARM the skip-CC carried in from PREVIOUS rounds. Only an armed CC gates
    // an action this round; CC procced later this round (passive phase / the opponent's
    // attack) stays unarmed → it can't cancel an action already due, and can't deadlock two
    // opposing CC passives. side.skipped (armed CC present) voids this side's pre-rolls.
    for (const side of order) {
      let armedCC = false;
      for (const d of side.debuffs) {
        if (SKIP_TAGS.includes(d.tag)) { d.armed = true; armedCC = true; }
      }
      side.skipped = armedCC;
    }
    // 2. pre-rolls (R1) — always drawn for stream stability, voided when skip-CC'd
    for (const side of order) {
      if (side.kind !== 'player') continue;
      const O = oppOf(side);
      side.critRollValue = rng();
      // [v4.2] a Mage's overcharge round (every 3rd) suppresses the crit entirely, so
      // the latch reads false even though the draw is consumed (stream stability).
      const overchargeRound = side.classPassive === 'overcharge' && round % OVERCHARGE_EVERY === 0;
      side.flags.crit_landed_this_hit =
        !side.skipped && !overchargeRound && side.critRollValue * 100 < effCritChance(side);
      if (side.classPassive === 'stun') {
        const r = rng();
        side.stunPreRoll = side.skipped ? 0 : (r < 0.10 ? 2 : (r < 0.25 ? 1 : 0));
        side.flags.stun_just_applied = side.stunPreRoll > 0 && canApplyFighterStun(O);
      } else {
        side.stunPreRoll = 0;
        side.flags.stun_just_applied = false;
      }
    }

    // 3. passive phase — each active passive exactly once per round (§35.1)
    const passiveEvents = new Map([[A, []], [B, []]]);
    const collectPassiveEvents = (side, fn) => {
      const start = shared.events.length;
      fn();
      if (shared.events.length > start) {
        passiveEvents.get(side).push(...shared.events.slice(start));
      }
    };
    if (mode === 'duel') {
      for (const side of order) {
        const P = perspectiveOf(side);
        collectPassiveEvents(side, () => runRegistry(side.weaponPassiveKey, P));
        collectPassiveEvents(side, () => runRegistry(side.deityBlessingKey, P));
        collectPassiveEvents(side, () => runRegistry(side.echoBlessingKey, P));  // [v5 Phase 3] echo blessing
        collectPassiveEvents(side, () => runRegistry(side.armorPassiveKey, P));
        collectPassiveEvents(side, () => applyRunes(side, P));
      }
    } else {
      collectPassiveEvents(A, () => runRegistry(A.weaponPassiveKey, PA));
      collectPassiveEvents(A, () => runRegistry(A.deityBlessingKey, PA));
      collectPassiveEvents(A, () => runRegistry(A.echoBlessingKey, PA));      // [v5 Phase 3] echo blessing
      collectPassiveEvents(A, () => runRegistry(A.armorPassiveKey, PA));
      collectPassiveEvents(A, () => applyRunes(A, PA));
      collectPassiveEvents(B, () => runRegistry(B.skillKey, PA));
    }
    // consume hydra local regen (local mirror only — never the shared pool)
    if (!result && A.flags.hydra_local_regen > 0) {
      heal(B, A.flags.hydra_local_regen);
      A.flags.hydra_local_regen = 0;
    }
    for (const side of order) if (side.kind === 'player') applyBathala(side);
    for (const side of order) {
      side.flags.player_was_critted = false; // latches consumed by deity/echo passives
      side.flags.player_crits_received = 0;
    }
    if (result) {
      captureActions();
      rounds.push({ round, events: shared.events, actions: lastActions });
      break;
    }

    // 4. actions
    const procEnd = shared.events.length; // events so far = this round's passive procs
    let act1DotStart = -1;                 // index where actor 1's post-action DOT begins
    let act2Start = -1;                    // index where the SECOND actor's segment begins
    let act2DotStart = -1;                 // index where actor 2's post-action DOT begins
    for (let oi = 0; oi < order.length; oi++) {
      const actor = order[oi];
      act(actor);
      captureActionFor(actor);
      if (oi === 0) act1DotStart = shared.events.length;
      else if (oi === 1) act2DotStart = shared.events.length;
      tickDotsForSide(actor);
      if (oi === 0) act2Start = shared.events.length; // close the first actor's segment
      if (result) break;
    }
    const actionEnd = shared.events.length; // procEnd..actionEnd = attack + action-DOT events

    // 5. end of round
    if (!result) {
      // 1-turn stat debuffs expire at end of round (§35.1)
      for (const side of order) {
        for (const d of side.debuffs) {
          if (!DOT_TAGS.includes(d.tag) && !SKIP_TAGS.includes(d.tag)) d.turnsLeft -= 1;
        }
        side.debuffs = side.debuffs.filter((d) => d.turnsLeft > 0);
      }
      // sudden death (§35.3): drain only hits player (user) sides — mobs and bosses are
      // exempt, so in PvE the user bleeds out while the enemy does not; a PvP duel has two
      // player sides, so both users still drain. Both dead → mob/challenged wins (R5).
      if (!result && round >= SUDDEN_DEATH_FROM) {
        const drained = [];
        for (const side of [A, B]) {
          if (side.kind !== 'player') continue;
          const drain = Math.floor(side.maxHp * SUDDEN_DEATH_PCT);
          damage(side, drain);
          drained.push(`${side.name} -${drain}`);
        }
        if (drained.length) {
          const who = drained.length > 1 ? 'Both combatants lose' : 'The challenger loses';
          shared.events.push(`☠️ Sudden death! ${who} 10% max HP (${drained.join(', ')}).`);
          if (A.hp <= 0 && B.hp <= 0) win(B, 'sudden_death');
          else checkDeaths('sudden_death');
        }
      }
    }

    // [Phase 6] Log DISPLAY order only (execution is unchanged — passives still resolve
    // before the attacks to set up the hits). Interleave per the per-turn template:
    //   [actor-1 attack + weapon procs/reactive] → [actor-1 passive logs] →
    //   [actor-1 DOT] → [actor-2 attack + dodge/thorns] → [actor-2 passive logs] →
    //   [actor-2 DOT] → [sudden death].
    // Weapon procs, dodge/evade and reflect are pushed inside each actor's own segment,
    // so they stay attached to the right attack. Registry logs are grouped by owner.
    const seg2 = act2Start < 0 ? actionEnd : act2Start;
    const seg1Dot = act1DotStart < 0 ? seg2 : act1DotStart;
    const seg2Dot = act2DotStart < 0 ? actionEnd : act2DotStart;
    const actor1 = order[0];
    const actor2 = order[1];
    shared.events = [
      ...shared.events.slice(procEnd, seg1Dot),  // actor 1: attack + weapon procs + reactive
      ...(passiveEvents.get(actor1) || []),       // actor 1: weapon/deity/skill/rune logs
      ...shared.events.slice(seg1Dot, seg2),     // actor 1: post-action DOT
      ...shared.events.slice(seg2, seg2Dot),     // actor 2: attack + dodge/thorns
      ...(passiveEvents.get(actor2) || []),       // actor 2: weapon/deity/skill/rune logs
      ...shared.events.slice(seg2Dot, actionEnd), // actor 2: post-action DOT
      ...shared.events.slice(actionEnd),         // sudden death
    ];
    rounds.push({ round, events: shared.events, actions: lastActions });
    // [v4.8] snapshot cadence is mode-dependent: raid + duel snapshot on rounds 1,4,16,…
    // (multiplying the previous snapshot turn by 4), boss every 3rd (3,6,9…).
    // The start + final snapshots are always present regardless.
    const snapDue = (mode === 'duel' || mode === 'raid')
      ? isPowerOfFourRound(round)
      : round % SNAPSHOT_EVERY === 0;
    if (!result && snapDue) {
      snapshots.push(snap(round));
    }
  }

  // hard cap round 50 (§35.3)
  let outcome;
  if (result) {
    outcome = result.outcome;
  } else if (mode === 'boss') {
    result = { winner: 'b', outcome: 'boss_timeout' }; // "timeout, survived" — damage committed
    outcome = 'boss_timeout';
  } else {
    const pctA = A.hp / A.maxHp;
    const pctB = B.hp / B.maxHp;
    result = { winner: pctA > pctB ? 'a' : 'b', outcome: 'cap_hp_pct' }; // tie → mob/challenged
    outcome = 'cap_hp_pct';
  }

  snapshots.push(snap(rounds.length, 'end'));
  totals.netDamage = Math.max(0, totals.damageDealtToEnemy - totals.enemyLocalRegen);

  const summary = (side) => ({
    name: side.name,
    kind: side.kind,
    cls: side.kind === 'player' ? (side.in.class || '') : (side.in.mobType || 'mob'),
    level: side.in.level,
    weapon: side.in.weaponName || null,
    armor: side.kind === 'player' ? (side.in.armorName || null) : null, // [v5] equipped armor
    deity: side.in.deityName || null,
    // mob/boss passive skill name + description for the render (null for players)
    skill: side.kind === 'player' ? null : (side.in.skillName || null),
    skillDesc: side.kind === 'player' ? null : (side.in.skillDescription || null),
    atk: side.atk, def: side.def, crit: side.crit,
    hp: side.hp, maxHp: side.maxHp,
  });

  return {
    winner: result.winner,
    outcome,
    rounds,
    snapshots,
    a: summary(A),
    b: summary(B),
    seed,
    mode,
    playerFirst: aFirst,
    totals,
  };
}

module.exports = {
  resolveBattle,
  rngOf,
  MAX_ROUNDS,
  SUDDEN_DEATH_FROM,
  SNAPSHOT_EVERY,
};
