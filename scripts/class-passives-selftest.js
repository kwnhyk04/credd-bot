'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const { CLASS_NAMES, CLASSES, CLASS_PASSIVE_VALUES } = require('../src/config/classes');
const { buildClassPassives, execute } = require('../src/commands/rpg/classPassives');
const { emojiForDisplay } = require('../src/utils/emojis');

function textContents(value, output = []) {
  if (!value || typeof value !== 'object') return output;
  if (typeof value.content === 'string') output.push(value.content);
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) child.forEach((entry) => textContents(entry, output));
    else if (child && typeof child === 'object') textContents(child, output);
  }
  return output;
}

async function main() {
  const payload = buildClassPassives();
  assert.equal(payload.flags, 32768);
  assert.equal(payload.components.length, 1);
  const json = payload.components[0].toJSON();
  const text = textContents(json);
  assert(text.includes('## Class Passives'));
  assert(text.every((content) => content.length <= 4000));

  const rendered = JSON.stringify(json);
  for (const name of CLASS_NAMES) {
    assert(rendered.includes(name), `missing class ${name}`);
    assert(rendered.includes(emojiForDisplay(name, CLASSES[name].emoji)), `missing registered icon for ${name}`);
    assert(rendered.includes(CLASSES[name].passiveLine), `missing current passive for ${name}`);
    assert(fs.existsSync(path.join(ROOT, 'assets', 'classes', `${name.toLowerCase()}.png`)),
      `missing dedicated ${name.toLowerCase()}.png source asset`);
  }
  assert.equal(new Set(CLASS_NAMES).size, 5);
  assert.equal(CLASS_PASSIVE_VALUES.Knight.regeneration, 0.01);
  assert(CLASSES.Mage.passiveLine.includes('4.0× damage (60%)'));
  assert(CLASSES.Mage.passiveLine.includes('5.0× damage (40%)'));
  assert(CLASSES.Mage.passiveLine.includes('50%'));
  assert.equal(CLASS_PASSIVE_VALUES.Fighter.damageBonus, 0.50);
  assert.equal(CLASS_PASSIVE_VALUES.Fighter.stunChance, 0.30);
  assert.equal(CLASS_PASSIVE_VALUES.Fighter.bashDamage, 0.50);
  assert.equal(CLASS_PASSIVE_VALUES.Fighter.dizzyMissChance, 0.15);
  assert.equal(CLASS_PASSIVE_VALUES.Archer.doubleAttackChance, 0.35);
  assert.equal(CLASS_PASSIVE_VALUES.Swordsman.atkMax, 0.30);

  const source = fs.readFileSync(
    path.join(ROOT, 'src', 'commands', 'rpg', 'classPassives.js'),
    'utf8',
  );
  assert(source.includes("require('../../utils/emojis')"));
  assert(source.includes('emojiForDisplay(name, cls.emoji)'));
  assert(!/avatar/i.test(source));

  const replies = [];
  const message = { async reply(reply) { replies.push(reply); return reply; } };
  await execute(message, { args: [] });
  assert.equal(replies.pop().content, 'Usage: `crd class passives`');
  await execute(message, { args: ['PASSIVES'] });
  assert.equal(replies.pop().components.length, 1);

  const handlerSource = fs.readFileSync(
    path.join(ROOT, 'src', 'handlers', 'commandHandler.js'),
    'utf8',
  );
  assert(/class:\s+\{ mw: 'full', run: classPassivesCmd\.execute, requiresCharacter: false \}/.test(handlerSource));

  console.log('CLASS PASSIVES SELFTEST: passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
