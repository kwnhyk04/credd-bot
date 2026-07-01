'use strict';

function capitalizeLower(s = '') {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

module.exports = { capitalizeLower };
