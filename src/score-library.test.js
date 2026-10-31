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

test('only structured musical notation is marked playable', () => {
  for (const name of ['piece.musiccoach', 'piece.musicxml', 'piece.xml', 'piece.mid', 'piece.midi']) {
    assert.equal(isPlayableSheetMusicItem({ name }), true, name);
  }
  for (const name of ['scan.pdf', 'photo.png', 'score.webp']) {
    assert.equal(isPlayableSheetMusicItem({ name }), false, name);
  }
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
