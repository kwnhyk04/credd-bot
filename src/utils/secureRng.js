'use strict';

const crypto = require('crypto');

const UNIT_SCALE = 2 ** 32;
const WEIGHT_SCALE = 1_000_000;

function int(max) {
  if (!Number.isSafeInteger(max) || max < 1) {
    throw new RangeError(`secureRng.int needs a positive safe integer, got ${max}`);
  }
  return crypto.randomInt(max);
}

function range(min, max) {
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max < min) {
    throw new RangeError(`secureRng.range needs safe integers with max >= min, got ${min}..${max}`);
  }
  return crypto.randomInt(min, max + 1);
}

function unit() {
  return crypto.randomInt(UNIT_SCALE) / UNIT_SCALE;
}

function chance(probability) {
  const p = Number(probability);
  if (!Number.isFinite(p) || p < 0 || p > 1) {
    throw new RangeError(`secureRng.chance needs a probability from 0 to 1, got ${probability}`);
  }
  if (p === 0) return false;
  if (p === 1) return true;
  return int(WEIGHT_SCALE) < Math.round(p * WEIGHT_SCALE);
}

function weightedIndex(weights) {
  if (!Array.isArray(weights) || weights.length === 0) {
    throw new RangeError('secureRng.weightedIndex needs at least one weight');
  }
  const tickets = weights.map((raw) => {
    const weight = Number(raw);
    if (!Number.isFinite(weight) || weight < 0) {
      throw new RangeError(`secureRng.weightedIndex received invalid weight ${raw}`);
    }
    const scaled = Math.round(weight * WEIGHT_SCALE);
    if (weight > 0 && scaled === 0) {
      throw new RangeError(`secureRng.weightedIndex weight ${raw} is below supported precision`);
    }
    return scaled;
  });
  const total = tickets.reduce((sum, weight) => sum + weight, 0);
  if (!Number.isSafeInteger(total) || total < 1) {
    throw new RangeError(`secureRng.weightedIndex produced invalid total ${total}`);
  }

  let ticket = int(total);
  for (let i = 0; i < tickets.length; i++) {
    if (ticket < tickets[i]) return i;
    ticket -= tickets[i];
  }
  return tickets.length - 1;
}

module.exports = { int, range, unit, chance, weightedIndex };
