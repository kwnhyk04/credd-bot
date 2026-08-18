'use strict';

/**
 * Player-facing deity label for `/crd stats`.
 *
 * Keep the historical export name for callers that already use it, but do not
 * expose the stored ascension/enhancement value in the stats card.
 */
function formatDeityAscensionLabel(name) {
  const deityName = String(name || '').trim();
  return deityName;
}

module.exports = { formatDeityAscensionLabel };
