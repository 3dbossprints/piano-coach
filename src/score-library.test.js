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

test('practice score items remain recognised even when they have no extension', () => {
  assert.equal(isSheetMusicLibraryItem({ name: 'Practice capture', kind: 'practice-score' }), true);
  assert.equal(isPlayableSheetMusicItem({ name: 'Practice capture', kind: 'practice-score' }), false);
});
