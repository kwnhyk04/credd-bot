'use strict';

/**
 * help-selftest.js — static validation of the command surface (Phase 11, §6). No DB, no Discord.
 * Checks:
 *   1. Every alias maps to a known canonical command (first token is an implemented command).
 *   2. No two aliases resolve to the same canonical — except the documented sm/sl → "slot machine".
 *   3. Every non-dev command in the help text has a slash definition.
 *   4. Every slash definition has a command handler export (IMPLEMENTED[canonical].run).
 *   5. Every slash definition has a registered arg-assembler (approval addition).
 * Exit 1 on any failure.
 */

const ALIASES = require('../src/config/aliases');
const { IMPLEMENTED } = require('../src/handlers/commandHandler');
const { definitions } = require('../src/commands/slashDefinitions');
const { CATEGORIES } = require('../src/commands/help');

let passed = 0;
let failed = 0;
const fails = [];
function check(name, ok, detail = '') {
  if (ok) { passed++; }
  else { failed++; fails.push(`${name}${detail ? ` — ${detail}` : ''}`); }
}

// ── 1. Aliases map to known canonical commands ──────────────────────────────
for (const [alias, canonical] of Object.entries(ALIASES)) {
  const firstToken = canonical.split(' ')[0];
  check(`alias '${alias}' → known command`, Boolean(IMPLEMENTED[firstToken]),
    `'${canonical}' (first token '${firstToken}') not in IMPLEMENTED`);
}

// ── 2. No duplicate canonical targets (except sm/sl → "slot machine") ────────
{
  const ALLOWED_DUP = new Set(['slot machine']);
  const byCanonical = new Map();
  for (const [alias, canonical] of Object.entries(ALIASES)) {
    if (!byCanonical.has(canonical)) byCanonical.set(canonical, []);
    byCanonical.get(canonical).push(alias);
  }
  for (const [canonical, aliasList] of byCanonical) {
    check(`canonical '${canonical}' has one alias`,
      aliasList.length === 1 || ALLOWED_DUP.has(canonical),
      `aliases [${aliasList.join(', ')}] all map to '${canonical}'`);
  }
}

// ── 3. Every non-dev help command has a slash definition ────────────────────
{
  const slashCanonicals = new Set(definitions.map((d) => d.canonical));
  // prefixOnly categories and individual prefixOnly lines are intentionally
  // not slash commands.
  const helpCanonicals = new Set(
    CATEGORIES.filter((c) => !c.prefixOnly)
      .flatMap((c) => c.lines.filter((l) => !l.prefixOnly).map((l) => l.canonical))
  );
  for (const canonical of helpCanonicals) {
    check(`help command '${canonical}' has a slash definition`, slashCanonicals.has(canonical));
  }
}

// ── 4 & 5. Every slash def has a handler export AND an arg-assembler ─────────
for (const d of definitions) {
  const impl = IMPLEMENTED[d.canonical];
  check(`slash '${d.name}' → handler export`, Boolean(impl) && typeof impl.run === 'function',
    `IMPLEMENTED['${d.canonical}'] missing or has no run()`);
  check(`slash '${d.name}' → arg-assembler`, typeof d.assemble === 'function');
}

// ── Report ──────────────────────────────────────────────────────────────────
console.log(`\nHelp self-test: ${passed} passed, ${failed} failed`);
if (failed) {
  console.log('\nFailures:');
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log('All command-surface checks green.');
