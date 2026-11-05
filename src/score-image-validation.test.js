import test from 'node:test';
import assert from 'node:assert/strict';
import { friendlyRecognitionError, hasMusicStaffLines } from './score-image-validation.js';

function imageWithRows(width, height, staffRows = []) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i + 1] = data[i + 2] = 255;
    data[i + 3] = 255;
  }
  for (const y of staffRows) {
    for (let x = Math.floor(width * 0.1); x < Math.floor(width * 0.9); x++) {
      const offset = (y * width + x) * 4;
      data[offset] = data[offset + 1] = data[offset + 2] = 20;
    }
  }
  return { data, width, height };
}

test('recognises a five-line music staff in a camera image', () => {
  assert.equal(hasMusicStaffLines(imageWithRows(640, 360, [100, 106, 112, 118, 124])), true);
});

test('rejects a blank wall or ceiling image', () => {
  assert.equal(hasMusicStaffLines(imageWithRows(640, 360)), false);
});

test('rejects scattered horizontal marks that do not form a staff', () => {
  assert.equal(hasMusicStaffLines(imageWithRows(640, 360, [70, 95, 120, 145, 170])), false);
});

test('recognition errors are presented as useful guidance, not stack traces', () => {
  assert.match(friendlyRecognitionError(new Error('cv2.error: resize.cpp failed')), /straight-on/i);
  assert.doesNotMatch(friendlyRecognitionError(new Error('Traceback (most recent call last)')), /Traceback|resize\.cpp/);
});
