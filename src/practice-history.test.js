import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePracticeStreak, getQualifyingPracticeDays, getPracticeSeconds, isMeaningfulPracticeSession } from './practice-history.js';

test('an incomplete session never counts towards a streak, even with substantial practice time', () => {
  assert.equal(isMeaningfulPracticeSession({ completed:false, practiceSeconds:900, notes:20 }), false);
  assert.deepEqual(getQualifyingPracticeDays([{ date:'2026-11-04T09:00:00', completed:false, practiceSeconds:900, notes:20 }]), []);
});

test('completing a selected short session counts as a practice day', () => {
  const sessions=[{date:'2026-11-04T09:00:00',completed:true,practiceSeconds:300,notes:3,events:[{note:'C4'}]}];
  assert.equal(isMeaningfulPracticeSession(sessions[0]),true);
  assert.deepEqual(getQualifyingPracticeDays(sessions),['2026-11-04']);
});

test('streak counts consecutive completed days and tolerates a not-yet-practised today', () => {
  const sessions=[
    {date:'2026-11-05T09:00:00',completed:true,practiceSeconds:300,notes:1},
    {date:'2026-11-04T09:00:00',completed:true,practiceSeconds:300,notes:1},
    {date:'2026-11-03T09:00:00',completed:true,practiceSeconds:300,notes:1},
    {date:'2026-11-01T09:00:00',completed:true,practiceSeconds:300,notes:1},
  ];
  assert.equal(calculatePracticeStreak(sessions,new Date(2026,10,5,12)),3);
  assert.equal(calculatePracticeStreak(sessions.slice(1),new Date(2026,10,5,12)),2);
});

test('a completed selected session counts even if no note transcription was captured', () => {
  assert.equal(isMeaningfulPracticeSession({completed:true,practiceSeconds:300,notes:0,events:[]}),true);
  assert.deepEqual(getQualifyingPracticeDays([{date:'2026-11-04T09:00:00',completed:true,practiceSeconds:300,notes:0,events:[]}]),['2026-11-04']);
});

test('practice duration falls back to saved minutes for older sessions', () => {
  assert.equal(getPracticeSeconds({minutes:2.5}),150);
});
