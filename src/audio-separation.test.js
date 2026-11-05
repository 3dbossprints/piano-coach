import test from 'node:test';
import assert from 'node:assert/strict';
import { encodePcm16Wav } from './audio-separation.js';

test('encodes mono PCM16 WAV with a valid RIFF header', () => {
  const wav = encodePcm16Wav([Float32Array.from([-1, 0, 1])], 44100);
  const view = new DataView(wav);
  assert.equal(String.fromCharCode(...new Uint8Array(wav.slice(0, 4))), 'RIFF');
  assert.equal(String.fromCharCode(...new Uint8Array(wav.slice(8, 12))), 'WAVE');
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), 44100);
  assert.equal(view.getUint32(40, true), 6);
  assert.equal(view.getInt16(44, true), -32768);
  assert.equal(view.getInt16(46, true), 0);
  assert.equal(view.getInt16(48, true), 32767);
});

test('interleaves stereo channels without collapsing them to mono', () => {
  const wav = encodePcm16Wav([
    Float32Array.from([0.5, -0.5]),
    Float32Array.from([-0.25, 0.25])
  ], 48000);
  const view = new DataView(wav);
  assert.equal(view.getUint16(22, true), 2);
  assert.equal(view.getInt16(44, true), 16384);
  assert.equal(view.getInt16(46, true), -8192);
  assert.equal(view.getInt16(48, true), -16384);
  assert.equal(view.getInt16(50, true), 8192);
});

test('rejects invalid or mismatched audio channels', () => {
  assert.throws(() => encodePcm16Wav([], 44100), /Float32 audio channels/);
  assert.throws(() => encodePcm16Wav([new Float32Array(2), new Float32Array(1)], 44100), /same non-zero number/);
});
