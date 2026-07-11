'use strict';

function displayEnhancement(value, { oneBased = true } = {}) {
  const stored = Number(value);
  if (!Number.isFinite(stored)) return 0;
  return Math.max(0, Math.floor(stored) - (oneBased ? 1 : 0));
}

function formatEnhancedName(name, value, options) {
  return `${String(name || '').trim()} +${displayEnhancement(value, options)}`.trim();
}

module.exports = { displayEnhancement, formatEnhancedName };
