import assert from 'node:assert/strict';
import { test } from 'node:test';

import { recentHistory, toHistoryEntry } from './history.ts';

test('a history entry is the top page without its fragment and a trimmed title (host when empty)', () => {
  assert.deepEqual(toHistoryEntry('https://www.series.example.com/watch/3#player', '  Capítulo  3 '), {
    url: 'https://www.series.example.com/watch/3',
    title: 'Capítulo 3',
  });
  assert.deepEqual(toHistoryEntry('https://series.example.com/watch/3', ''), {
    url: 'https://series.example.com/watch/3',
    title: 'series.example.com',
  });
  assert.equal(toHistoryEntry('about:blank', 'x'), null);
  assert.equal(toHistoryEntry('https://a.com/', 'x'.repeat(300))?.title.length, 120);
});

test('the start screen shows the 8 most recent pages, newest first, once each', () => {
  const rows = Array.from({ length: 10 }, (_, index) => ({
    id: `r${index}`,
    url: `https://a.com/${index}`,
    title: `Video ${index}`,
    last_watched_at: `2026-11-25T10:00:${String(index).padStart(2, '0')}Z`,
  }));
  rows.push({ id: 'dup', url: 'https://www.A.com/9/', title: 'Video 9 otra vez', last_watched_at: '2026-11-25T09:00:00Z' });
  const recent = recentHistory(rows);
  assert.deepEqual(
    recent.map((row) => row.id),
    ['r9', 'r8', 'r7', 'r6', 'r5', 'r4', 'r3', 'r2'],
  );
  assert.equal(recentHistory(rows, 3).length, 3);
  assert.deepEqual(recentHistory([]), []);
});
