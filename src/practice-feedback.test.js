import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeAudioReview } from './practice-feedback.js';

test('feedback is learner-facing and does not expose diagnostic metrics', () => {
  const result = summarizeAudioReview({ rms: 0.1, peak: 0.8, clippedRatio: 0, noteCount: 42, medianGap: 0.3 });
  assert.match(result, /42 note events/);
  assert.match(result, /check the generated notation/i);
  assert.doesNotMatch(result, /waveform RMS|peak 0\.8|clipped samples|seconds\./i);
});

test('quiet or clipped recordings get specific next steps', () => {
  const result = summarizeAudioReview({ rms: 0.005, peak: 1, clippedRatio: 0.02, noteCount: 10 });
  assert.match(result, /recording level is quiet/i);
  assert.match(result, /clipping/i);
});

test('target comparison reports the measured count without claiming success', () => {
  const result = summarizeAudioReview({ noteCount: 4, targetComparison: { correct: 0, total: 4 } });
  assert.match(result, /0 of 4 expected notes matched/);
  assert.doesNotMatch(result, /you played|you matched all/i);
});
