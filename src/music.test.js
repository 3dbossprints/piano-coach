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

test('compares uploaded score tokens with note-duration suffixes',()=>{
 const result=compareSequences('C4/q D4/h R/q E4/e',[
  {note:'C4',midi:60,time:0,duration:.5},
  {note:'D4',midi:62,time:.5,duration:1},
  {note:'E4',midi:64,time:2,duration:.25}
 ],120);
 assert.equal(result.total,3);
 assert.equal(result.correct,3);
 assert.equal(result.pitchErrors,0);
 assert.equal(result.timingIssues,0);
 assert.equal(result.timingAvailable,true);
});
test('uses rests to preserve timing between target notes',()=>{
 const result=compareSequences('C4/q R/q D4/q',[
  {note:'C4',midi:60,time:0,duration:.5},
  {note:'D4',midi:62,time:1,duration:.5}
 ],120);
 assert.equal(result.total,2);
 assert.equal(result.correct,2);
 assert.equal(result.timingIssues,0);
});
test('reports pitch and timing differences against the uploaded score',()=>{
 const result=compareSequences('C4/q D4/h',[
  {note:'C4',midi:60,time:0,duration:.5},
  {note:'E4',midi:64,time:.95,duration:1.2}
 ],120);
 assert.equal(result.total,2);
 assert.equal(result.correct,1);
 assert.equal(result.pitchErrors,1);
 assert.equal(result.timingIssues,1);
});
test('does not claim a target comparison when no score is supplied',()=>{
 const result=compareSequences('',[{note:'C4',midi:60,time:0,duration:.5}]);
 assert.equal(result.total,0);
 assert.equal(result.extra,1);
});
