import assert from 'node:assert/strict';
import { test } from 'node:test';

import { downloadLabel, progressRatio } from './download-progress.ts';

test('progress is the downloaded fraction, clamped between 0 and 1', () => {
  assert.equal(progressRatio(0, 1000), 0);
  assert.equal(progressRatio(250, 1000), 0.25);
  assert.equal(progressRatio(1200, 1000), 1);
});

test('unknown total size gives no ratio (indeterminate bar)', () => {
  assert.equal(progressRatio(500, -1), null);
  assert.equal(progressRatio(500, 0), null);
});

test('the label shows percent and megabytes, or just megabytes when the size is unknown', () => {
  assert.equal(downloadLabel(17_825_792, 35_651_584), '50 % · 17 de 34 MB');
  assert.equal(downloadLabel(5_242_880, -1), '5 MB');
});
