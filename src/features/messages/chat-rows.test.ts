import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildChatRows, dayLabel, deliveryStatus } from './chat-rows.ts';

test('my messages show sent until the other phone receives them, then delivered', () => {
  const base = { id: 'a', body: 'hola', sender_id: 'me', created_at: '2026-11-06T12:00:00Z' };
  assert.equal(deliveryStatus({ ...base, delivered_at: null }, 'me'), 'sent');
  assert.equal(deliveryStatus({ ...base, delivered_at: '2026-11-06T12:00:05Z' }, 'me'), 'delivered');
});

test('messages from the other person show no delivery status', () => {
  const theirs = { id: 'b', body: 'hola', sender_id: 'her', created_at: '2026-11-06T12:00:00Z', delivered_at: null };
  assert.equal(deliveryStatus(theirs, 'me'), null);
});

const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).toISOString();
const NOW = new Date(2026, 10, 6, 20, 0); // 6 Nov 2026, 20:00 local

test('day labels say Hoy, Ayer, or a short date', () => {
  assert.equal(dayLabel(at(2026, 11, 6, 8), NOW), 'Hoy');
  assert.equal(dayLabel(at(2026, 11, 5, 23), NOW), 'Ayer');
  assert.equal(dayLabel(at(2026, 11, 1), NOW), '1 nov');
});

test('dates from another year include the year', () => {
  assert.equal(dayLabel(at(2025, 12, 31), NOW), '31 dic 2025');
});

test('a day separator opens each day and messages keep their order', () => {
  const rows = buildChatRows(
    [
      { id: 'a', body: 'hola', sender_id: 'me', created_at: at(2026, 11, 5, 21, 5) },
      { id: 'b', body: 'buenas', sender_id: 'her', created_at: at(2026, 11, 5, 21, 7) },
      { id: 'c', body: '¿cenamos?', sender_id: 'her', created_at: at(2026, 11, 6, 9, 30) },
    ],
    'me',
    NOW,
  );
  assert.deepEqual(
    rows.map((r) => (r.type === 'day' ? `day:${r.label}` : `msg:${r.message.id}`)),
    ['day:Ayer', 'msg:a', 'msg:b', 'day:Hoy', 'msg:c'],
  );
});

test('each message knows whether it is mine and its local time', () => {
  const rows = buildChatRows(
    [
      { id: 'a', body: 'hola', sender_id: 'me', created_at: at(2026, 11, 6, 9, 5) },
      { id: 'b', body: 'hola!', sender_id: 'her', created_at: at(2026, 11, 6, 9, 7) },
    ],
    'me',
    NOW,
  );
  const messages = rows.filter((r) => r.type === 'message');
  assert.deepEqual(
    messages.map((r) => r.type === 'message' && [r.mine, r.time]),
    [
      [true, '09:05'],
      [false, '09:07'],
    ],
  );
});

test('no messages, no rows', () => {
  assert.deepEqual(buildChatRows([], 'me', NOW), []);
});
