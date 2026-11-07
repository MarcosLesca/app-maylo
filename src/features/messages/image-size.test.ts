import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fitImage } from './image-size.ts';

test('landscape photos fill the bubble width and keep their ratio', () => {
  assert.deepEqual(fitImage(1600, 1200, 240), { width: 240, height: 180 });
});

test('portrait photos are capped in height so one photo never fills the screen', () => {
  assert.deepEqual(fitImage(1200, 1600, 240, 300), { width: 225, height: 300 });
});

test('small images are not upscaled', () => {
  assert.deepEqual(fitImage(120, 80, 240), { width: 120, height: 80 });
});

test('unknown sizes fall back to a square', () => {
  assert.deepEqual(fitImage(null, null, 240), { width: 240, height: 240 });
  assert.deepEqual(fitImage(0, 0, 240), { width: 240, height: 240 });
});
