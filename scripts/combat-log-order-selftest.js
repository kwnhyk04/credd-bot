'use strict';

/**
 * COMBAT LOG ORDER SELFTEST
 *
 * Locks the display contract of the shared event-priority pipeline
 * (src/engine/combatLog.js) as it is driven by the one combat resolver
 * (src/engine/battleEngine.resolveBattle) that raid / PvE / elite / boss / duel /
 * ranked all call.
 *
 * The assertions are deliberately written against CATEGORIES and POSITIONS rather
 * than any single passive's implementation, because the point of the pipeline is
 * that ordering follows a passive's source category, never its name.
 *
 * Run: node scripts/combat-log-order-selftest.js
 */

const path = require('path');
const ROOT = path.join(__dirname, '..');
const { resolveBattle } = require(path.join(ROOT, 'src', 'engine', 'battleEngine'));
const {
  LOG_PRIORITY, CombatLog, orderEvents, finalizeRound, DOT_RESOLUTION_ORDER,
} = require(path.join(ROOT, 'src', 'engine', 'combatLog'));

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function section(title) { console.log(`\n── ${title} ──`); }

// ── fixtures (same shape as battle-selftest) ────────────────────────────────
const player = (over = {}) => Object.assign({
  name: 'Hero', kind: 'player', class: 'Knight', classPassive: 'damage_reduction',
  level: 50, atk: 300, hp: 2000, def: 150, crit: 20,
  bonusDmgPct: 0,
  weaponPassiveKey: 'none', weaponName: 'Test Blade',
  armorPassiveKey: 'none', armorName: null,
  deityBlessingKey: 'none', deityName: null,
  echoBlessingKey: 'none',
}, over);

const mob = (over = {}) => Object.assign({
  name: 'Dummy', kind: 'mob', mobType: 'regular', level: 10,
  atk: 100, hp: 3000, def: 80, crit: 0,
  skillKey: 'none', immunityTags: [], specialFlags: {},
}, over);

const allEvents = (sim) => sim.rounds.flatMap((r) => r.events);
const roundEvents = (sim, n) => (sim.rounds.find((r) => r.round === n) || { events: [] }).events;
const indexOfEvent = (events, frag) => events.findIndex((e) => e.includes(frag));
const countEvents = (events, frag) => events.filter((e) => e.includes(frag)).length;

/** Any attack line: player ("attacks" / "strikes again" / Auto-Fire / Bash) or mob ("strikes"). */
const isAttackLine = (e) => /(attacks|strikes|Auto-Fire triggered|follows with Bash)/.test(e);
/** A line from a category that must never outrank a defensive reaction. */
const isPostHitLine = (e) => /(reflects|suffers|ticks for|defeated by)/.test(e);

/**
 * Assert every occurrence of `frag` belongs to the attack block that triggered it: it
 * follows an attack line with only that attack's own outgoing modifiers in between —
 * never a reflect, DOT or defeat line. Returns a failure string, or null when it holds.
 *
 * This cannot be a literal index+1 check, because the attacker's own weapon/blessing
 * modifiers legitimately sit between the attack entry and the defender's reaction.
 * What must hold is that nothing from a LATER category gets in front of it.
 */
function followsAnAttack(sim, frag) {
  for (const round of sim.rounds) {
    const at = round.events.findIndex((e) => e.includes(frag));
    if (at < 0) continue;
    const before = round.events.slice(0, at);
    const attackAt = before.map(isAttackLine).lastIndexOf(true);
    if (attackAt < 0) return `round ${round.round}: no attack line precedes "${round.events[at]}"`;
    const intruder = before.slice(attackAt + 1).find(isPostHitLine);
    if (intruder) return `round ${round.round}: "${intruder}" precedes "${round.events[at]}"`;
  }
  return null;
}

/**
 * The reference build: a Swordsman (class Bleed) carrying Bloodhunter (weapon
 * outgoing-damage modifier), Surt's Muspell's Flame (blessing modifier + Burn stack)
 * and Hoplite Panoply (Phalanx Wall) — exactly the combination in the bug report.
 */
const referenceHero = (over = {}) => player({
  name: 'Swordy',
  class: 'Swordsman',
  classPassive: 'bleed',
  atk: 900, hp: 20_000, def: 200, crit: 100,
  weaponPassiveKey: 'juru_pakal', weaponName: 'Bloodhunter',
  deityBlessingKey: 'surt_muspells_flame', deityName: 'Surt',
  armorPassiveKey: 'hoplite_panoply', armorName: 'Hoplite Panoply',
  ...over,
});

// ═══════════════════════════════════════════════════════════════════════════
section('1. Unit — priority pipeline');

{
  const log = new CombatLog();
  // Pushed out of display order on purpose, exactly as the engine produces them
  // (passives resolve before the attack, defensive reactions during it).
  log.at(LOG_PRIORITY.STATUS, () => log.push('status'));
  log.at(LOG_PRIORITY.WEAPON, () => log.push('weapon'));
  log.at(LOG_PRIORITY.ATTACK, () => log.push('attack'));
  log.at(LOG_PRIORITY.BLESSING, () => log.push('blessing'));
  log.at(LOG_PRIORITY.CLASS, () => log.push('class'));
  const ordered = orderEvents(log.slice(0)).map((e) => e.text);
  // Entries before the first ATTACK form their own block (they belong to whatever
  // came earlier in the round), then the attack opens a block and its modifiers sort
  // under it in category order: weapon → blessing → class.
  check('modifiers sort under the attack in category order',
    ordered.join(',') === 'weapon,status,attack,blessing,class', ordered.join(','));
  // The defender stack consumes the hit before any landed-hit rider resolves, so its
  // line must outrank reflect, the class passive and on-hit status in BOTH PvE and PvP.
  check('defensive reaction outranks reflect, class and status (engine resolution order)',
    LOG_PRIORITY.DEFENSIVE < LOG_PRIORITY.REFLECT
    && LOG_PRIORITY.DEFENSIVE < LOG_PRIORITY.CLASS
    && LOG_PRIORITY.DEFENSIVE < LOG_PRIORITY.STATUS
    && LOG_PRIORITY.REFLECT < LOG_PRIORITY.DOT);
}

{
  // Two attacks must not trade modifiers: each ATTACK entry opens a new block.
  const log = new CombatLog();
  log.at(LOG_PRIORITY.ATTACK, () => log.push('attack-1'));
  log.at(LOG_PRIORITY.WEAPON, () => log.push('weapon-1'));
  log.at(LOG_PRIORITY.ATTACK, () => log.push('attack-2'));
  log.at(LOG_PRIORITY.WEAPON, () => log.push('weapon-2'));
  const ordered = orderEvents(log.slice(0)).map((e) => e.text);
  check('each attack opens its own ordering block',
    ordered.join(',') === 'attack-1,weapon-1,attack-2,weapon-2', ordered.join(','));
}

{
  const log = new CombatLog();
  log.at(LOG_PRIORITY.DEFEAT, () => log.push('defeat'));
  log.at(LOG_PRIORITY.WEAPON, () => log.push('weapon'));
  const ordered = finalizeRound(orderEvents(log.slice(0))).map((e) => e.text);
  check('finalizeRound hoists the defeat message to the very end',
    ordered[ordered.length - 1] === 'defeat', ordered.join(','));
}

{
  // Equal priority keeps arrival order — the sort must be STABLE, or two procs from
  // the same source could shuffle between runs of the same seed.
  const log = new CombatLog();
  log.at(LOG_PRIORITY.WEAPON, () => log.push('w1', 'w2', 'w3'));
  const ordered = orderEvents(log.slice(0)).map((e) => e.text);
  check('same-priority events keep arrival order (stable sort)',
    ordered.join(',') === 'w1,w2,w3', ordered.join(','));
}

{
  const hookLog = new CombatLog();
  // A hook registered under WEAPON must still log as WEAPON when it fires later,
  // even though the ambient channel has moved on to the attack by then.
  const hook = hookLog.bind(LOG_PRIORITY.WEAPON, () => hookLog.push('queued weapon proc'));
  hookLog.at(LOG_PRIORITY.ATTACK, () => { hookLog.push('attack'); hook(); });
  const priorities = hookLog.slice(0).map((e) => e.priority);
  check('deferred hooks keep their registration category',
    priorities[1] === LOG_PRIORITY.WEAPON, JSON.stringify(priorities));
}

check('DOT resolution order is Poison → Burn → Bleed',
  DOT_RESOLUTION_ORDER.indexOf('poison') < DOT_RESOLUTION_ORDER.indexOf('burn')
  && DOT_RESOLUTION_ORDER.indexOf('burn') < DOT_RESOLUTION_ORDER.indexOf('bleed'),
  DOT_RESOLUTION_ORDER.join(' → '));

// ═══════════════════════════════════════════════════════════════════════════
section('2. Phalanx Wall — one line per incoming hit');

{
  // A tanky hero against a live attacker, so several incoming hits land.
  const sim = resolveBattle(
    player({
      name: 'Wall', hp: 60_000, atk: 40, def: 200, crit: 0,
      armorPassiveKey: 'hoplite_panoply', armorName: 'Hoplite Panoply',
      class: 'Swordsman', classPassive: 'none',
    }),
    mob({ name: 'Ogre', hp: 400_000, atk: 900, def: 100 }),
    { mode: 'raid', seed: 11 },
  );
  const events = allEvents(sim);
  const first = countEvents(events, 'first hit absorbed, damage reduced by 50%');
  const armed = countEvents(events, 'first-hit guard armed');
  const base = countEvents(events, 'Phalanx Wall — damage taken reduced by 20%');

  // CASE 1 — the first Phalanx Wall hit logs ONLY the combined 50%.
  check('first Phalanx hit logs the combined 50% exactly once', first === 1, `count=${first}`);
  check('the old "first-hit guard armed" line is gone', armed === 0, `count=${armed}`);

  const r1 = roundEvents(sim, 1);
  const r1Has20 = r1.some((e) => e.includes('damage taken reduced by 20%'));
  const r1Has50 = r1.some((e) => e.includes('reduced by 50%'));
  check('the 20% line does NOT also print on the first-hit round',
    r1Has50 && !r1Has20, `50%=${r1Has50} 20%=${r1Has20}`);

  // CASE 2 — every later hit logs ONLY the base 20%.
  check('later Phalanx hits log the base 20%', base >= 1, `count=${base}`);

  // The defensive line must sit directly under the attack that triggered it and
  // above Thorns / DOT — asserted by POSITION, not by passive name.
  const adjacency = followsAnAttack(sim, 'Phalanx Wall');
  check('Phalanx Wall always belongs to the attack block that triggered it',
    adjacency === null, adjacency);
}

// ═══════════════════════════════════════════════════════════════════════════
section('3. Attack-modifier ordering');

{
  const sim = resolveBattle(
    referenceHero(),
    mob({ name: 'Ogre', hp: 400_000, atk: 400, def: 100 }),
    { mode: 'raid', seed: 7 },
  );

  // CASE 3 — the weapon's outgoing-damage modifier sits immediately after the attack.
  const r1 = roundEvents(sim, 1);
  const attackAt = indexOfEvent(r1, 'Swordy attacks');
  const bloodhunterAt = indexOfEvent(r1, 'Bloodhunter');
  check('Bloodhunter appears immediately after the player attack',
    attackAt === 0 && bloodhunterAt === 1, `attack=${attackAt} bloodhunter=${bloodhunterAt}`);

  // CASE 4 — a blessing's DAMAGE modifier precedes its own STATUS-stack application.
  const r2 = roundEvents(sim, 2);
  const modifierAt = indexOfEvent(r2, "Muspell's Flame — +50% vs a burning enemy");
  const stackAt = indexOfEvent(r2, "Muspell's Flame — Burn");
  check("Muspell's Flame damage modifier precedes its Burn-stack application",
    modifierAt >= 0 && stackAt >= 0 && modifierAt < stackAt,
    `modifier=${modifierAt} stack=${stackAt}`);

  const bhAt2 = indexOfEvent(r2, 'Bloodhunter — target is bleeding');
  check('weapon modifier precedes blessing modifier (category order, not name order)',
    bhAt2 >= 0 && modifierAt > bhAt2, `weapon=${bhAt2} blessing=${modifierAt}`);

  const bleedAt = indexOfEvent(r2, 'Swordsman Passive — applied Bleed');
  check('class-passive application follows the attack modifiers',
    bleedAt > modifierAt, `blessingMod=${modifierAt} classApply=${bleedAt}`);
  check('the class bleed stack is reported with its current stack count',
    /Current stack: \d+\/\d+/.test(r2[bleedAt] || ''), r2[bleedAt]);

  // The defender's reaction lane must stay below the attacker's own modifiers.
  const mobAttackAt = indexOfEvent(r2, 'Ogre strikes');
  const phalanxAt = indexOfEvent(r2, 'Phalanx Wall');
  check('defensive reaction follows the incoming attack, not the outgoing one',
    mobAttackAt >= 0 && phalanxAt === mobAttackAt + 1,
    `mobAttack=${mobAttackAt} phalanx=${phalanxAt}`);
}

{
  const sim = resolveBattle(
    player({
      name: 'Ripper',
      classPassive: 'none',
      atk: 100,
      hp: 10_000,
      crit: 0,
      weaponPassiveKey: 'pata',
      weaponName: 'Pata',
      deityBlessingKey: 'surt_muspells_flame',
      deityName: 'Surt',
    }),
    mob({ hp: 10_000, atk: 0, def: 0 }),
    { mode: 'boss', rng: () => 0.9 },
  );
  const r2 = roundEvents(sim, 2);
  const modifierAt = indexOfEvent(r2, "Muspell's Flame — +50% vs a burning enemy");
  const pataStatusAt = indexOfEvent(r2, 'Pata: Rending Claws — Bleed applied');
  check('generic status hooks follow later-source damage modifiers',
    modifierAt >= 0 && pataStatusAt > modifierAt,
    `modifier=${modifierAt} status=${pataStatusAt}`);
}

// ═══════════════════════════════════════════════════════════════════════════
section('4. Nothing resolves against a defeated target');

{
  // A one-shot kill: the mob cannot survive the opening attack, so no stack update
  // of any kind may be logged for that round.
  const sim = resolveBattle(
    referenceHero({ atk: 100_000 }),
    mob({ name: 'Glasscannon', hp: 500, atk: 10, def: 0 }),
    { mode: 'raid', seed: 3 },
  );
  const events = allEvents(sim);
  const defeatAt = events.findIndex((e) => e.includes('was defeated by'));

  // CASE 7 — the defeat message is the final event.
  check('defeat message is the last event of the battle',
    defeatAt === events.length - 1, `defeatAt=${defeatAt} total=${events.length}`);

  const lastRound = sim.rounds[sim.rounds.length - 1];
  const lastRoundDefeatAt = lastRound.events.findIndex((e) => e.includes('was defeated by'));
  check('defeat message is the last event of its round',
    lastRoundDefeatAt === lastRound.events.length - 1,
    lastRound.events.slice(lastRoundDefeatAt).join(' | '));

  // CASE 5 — no Bleed stack after the enemy dies.
  const bleedAfterDeath = events.slice(defeatAt + 1).some((e) => e.includes('applied Bleed'));
  const bleedInKillRound = lastRound.events
    .slice(lastRoundDefeatAt + 1)
    .some((e) => e.includes('applied Bleed'));
  check('no Swordsman Bleed stack is applied after the enemy dies',
    !bleedAfterDeath && !bleedInKillRound);

  // CASE 6 — no Burn stack increase after the enemy dies.
  const burnAfterDeath = events.slice(defeatAt + 1).some((e) => e.includes('Burn'));
  check('no Burn stack is applied after the enemy dies', !burnAfterDeath);

  // Nothing at all may follow the defeat message.
  check('no event of any kind follows the defeat message',
    events.slice(defeatAt + 1).length === 0, events.slice(defeatAt + 1).join(' | '));
}

{
  // CASE 8 — a target killed while DOTs are ticking receives no later effects, and
  // the remaining DOTs in the same tick do not resolve against the corpse.
  const sim = resolveBattle(
    referenceHero({ atk: 4000 }),
    mob({ name: 'Fragile', hp: 9000, atk: 5, def: 0 }),
    { mode: 'raid', seed: 21 },
  );
  const events = allEvents(sim);
  const defeatAt = events.findIndex((e) => e.includes('defeated by'));
  check('a DOT/attack kill still ends the log with the defeat message',
    defeatAt === events.length - 1, `defeatAt=${defeatAt} total=${events.length}`);

  const killRound = sim.rounds[sim.rounds.length - 1];
  const deathAt = killRound.events.findIndex((e) => e.includes('defeated by'));
  const afterDeath = killRound.events.slice(deathAt + 1);
  check('no DOT tick, stack or passive line is logged after the kill in that round',
    afterDeath.length === 0, afterDeath.join(' | '));
}

{
  // A DOT landing the killing blow: the death must still be terminal.
  const sim = resolveBattle(
    referenceHero({ atk: 2600 }),
    mob({ name: 'Bleeder', hp: 12_000, atk: 5, def: 0 }),
    { mode: 'raid', seed: 44 },
  );
  const events = allEvents(sim);
  const defeatAt = events.findIndex((e) => e.includes('defeated by'));
  check('DOT-killed target: defeat message is still terminal',
    defeatAt === events.length - 1, `defeatAt=${defeatAt} total=${events.length}`);
}

{
  // A one-turn DOT expires on the same tick that kills a Tribal Ward wearer. Expiry
  // cleanup must not revive the defeated target or emit a post-death heal.
  const victim = player({
    name: 'Ward',
    classPassive: 'none',
    atk: 0,
    hp: 84,
    def: 90,
    crit: 0,
    armorPassiveKey: 'luzon_tribal_shield',
    armorName: 'Luzon Tribal Shield',
  });
  const burner = player({
    name: 'Burner',
    classPassive: 'none',
    atk: 100,
    hp: 1000,
    def: 0,
    crit: 0,
    deityBlessingKey: 'apolaki_solar_burn',
    deityName: 'Apolaki',
  });
  const sim = resolveBattle(victim, burner, { mode: 'duel', rng: () => 0.9 });
  const events = allEvents(sim);
  const finalSnapshot = sim.snapshots[sim.snapshots.length - 1];
  check('lethal expiring DOT leaves Tribal Ward wearer at zero HP',
    sim.winner === 'b' && finalSnapshot.a.hp === 0,
    `winner=${sim.winner} hp=${finalSnapshot.a.hp}`);
  check('Tribal Ward does not heal after lethal DOT resolution',
    !events.some((event) => event.includes('Tribal Ward — debuff expired')),
    events.join(' | '));
}

// ═══════════════════════════════════════════════════════════════════════════
section('5. Ordering is shared by every combat mode');

{
  // The contract must hold in duel/ranked (mode 'duel') and boss too, because they
  // all route through the one resolver. A mode-specific log path would show up here.
  const duel = resolveBattle(
    referenceHero({ name: 'P1' }),
    player({
      name: 'P2', hp: 40_000, atk: 500, def: 200, crit: 0,
      class: 'Swordsman', classPassive: 'bleed',
      armorPassiveKey: 'hoplite_panoply', armorName: 'Hoplite Panoply',
    }),
    { mode: 'duel', seed: 5 },
  );
  const boss = resolveBattle(
    referenceHero(),
    mob({ name: 'WorldBoss', mobType: 'boss', hp: 900_000, atk: 1200, def: 300 }),
    { mode: 'boss', seed: 5 },
  );

  for (const [label, sim] of [['duel', duel], ['boss', boss]]) {
    let modifiersPlacedRight = true;
    for (const round of sim.rounds) {
      const at = round.events.findIndex((e) => e.includes('Bloodhunter'));
      if (at <= 0) continue;
      // Whatever precedes a weapon modifier must be an attack line or another
      // same-or-higher-ranked modifier — never a status/DOT/defeat line.
      const prev = round.events[at - 1];
      if (prev.includes('suffers') || prev.includes('defeated by')) modifiersPlacedRight = false;
    }
    check(`${label}: weapon modifiers never follow a DOT or defeat line`, modifiersPlacedRight);

    const events = allEvents(sim);
    const defeatAt = events.findIndex((e) => e.includes('defeated by'));
    if (defeatAt >= 0) {
      check(`${label}: defeat message is terminal`,
        defeatAt === events.length - 1, `defeatAt=${defeatAt} total=${events.length}`);
    }

    const phalanxAdjacency = followsAnAttack(sim, 'Phalanx Wall');
    check(`${label}: Phalanx Wall sits under the attack that triggered it, above Thorns/DOT`,
      phalanxAdjacency === null, phalanxAdjacency);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
section('6. Determinism is unaffected by the reordering');

{
  const build = () => resolveBattle(
    referenceHero(),
    mob({ name: 'Ogre', hp: 200_000, atk: 400, def: 100 }),
    { mode: 'raid', seed: 99 },
  );
  check('the same seed still yields a byte-identical log',
    JSON.stringify(build().rounds) === JSON.stringify(build().rounds));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════════════');
console.log(`COMBAT LOG ORDER SELFTEST: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log('All checks passed.');
