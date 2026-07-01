'use strict';

const BELIEVER_EXP_PER_LEVEL = 3000;

function believerTitle(level) {
  if (level >= 500) return 'Last Believer';
  if (level >= 200) return 'Chosen One';
  if (level >= 100) return 'Champion of Faith';
  if (level >= 50) return 'Zealot';
  if (level >= 25) return 'Disciple';
  if (level >= 10) return 'Devotee';
  return 'Wanderer';
}

module.exports = {
  BELIEVER_EXP_PER_LEVEL,
  believerTitle,
};
