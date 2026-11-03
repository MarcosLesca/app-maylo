import assert from 'node:assert/strict';
import { test } from 'node:test';

import { currentPeriod, formatPeriod, isIsoDate, shiftPeriod } from './period.ts';

test('current period is the first day of the month', () => {
  assert.equal(currentPeriod(new Date(2026, 10, 3)), '2026-11-01');
  assert.equal(currentPeriod(new Date(2027, 0, 31)), '2027-01-01');
});

test('shifting crosses year boundaries in both directions', () => {
  assert.equal(shiftPeriod('2026-12-01', 1), '2027-01-01');
  assert.equal(shiftPeriod('2026-01-01', -1), '2025-12-01');
  assert.equal(shiftPeriod('2026-11-01', 0), '2026-11-01');
});

test('formats a period as month and year', () => {
  assert.equal(formatPeriod('2026-11-01'), 'November 2026');
});

test('validates real ISO dates only', () => {
  assert.equal(isIsoDate('2027-02-14'), true);
  assert.equal(isIsoDate('2027-02-30'), false);
  assert.equal(isIsoDate('14/02/2027'), false);
});
