import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePracticeStreak, getQualifyingPracticeDays, getPracticeSeconds, isMeaningfulPracticeSession } from './practice-history.js';

test('a session only counts after its selected duration is completed', () => {
  assert.equal(isMeaningfulPracticeSession({ completed: false, practiceSeconds: 600, notes: 20 }), false);
  assert.equal(isMeaningfulPracticeSession({ completed: true, practiceSeconds: 300, notes: 1 }), true);
  assert.equal(isMeaningfulPracticeSession({ completed: true, practiceSeconds: 600, notes: 0, events: [] }), false);
});

test('short completed sessions count; incomplete sessions do not', () => {
  const sessions = [
    { date: '2026-11-04T09:00:00', completed: true, practiceSeconds: 300, notes: 1 },
    { date: '2026-11-04T18:00:00', completed: false, practiceSeconds: 600, notes: 4 },
    { date: '2026-11-05T09:00:00', completed: true, practiceSeconds: 600, notes: 2 },
  ];
  assert.deepEqual(getQualifyingPracticeDays(sessions), ['2026-11-05', '2026-11-04']);
});

test('streak counts consecutive completed-session days and tolerates a not-yet-completed today', () => {
  const sessions = [
    { date: '2026-11-05T09:00:00', completed: true, practiceSeconds: 300, notes: 1 },
    { date: '2026-11-04T09:00:00', completed: true, practiceSeconds: 900, notes: 1 },
    { date: '2026-11-03T09:00:00', completed: true, practiceSeconds: 900, notes: 1 },
    { date: '2026-11-01T09:00:00', completed: true, practiceSeconds: 900, notes: 1 },
    { date: '2026-11-06T09:00:00', completed: false, practiceSeconds: 900, notes: 1 },
  ];
  assert.equal(calculatePracticeStreak(sessions, new Date(2026, 10, 5, 12)), 3);
  assert.equal(calculatePracticeStreak(sessions.slice(1), new Date(2026, 10, 5, 12)), 2);
});

test('practice duration falls back to saved minutes for older sessions', () => {
  assert.equal(getPracticeSeconds({ minutes: 2.5 }), 150);
});
