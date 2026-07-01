'use strict';

function capitalizeLower(s = '') {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function formatIntegerEnUS(value) {
  return Number(value || 0).toLocaleString('en-US');
}

module.exports = { capitalizeLower, formatIntegerEnUS };
