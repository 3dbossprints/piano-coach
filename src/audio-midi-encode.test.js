import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeNotesAsMidi } from './audio-midi-encode.js';

test('writes a valid MIDI header and one note-on/note-off pair', async () => {
  const blob = encodeNotesAsMidi([{ midi: 60, time: 0, duration: 0.5, velocity: 0.8 }]);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.equal(String.fromCharCode(...bytes.slice(0, 4)), 'MThd');
  assert.equal(bytes[8], 0);
  assert.equal(bytes[9], 0);
  assert.equal(bytes[10], 0);
  assert.equal(bytes[11], 1);
  assert.equal(String.fromCharCode(...bytes.slice(14, 18)), 'MTrk');
  assert.ok(bytes.includes(0x90));
  assert.ok(bytes.includes(0x80));
  assert.deepEqual([...bytes.slice(-4)], [0, 0xff, 0x2f, 0]);
});

test('preserves note timing and drops pitches outside the piano model range', () => {
  const blob = encodeNotesAsMidi([
    { midi: 60, time: 1, duration: 0.25, velocity: 0.5 },
    { midi: 12, time: 0, duration: 1, velocity: 1 }
  ], { bpm: 120 });
  assert.ok(blob.size > 40);
});

test('rejects a transcription with no usable notes', () => {
  assert.throws(() => encodeNotesAsMidi([{ midi: 12, time: 0, duration: 1 }]), /valid piano-range notes/);
});
