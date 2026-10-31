import test from 'node:test';
import assert from 'node:assert/strict';
import { noteToMidi, midiToNote, parseSequence, compareSequences, clampKeyboardStartMidi, assignMidiHands } from './music.js';

test('converts standard piano range endpoints',()=>{
 assert.equal(noteToMidi('A0'),21);
 assert.equal(noteToMidi('C8'),108);
 assert.equal(midiToNote(69),'A4');
});
test('supports sharps, flats and negative octave notation',()=>{
 assert.equal(noteToMidi('C#4'),61);
 assert.equal(noteToMidi('Db4'),61);
 assert.equal(noteToMidi('B#3'),60);
 assert.equal(noteToMidi('H4'),null);
 assert.equal(noteToMidi('C9'),null);
});
test('parses note sequences separated by spaces, commas and semicolons',()=>{
 assert.deepEqual(parseSequence('C4, D4;E4').map(x=>x.midi),[60,62,64]);
});
test('compares played and expected notes in sequence order',()=>{
 const result=compareSequences('C4 D4 E4',[{note:'C4'},{note:'F4'}]);
 assert.equal(result.correct,1);
 assert.equal(result.total,3);
 assert.deepEqual(result.rows.map(x=>x.status),['correct','incorrect','missed']);
 assert.equal(result.accuracy,33);
});


test('keeps the first keyboard note unchanged when changing visible octaves', async () => {
  assert.equal(clampKeyboardStartMidi('G2', 3), 43);
  assert.equal(clampKeyboardStartMidi('G2', 4), 43);
  assert.equal(clampKeyboardStartMidi('G2', 5), 43);
  assert.equal(clampKeyboardStartMidi('F3', 3), 53);
  assert.equal(clampKeyboardStartMidi('F3', 4), 53);
});


test('assigns separate MIDI tracks to separate hands using their pitch ranges', () => {
  const notes = [
    { track: 0, midi: 40, note: 'E2' },
    { track: 0, midi: 48, note: 'C3' },
    { track: 1, midi: 64, note: 'E4' },
    { track: 1, midi: 76, note: 'E5' }
  ];
  assert.deepEqual(assignMidiHands(notes).map(note => note.hand), ['left', 'left', 'right', 'right']);
});

test('splits a single-track MIDI file by register when no hand tracks exist', () => {
  const notes = assignMidiHands([{ track: 0, midi: 48 }, { track: 0, midi: 72 }]);
  assert.deepEqual(notes.map(note => note.hand), ['left', 'right']);
});
