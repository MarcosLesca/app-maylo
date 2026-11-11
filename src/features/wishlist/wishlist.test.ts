import assert from 'node:assert/strict';
import { test } from 'node:test';

import { groupWishlist, type WishItem } from './wishlist.ts';

const item = (id: string, eaten: boolean, planned_month: string | null): WishItem => ({
  id,
  name: id,
  eaten,
  planned_month,
});

test('pending items are grouped by month, oldest month first, unplanned last', () => {
  const { pending } = groupWishlist([
    item('sushi', false, null),
    item('asado', false, '2027-01-01'),
    item('ramen', false, '2026-12-01'),
    item('pizza', false, '2027-01-01'),
  ]);
  assert.deepEqual(
    pending.map((s) => [s.month, s.items.map((i) => i.id)]),
    [
      ['2026-12-01', ['ramen']],
      ['2027-01-01', ['asado', 'pizza']],
      [null, ['sushi']],
    ],
  );
});

test('eaten items leave the pending sections and are counted apart', () => {
  const { pending, eaten } = groupWishlist([
    item('sushi', true, '2026-12-01'),
    item('ramen', false, '2026-12-01'),
    item('tacos', true, null),
  ]);
  assert.deepEqual(pending.map((s) => [s.month, s.items.map((i) => i.id)]), [['2026-12-01', ['ramen']]]);
  assert.deepEqual(eaten.map((i) => i.id), ['sushi', 'tacos']);
});

test('an empty list has no sections', () => {
  assert.deepEqual(groupWishlist([]), { pending: [], eaten: [] });
});
