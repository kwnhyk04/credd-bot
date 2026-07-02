'use strict';

/**
 * Generate scripts/patch_descriptions.sql from passive_registry_keys.md.
 *
 * The md is the authoritative, grammar-checked source for every passive / blessing /
 * skill description (keyed by registry key). This emits keyed UPDATEs that sync the live
 * DB description columns to the md text — names live in their own columns (passive_name /
 * blessing_name / skill_name), so only the description part (after "Name: ") is written.
 *
 *   node scripts/gen_description_patch.js   →  writes scripts/patch_descriptions.sql
 *
 * Run the generated SQL on Supabase. Re-run this whenever the md changes.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const md = fs.readFileSync(path.join(ROOT, 'assets', 'data', 'passive_registry_keys.md'), 'utf8');

// section header → { table, keyCol, descCol }
const SECTIONS = [
  { marker: '## WEAPON', table: 'weapon_roster', keyCol: 'passive_key', descCol: 'passive_description' },
  { marker: '## DEITY', table: 'deity_roster', keyCol: 'blessing_key', descCol: 'blessing_description' },
  { marker: '## MOB', table: 'mob_roster', keyCol: 'skill_key', descCol: 'skill_description' },
];

const sql = (s) => `'${String(s).replace(/'/g, "''")}'`;
const ENTRY = /^- `([a-z0-9_]+)` — (.+)$/;

const lines = md.split(/\r?\n/);
// find each section's [start,end) line range
const bounds = SECTIONS.map((s) => ({ ...s, start: lines.findIndex((l) => l.startsWith(s.marker)) }))
  .sort((a, b) => a.start - b.start);

const out = [
  '-- =====================================================================',
  '-- PATCH — grammar-corrected passive / blessing / skill descriptions',
  '-- Generated from passive_registry_keys.md by scripts/gen_description_patch.js',
  '-- Run by hand in Supabase. Keyed by registry key; names are untouched.',
  '-- =====================================================================',
  '',
  'BEGIN;',
  '',
];

let total = 0;
for (let i = 0; i < bounds.length; i++) {
  const sec = bounds[i];
  const end = i + 1 < bounds.length ? bounds[i + 1].start : lines.length;
  out.push(`-- ${sec.table}.${sec.descCol}`);
  let n = 0;
  for (let l = sec.start + 1; l < end; l++) {
    const m = ENTRY.exec(lines[l]);
    if (!m) continue;
    const key = m[1];
    if (key === 'none') continue;
    const rest = m[2];
    const idx = rest.indexOf(': ');
    if (idx === -1) continue; // not a "Name: Description" entry
    const desc = rest.slice(idx + 2).trim();
    out.push(`UPDATE ${sec.table} SET ${sec.descCol} = ${sql(desc)} WHERE ${sec.keyCol} = ${sql(key)};`);
    n += 1; total += 1;
  }
  out.push(`-- (${n} rows)`, '');
}

out.push('COMMIT;', '');

const target = path.join(ROOT, 'scripts', 'patch_descriptions.sql');
fs.writeFileSync(target, out.join('\n'));
console.log(`Wrote ${total} UPDATE statements → ${path.relative(ROOT, target)}`);
