import test from 'node:test';
import assert from 'node:assert/strict';
import { getScoreFileKind } from './score-ocr.js';

test('accepts PDF scores by MIME type or extension', () => {
  assert.equal(getScoreFileKind({ name: 'score', type: 'application/pdf' }), 'pdf');
  assert.equal(getScoreFileKind({ name: 'score.PDF', type: '' }), 'pdf');
});
test('accepts PNG, JPEG, WebP and SVG scores', () => {
  assert.equal(getScoreFileKind({ name: 'score.png', type: 'image/png' }), 'image');
  assert.equal(getScoreFileKind({ name: 'score.jpg', type: '' }), 'image');
  assert.equal(getScoreFileKind({ name: 'score.webp', type: 'image/webp' }), 'image');
  assert.equal(getScoreFileKind({ name: 'score.svg', type: 'image/svg+xml' }), 'svg');
});
test('rejects unsupported formats instead of attempting OMR', () => {
  assert.equal(getScoreFileKind({ name: 'score.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), null);
});
