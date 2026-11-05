import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeTutorResponse, verifiedTheoryAnswer } from './ai-safety.js';

test('fully diminished seventh chord receives the correct formula', () => {
  const answer = verifiedTheoryAnswer('Explain a diminished seventh chord');
  assert.match(answer, /1–♭3–♭5–♭♭7/);
  assert.match(answer, /C–E♭–G♭–B𝄫/);
});

test('half-diminished seventh is not confused with fully diminished', () => {
  const answer = verifiedTheoryAnswer('What is a half-diminished seventh chord?');
  assert.match(answer, /1–♭3–♭5–♭7/);
  assert.match(answer, /C–E♭–G♭–B♭/);
});

test('unrelated questions do not get a canned theory response', () => {
  assert.equal(verifiedTheoryAnswer('How do I practise scales?'), null);
});

test('tutor output removes raw comparison objects and prompt echoes', () => {
  const output = sanitizeTutorResponse('Try a slower tempo. {"expected":"—","played":"G3","status":"extra"} TRANSCRIPTION EVIDENCE: hidden notes. You matched all four target notes. Keep your wrists relaxed.');
  assert.match(output, /Try a slower tempo/);
  assert.match(output, /Keep your wrists relaxed/);
  assert.doesNotMatch(output, /expected|played|status|TRANSCRIPTION EVIDENCE|matched all four/i);
});

test('empty tutor output remains empty', () => {
  assert.equal(sanitizeTutorResponse(''), '');
});
