import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePracticeStreak, getQualifyingPracticeDays, getPracticeSeconds, isMeaningfulPracticeSession } from './practice-history.js';

const sessionAt = (day, completed = true, seconds = 300) => ({
  id: day,
  date: new Date(2026, 10, day, 12, 0, 0).toISOString(),
  lastPractisedAt: new Date(2026, 10, day, 12, 0, 0).toISOString(),
  completed,
  practiceMode: 'normal',
  practiceSeconds: seconds,
  events: []
});

test('a completed five-minute selected session counts as a practice day', () => {
  assert.equal(isMeaningfulPracticeSession(sessionAt(7, true, 300)), true);
  assert.deepEqual(getQualifyingPracticeDays([sessionAt(7, true, 300)]), ['2026-11-07']);
});

test('a partially completed selected session does not count', () => {
  assert.equal(isMeaningfulPracticeSession(sessionAt(7, false, 420)), false);
  assert.deepEqual(getQualifyingPracticeDays([sessionAt(7, false, 420)]), []);
});

test('streak counts consecutive completed sessions regardless of selected duration', () => {
  const sessions = [sessionAt(7, true, 300), sessionAt(6, true, 600), sessionAt(5, false, 420)];
  assert.equal(calculatePracticeStreak(sessions, new Date(2026, 10, 7, 18, 0, 0)), 2);
});

test('older saved sessions without an explicit completion flag do not inflate streaks', () => {
  assert.equal(isMeaningfulPracticeSession({ practiceSeconds: 900, notes: 10, date: '2026-11-06T12:00:00' }), false);
});

test('practice duration still falls back to saved minutes for legacy session display', () => {
  assert.equal(getPracticeSeconds({ minutes: 2.5 }), 150);
});
