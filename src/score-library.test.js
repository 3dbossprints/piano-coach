import test from 'node:test';
import assert from 'node:assert/strict';
import { isPlayableSheetMusicItem, isSheetMusicLibraryItem } from './score-library.js';

test('sheet library accepts notation and score-source formats only', () => {
  for (const name of ['piece.musiccoach', 'piece.musicxml', 'piece.xml', 'piece.mid', 'piece.midi', 'scan.pdf', 'photo.png', 'scan.jpg', 'scan.webp']) {
    assert.equal(isSheetMusicLibraryItem({ name }), true, name);
  }
  for (const name of ['song.mp3', 'voice.wav', 'cover.svgz', 'notes.txt', 'video.mp4']) {
    assert.equal(isSheetMusicLibraryItem({ name }), false, name);
  }
});

test('only structured musical notation with saved file data is marked playable', () => {
  const coach = { name: 'piece.musiccoach', data: 'data:application/json;base64,' + Buffer.from('{"format":"musiccoach","notes":[{"note":"C4"}]}').toString('base64') };
  const xml = { name: 'piece.musicxml', data: 'data:application/xml;base64,' + Buffer.from('<score-partwise><part-list/><part id="P1"><measure><note/></measure></part></score-partwise>').toString('base64') };
  const midiBytes = Buffer.alloc(34); midiBytes.write('MThd', 0, 'ascii'); midiBytes.writeUInt32BE(6, 4); midiBytes.writeUInt16BE(1, 10); midiBytes.writeUInt16BE(480, 12); midiBytes.write('MTrk', 14, 'ascii'); midiBytes.writeUInt32BE(12, 18); midiBytes.set([0, 0x90, 60, 100, 0x60, 0x80, 60, 0, 0, 0xff, 0x2f, 0], 22);
  const midi = { name: 'piece.mid', data: 'data:audio/midi;base64,' + midiBytes.toString('base64') };
  for (const item of [coach, xml, midi]) assert.equal(isPlayableSheetMusicItem(item), true, item.name);
  for (const name of ['scan.pdf', 'photo.png', 'score.webp']) assert.equal(isPlayableSheetMusicItem({ name, data: 'data:application/octet-stream;base64,AA==' }), false, name);
  for (const name of ['piece.musiccoach', 'piece.musicxml', 'piece.mid']) assert.equal(isPlayableSheetMusicItem({ name }), false, name + ' without data');
});

test('rejects an unstructured practice item without a sheet-music file', () => {
  assert.equal(isSheetMusicLibraryItem({ name: 'Practice capture', kind: 'practice-score' }), false);
  assert.equal(isPlayableSheetMusicItem({ name: 'Practice capture', kind: 'practice-score' }), false);
});

test('rejects non-score files even if incorrectly tagged as a score', () => {
  assert.equal(isSheetMusicLibraryItem({ name: 'recording.mp3', kind: 'score' }), false);
  assert.equal(isSheetMusicLibraryItem({ name: 'voice.wav', kind: 'practice-score' }), false);
});

test('playback is allowed for a structured practice score with note data', () => {
  const item = { name: 'Practice capture', kind: 'practice-score', score: { notes: [{ note: 'C4' }] } };
  assert.equal(isSheetMusicLibraryItem(item), true);
  assert.equal(isPlayableSheetMusicItem(item), true);
});

test('a score filename alone cannot make an invalid file listenable', () => {
  const invalidXml = 'data:application/xml;base64,' + Buffer.from('<settings><title>Not a score</title></settings>').toString('base64');
  const invalidCoach = 'data:application/json;base64,' + Buffer.from('{"format":"not-music","notes":[]}').toString('base64');
  assert.equal(isPlayableSheetMusicItem({ name: 'not-score.xml', data: invalidXml }), false);
  assert.equal(isPlayableSheetMusicItem({ name: 'not-score.musiccoach', data: invalidCoach }), false);
});

test('valid MusicXML data is listenable while score images remain non-audio', () => {
  const xml = 'data:application/xml;base64,' + Buffer.from('<score-partwise><part-list/><part id="P1"><measure number="1"><note><pitch><step>C</step><octave>4</octave></pitch></note></measure></part></score-partwise>').toString('base64');
  const image = 'data:image/png;base64,' + Buffer.from('not actually audio').toString('base64');
  assert.equal(isPlayableSheetMusicItem({ name: 'piece.xml', data: xml }), true);
  assert.equal(isPlayableSheetMusicItem({ name: 'score.png', type: 'image/png', data: image }), false);
});

test('valid Music Coach and MIDI data are accepted for playback', () => {
  const coach = 'data:application/vnd.piano-coach.musiccoach+json;base64,' + Buffer.from(JSON.stringify({ format: 'musiccoach', notes: [{ note: 'C4' }] })).toString('base64');
  const midiBytes = Buffer.alloc(34);
  midiBytes.write('MThd', 0, 'ascii');
  midiBytes.writeUInt32BE(6, 4);
  midiBytes.writeUInt16BE(1, 8);
  midiBytes.writeUInt16BE(1, 10);
  midiBytes.writeUInt16BE(480, 12);
  midiBytes.write('MTrk', 14, 'ascii');
  midiBytes.writeUInt32BE(12, 18);
  midiBytes.set([0, 0x90, 60, 100, 0x60, 0x80, 60, 0, 0, 0xff, 0x2f, 0], 22);
  const midi = 'data:audio/midi;base64,' + midiBytes.toString('base64');
  assert.equal(isPlayableSheetMusicItem({ name: 'piece.musiccoach', data: coach }), true);
  assert.equal(isPlayableSheetMusicItem({ name: 'piece.mid', data: midi }), true);
});
