import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePracticeStreak, getQualifyingPracticeDays, getPracticeSeconds, isMeaningfulPracticeSession } from './practice-history.js';

test('a zero-activity score launch is not a practice session', () => {
  assert.equal(isMeaningfulPracticeSession({ practiceMode: 'learn', practiceSeconds: 0, notes: 0, loadedScoreNotes: [{ midi: 60 }] }), false);
  assert.equal(isMeaningfulPracticeSession({ practiceSeconds: 60, notes: 0, events: [] }), false);
});

test('genuine activity makes a session eligible for history', () => {
  assert.equal(isMeaningfulPracticeSession({ practiceSeconds: 20, events: [{ note: 'C4' }] }), true);
  assert.equal(isMeaningfulPracticeSession({ practiceSeconds: 20, notes: 1 }), true);
  assert.equal(isMeaningfulPracticeSession({ practiceSeconds: 20, learnProgressBeat: 1 }), true);
});

test('15-minute streak threshold aggregates all genuine sessions on the same local day', () => {
  const sessions = [
    { date: '2026-11-04T09:00:00', practiceSeconds: 480, notes: 3 },
    { date: '2026-11-04T18:00:00', practiceSeconds: 420, notes: 4 },
    { date: '2026-11-04T20:00:00', practiceSeconds: 60, notes: 0 },
  ];
  assert.deepEqual(getQualifyingPracticeDays(sessions), []);
  sessions[1].practiceSeconds = 480;
  assert.deepEqual(getQualifyingPracticeDays(sessions), ['2026-11-04']);
});

test('streak counts consecutive qualifying days and tolerates a not-yet-practised today', () => {
  const sessions = [
    { date: '2026-11-05T09:00:00', practiceSeconds: 900, notes: 1 },
    { date: '2026-11-04T09:00:00', practiceSeconds: 900, notes: 1 },
    { date: '2026-11-03T09:00:00', practiceSeconds: 900, notes: 1 },
    { date: '2026-11-01T09:00:00', practiceSeconds: 900, notes: 1 },
  ];
  assert.equal(calculatePracticeStreak(sessions, new Date(2026, 10, 5, 12)), 3);
  assert.equal(calculatePracticeStreak(sessions.slice(1), new Date(2026, 10, 5, 12)), 3);
});

test('practice duration falls back to saved minutes for older sessions', () => {
  assert.equal(getPracticeSeconds({ minutes: 2.5 }), 150);
});
