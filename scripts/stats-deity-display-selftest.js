'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { formatDeityAscensionLabel } = require('../src/utils/deityDisplay');
const { _test } = require('../src/engine/statsLayoutRenderer');

function filesUnder(dir, predicate) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...filesUnder(full, predicate));
    else if (predicate(full)) found.push(full);
  }
  return found;
}

function main() {
  assert.equal(formatDeityAscensionLabel('Bathala', 10), 'Bathala');
  assert.equal(formatDeityAscensionLabel('  Odin  ', 5), 'Odin');
  assert.equal(formatDeityAscensionLabel(null, 10), '');

  const view = _test.buildView({
    displayName: 'Tester',
    className: 'Mage',
    combatLevel: 22,
    combatExp: 1,
    combatExpMax: 2,
    weaponName: null,
    armorName: null,
    deityName: 'Bathala',
    deity2Name: 'Odin',
    deity3Name: 'Ares',
    // Both historical field names are intentionally hostile test inputs. The
    // stats view must ignore them and preserve only the three deity names.
    deityEnh: 10,
    deityAscension: 10,
    blessingName: 'Divine Vessel',
    echoBlessing: 'Blood Frenzy',
    atk: 1,
    hp: 1,
    def: 1,
    crit: 1,
    records: {},
  });
  assert.deepEqual(view.deities, ['Bathala', 'Odin', 'Ares']);
  assert.equal(view.deity_value, 'Bathala  ·  Odin  ·  Ares');
  assert.equal(view.blessing, 'Primary: Divine Vessel   ·   Secondary: Blood Frenzy');
  assert(!/\+\d|Ascend/i.test(view.deity_value));

  const statsLayouts = filesUnder(
    path.join(ROOT, 'assets', 'skins'),
    (file) => file.endsWith('.stats.layout.json'),
  );
  assert(statsLayouts.length > 0, 'no stats-skin layouts found');
  for (const file of statsLayouts) {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const layout = _test.reflowStatsText(raw);
    const labelGap = layout.deity_value.y - layout.deity_label.y;
    const blessingGap = layout.blessing.y - layout.deity_value.y;
    assert.equal(labelGap, 16, `${path.relative(ROOT, file)} has a non-compact deity label gap`);
    assert.equal(blessingGap, 30, `${path.relative(ROOT, file)} moved the blessing row`);
  }

  const defaultRenderer = fs.readFileSync(path.join(ROOT, 'src', 'engine', 'renderStats.js'), 'utf8');
  assert(!defaultRenderer.includes('d.deityEnh'), 'default /crd stats still renders deity enhancement');
  assert(defaultRenderer.includes('formatDeityAscensionLabel(d.deityName)'));
  assert.match(defaultRenderer, /ctx\.fillText\('Deities:', PAD, by\);[\s\S]*?by \+= 16;/);

  const layoutRenderer = fs.readFileSync(path.join(ROOT, 'src', 'engine', 'statsLayoutRenderer.js'), 'utf8');
  assert(!layoutRenderer.includes('d.deityEnh'), 'a stats-skin renderer still renders deity enhancement');

  console.log(`STATS DEITY DISPLAY SELFTEST: passed (default + ${statsLayouts.length} skin layouts)`);
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
