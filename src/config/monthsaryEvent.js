'use strict';

/**
 * Temporary Monthsary event configuration.
 *
 * Phase 1 is activated in code with a fixed PHT window. The exclusive end is
 * derived seven PHT days after the fixed start, so no deployment environment
 * variables are required for the event schedule.
 */

const EVENT_KEY = 'monthsary_2026_08';
const TIMEZONE = 'Asia/Manila';
const EVENT_START_AT = '2026-08-05T00:00:00+08:00';
const EVENT_ENABLED = true;
const DAY_MS = 86_400_000;
const START_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T00:00:00(?:\.000)?\+08:00$/;

const ATTENDANCE_REWARDS = Object.freeze({
  standard: Object.freeze({ sacredRelics: 1, bossTreasureChests: 1, bossGoldenChests: 0 }),
  day7: Object.freeze({ sacredRelics: 1, bossTreasureChests: 1, bossGoldenChests: 1 }),
});
const QUEST_REWARD = Object.freeze({ sacredRelics: 1 });

function buildEventConfig({
  enabled = false,
  startAt = '',
  eventKey = EVENT_KEY,
} = {}) {
  const rawStart = String(startAt || '').trim();
  if (!enabled) {
    return Object.freeze({
      eventKey, timezone: TIMEZONE, enabled: false, valid: true,
      startAt: null, endAt: null, attendanceRewards: ATTENDANCE_REWARDS,
      questReward: QUEST_REWARD,
    });
  }

  const startParts = rawStart.match(START_PATTERN);
  if (!startParts) {
    return Object.freeze({
      eventKey, timezone: TIMEZONE, enabled: true, valid: false,
      reason: 'start must be midnight PHT with an explicit +08:00 offset',
      startAt: null, endAt: null, attendanceRewards: ATTENDANCE_REWARDS,
      questReward: QUEST_REWARD,
    });
  }

  const startMs = Date.parse(rawStart);
  const phtDate = new Date(startMs + 8 * 3_600_000);
  const matchesCalendarDate = Number.isFinite(startMs)
    && phtDate.getUTCFullYear() === Number(startParts[1])
    && phtDate.getUTCMonth() + 1 === Number(startParts[2])
    && phtDate.getUTCDate() === Number(startParts[3]);
  if (!matchesCalendarDate) {
    return Object.freeze({
      eventKey, timezone: TIMEZONE, enabled: true, valid: false,
      reason: 'start timestamp is invalid', startAt: null, endAt: null,
      attendanceRewards: ATTENDANCE_REWARDS, questReward: QUEST_REWARD,
    });
  }

  const start = new Date(startMs);
  const end = new Date(startMs + 7 * DAY_MS);
  const validSpan = end.getTime() - start.getTime() === 7 * DAY_MS;
  const endIsMidnightPht = (end.getTime() + 8 * 3_600_000) % DAY_MS === 0;
  if (!validSpan || !endIsMidnightPht) {
    return Object.freeze({
      eventKey, timezone: TIMEZONE, enabled: true, valid: false,
      reason: 'derived end is not exactly seven PHT midnights after start',
      startAt: null, endAt: null, attendanceRewards: ATTENDANCE_REWARDS,
      questReward: QUEST_REWARD,
    });
  }

  return Object.freeze({
    eventKey, timezone: TIMEZONE, enabled: true, valid: true,
    startAt: start, endAt: end, attendanceRewards: ATTENDANCE_REWARDS,
    questReward: QUEST_REWARD,
  });
}

function eventStateAt(now, config = MONTHSARY_EVENT) {
  if (!config.enabled) return { active: false, reason: 'disabled', eventDay: null };
  if (!config.valid) return { active: false, reason: 'invalid', eventDay: null };

  const instant = now instanceof Date ? now : new Date(now);
  const nowMs = instant.getTime();
  if (!Number.isFinite(nowMs)) return { active: false, reason: 'invalid_now', eventDay: null };
  if (nowMs < config.startAt.getTime()) return { active: false, reason: 'before_start', eventDay: null };
  if (nowMs >= config.endAt.getTime()) return { active: false, reason: 'ended', eventDay: null };

  const eventDay = Math.floor((nowMs - config.startAt.getTime()) / DAY_MS) + 1;
  return { active: eventDay >= 1 && eventDay <= 7, reason: null, eventDay, now: instant };
}

function attendanceRewardForDay(eventDay, config = MONTHSARY_EVENT) {
  return eventDay === 7 ? config.attendanceRewards.day7 : config.attendanceRewards.standard;
}

const MONTHSARY_EVENT = buildEventConfig({
  enabled: EVENT_ENABLED,
  startAt: EVENT_START_AT,
});

if (MONTHSARY_EVENT.enabled && !MONTHSARY_EVENT.valid) {
  console.error(`[monthsary] Event disabled: ${MONTHSARY_EVENT.reason}.`);
}

module.exports = {
  EVENT_KEY,
  TIMEZONE,
  EVENT_START_AT,
  EVENT_ENABLED,
  DAY_MS,
  MONTHSARY_EVENT,
  buildEventConfig,
  eventStateAt,
  attendanceRewardForDay,
};
