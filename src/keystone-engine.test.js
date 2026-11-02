import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKeystoneOrder, buildKeystoneTimeline } from './keystone-engine.js';

test('Keystone order follows repeat and first/second endings', () => {
  const measures = [
    { repeatForward: true, length: 4, bpm: 120, notes: [] },
    { length: 4, bpm: 120, notes: [] },
    { length: 4, bpm: 120, notes: [] },
    { length: 4, bpm: 120, notes: [], ending: [1], repeatBackward: true, repeatTimes: 2 },
    { length: 4, bpm: 120, notes: [], ending: [2] }
  ];
  assert.deepEqual(buildKeystoneOrder(measures), [0,1,2,3,0,1,2,4]);
});

test('Keystone order follows D.C. and stops at Fine after the jump', () => {
  const measures = [
    { length: 4, bpm: 120, notes: [] },
    { length: 4, bpm: 120, notes: [] },
    { length: 4, bpm: 120, notes: [], daCapo: true },
    { length: 4, bpm: 120, notes: [] },
    { length: 4, bpm: 120, notes: [], fine: true }
  ];
  assert.deepEqual(buildKeystoneOrder(measures), [0,1,2,0,1,2,3,4]);
});

test('timeline preserves chord alignment, durations and bar numbers', () => {
  const measures = [
    { number: 7, length: 4, bpm: 120, notes: [
      { midi: 60, offset: 0, duration: 1, hand: 'right' },
      { midi: 64, offset: 0, duration: 2, hand: 'right' },
      { midi: 48, offset: 2, duration: 1, hand: 'left' }
    ] }
  ];
  const events = buildKeystoneTimeline({ measures, order: [0], bpm: 120 });
  assert.equal(events.length, 3);
  assert.equal(events[0].t, events[1].t);
  assert.equal(events[0].d, .5);
  assert.equal(events[1].d, 1);
  assert.equal(events[2].t, 1);
  assert.equal(events[2].measure, 7);
});
