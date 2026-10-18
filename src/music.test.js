import test from 'node:test';
import assert from 'node:assert/strict';
import { noteToMidi, midiToNote, parseSequence, compareSequences } from './music.js';

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
