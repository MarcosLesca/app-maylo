import assert from 'node:assert/strict';
import { test } from 'node:test';

import { monthGrid, toIsoDate } from './calendar.ts';

test('weeks start on Monday and pad the first week with empty cells', () => {
  // 1 Nov 2026 is a Sunday: six empty cells, then the 1st.
  const weeks = monthGrid('2026-11-01');
  assert.deepEqual(weeks[0], [null, null, null, null, null, null, '2026-11-01']);
  assert.deepEqual(weeks[1].slice(0, 2), ['2026-11-02', '2026-11-03']);
});

test('the grid covers every day of the month exactly once, in 7-day rows', () => {
  const weeks = monthGrid('2026-11-01');
  assert.ok(weeks.every((week) => week.length === 7));
  const days = weeks.flat().filter((d) => d !== null);
  assert.equal(days.length, 30);
  assert.equal(days[0], '2026-11-01');
  assert.equal(days[29], '2026-11-30');
});

test('a month starting on Monday with 28 days fills exactly four weeks', () => {
  const weeks = monthGrid('2027-02-01');
  assert.equal(weeks.length, 4);
  assert.ok(weeks.flat().every((d) => d !== null));
});

test('leap years get 29 days in February', () => {
  const days = monthGrid('2028-02-01').flat().filter((d) => d !== null);
  assert.equal(days.at(-1), '2028-02-29');
});

test('toIsoDate uses the local calendar day', () => {
  assert.equal(toIsoDate(new Date(2027, 1, 14, 23, 30)), '2027-02-14');
});
