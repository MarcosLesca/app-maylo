import assert from 'node:assert/strict';
import { test } from 'node:test';

import { dosesFor, effectiveWeek, planWeek, weekStartOf, weightChart } from './plan.ts';

test('the current plan week starts every 7 days from the start date', () => {
  assert.equal(weekStartOf('2026-11-02', '2026-11-02'), '2026-11-02');
  assert.equal(weekStartOf('2026-11-02', '2026-11-10'), '2026-11-09');
  assert.equal(weekStartOf('2026-11-02', '2026-12-31'), '2026-12-28'); // keeps rolling in week 5+
  assert.equal(weekStartOf('2026-11-02', '2026-10-30'), '2026-11-02'); // before the start
});

test('the plan week counts from the start date and tops out at 5 (5+)', () => {
  assert.equal(planWeek('2026-11-02', '2026-11-01'), 0); // not started yet
  assert.equal(planWeek('2026-11-02', '2026-11-02'), 1);
  assert.equal(planWeek('2026-11-02', '2026-11-08'), 1);
  assert.equal(planWeek('2026-11-02', '2026-11-09'), 2);
  assert.equal(planWeek('2026-11-02', '2026-11-30'), 5);
  assert.equal(planWeek('2026-11-02', '2027-03-01'), 5);
});

test('choosing to maintain keeps week 4 values from week 5 on', () => {
  assert.equal(effectiveWeek(5, 'maintain'), 4);
  assert.equal(effectiveWeek(5, 'continue'), 5);
  assert.equal(effectiveWeek(5, null), 5);
  assert.equal(effectiveWeek(3, 'maintain'), 3);
});

test('doses match the plan tables for training and rest days', () => {
  assert.deepEqual(dosesFor(1, 'training'), {
    potatoG: 635, peanutsG: 60, oilTsp: 2, breadG: 60, kcal: 1620, protein: 125, carbs: 169, fat: 51,
  });
  assert.deepEqual(dosesFor(4, 'rest'), {
    potatoG: 500, peanutsG: 80, oilTsp: 3, breadG: 60, kcal: 1660, protein: 128, carbs: 145, fat: 65,
  });
  assert.equal(dosesFor(5, 'training').potatoG, 1000);
  assert.equal(dosesFor(5, 'rest').kcal, 1745);
});

test('before the start, week 1 doses are shown', () => {
  assert.equal(dosesFor(0, 'training').potatoG, 635);
});

test('the weight chart maps points into the box, oldest left and lightest at the bottom', () => {
  const chart = weightChart(
    [
      { day: '2026-11-01', kg: 80 },
      { day: '2026-11-08', kg: 79 },
      { day: '2026-11-15', kg: 78 },
    ],
    200,
    100,
    10,
  );
  assert.equal(chart.points[0].x, 10);
  assert.equal(chart.points[2].x, 190);
  assert.equal(chart.points[0].y, 10); // heaviest at the top
  assert.equal(chart.points[2].y, 90); // lightest at the bottom
  assert.ok(chart.path.startsWith('M10 10'));
});

test('a single weight or a flat line still draws inside the box', () => {
  const one = weightChart([{ day: '2026-11-01', kg: 80 }], 200, 100, 10);
  assert.deepEqual(one.points, [{ x: 100, y: 50, day: '2026-11-01', kg: 80 }]);
  const flat = weightChart(
    [
      { day: '2026-11-01', kg: 80 },
      { day: '2026-11-08', kg: 80 },
    ],
    200,
    100,
    10,
  );
  assert.ok(flat.points.every((p) => p.y === 50));
});
