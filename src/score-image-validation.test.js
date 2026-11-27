import test from 'node:test';
import assert from 'node:assert/strict';
import { friendlyRecognitionError, hasMusicStaffLines } from './score-image-validation.js';

function blankImage(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i + 1] = data[i + 2] = 255;
    data[i + 3] = 255;
  }
  return { data, width, height };
}

function imageWithRows(width, height, staffRows = [], { ink = 20, start = 0.1, end = 0.9, angle = 0 } = {}) {
  const image = blankImage(width, height);
  const slope = Math.tan(angle * Math.PI / 180);
  for (const baseY of staffRows) {
    for (let x = Math.floor(width * start); x < Math.floor(width * end); x++) {
      const y = Math.round(baseY + slope * (x - width / 2));
      if (y < 0 || y >= height) continue;
      const offset = (y * width + x) * 4;
      image.data[offset] = image.data[offset + 1] = image.data[offset + 2] = ink;
    }
  }
  return image;
}

test('recognises a five-line music staff in a camera image', () => {
  assert.equal(hasMusicStaffLines(imageWithRows(640, 360, [100, 106, 112, 118, 124])), true);
});

test('recognises a slightly skewed staff in a phone photo', () => {
  assert.equal(hasMusicStaffLines(imageWithRows(640, 360, [100, 106, 112, 118, 124], { angle: 2.5 })), true);
});

test('recognises lighter printed staff lines with page margins', () => {
  assert.equal(hasMusicStaffLines(imageWithRows(640, 360, [100, 106, 112, 118, 124], { ink: 135, start: 0.16, end: 0.84 })), true);
});

test('rejects a blank wall or ceiling image', () => {
  assert.equal(hasMusicStaffLines(blankImage(640, 360)), false);
});

test('rejects scattered horizontal marks that do not form a staff', () => {
  assert.equal(hasMusicStaffLines(imageWithRows(640, 360, [70, 95, 120, 145, 170])), false);
});

test('recognition errors are presented as useful guidance, not stack traces', () => {
  assert.match(friendlyRecognitionError(new Error('cv2.error: resize.cpp failed')), /straight-on/i);
  assert.doesNotMatch(friendlyRecognitionError(new Error('Traceback (most recent call last)')), /Traceback|resize\.cpp/);
});
