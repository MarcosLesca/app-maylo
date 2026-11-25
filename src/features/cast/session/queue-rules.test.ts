import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  afterPlaybackEnds,
  claimedItem,
  oldestQueueItem,
  QUEUE_FAILURE_MESSAGE,
  queueCandidate,
  queuedByText,
  queueInsert,
} from './queue-rules.ts';

const candidate = {
  url: 'https://cdn.example.com/hls/master.m3u8?token=1',
  pageUrl: 'https://player.example.com/embed/9',
  title: 'Capítulo 3',
  userAgent: 'UA-frame',
  cookie: 'sid=secret',
};

test('a queued video keeps the URL, Referer, User-Agent, cookie, top page and title', () => {
  const row = queueInsert(candidate, 'https://series.example.com/watch/3#player', 'Serie — página');
  assert.deepEqual(row, {
    video_url: 'https://cdn.example.com/hls/master.m3u8?token=1',
    referer: 'https://player.example.com/embed/9',
    user_agent: 'UA-frame',
    cookie: 'sid=secret',
    page_url: 'https://series.example.com/watch/3#player',
    title: 'Capítulo 3',
  });
  // No cookie on the page: stored as null, not ''.
  assert.equal(queueInsert({ ...candidate, cookie: '' }, 'https://a.com/x', '')?.cookie, null);
  assert.equal(queueInsert({ ...candidate, cookie: undefined }, 'https://a.com/x', '')?.cookie, null);
});

test('a queued row becomes the candidate the TV casts, cookie header included', () => {
  const row = {
    video_url: 'https://cdn.example.com/a.mp4',
    referer: 'https://player.example.com/embed/9',
    user_agent: 'UA-frame',
    cookie: 'sid=secret',
    title: 'Capítulo 3',
  };
  assert.deepEqual(queueCandidate(row), {
    url: 'https://cdn.example.com/a.mp4',
    pageUrl: 'https://player.example.com/embed/9',
    title: 'Capítulo 3',
    userAgent: 'UA-frame',
    cookie: 'sid=secret',
  });
  assert.equal(queueCandidate({ ...row, cookie: null, user_agent: null }).cookie, '');
  assert.equal(queueCandidate({ ...row, cookie: null, user_agent: null }).userAgent, '');
});

test('the queued title falls back to the page title, then a default, and is capped', () => {
  assert.equal(queueInsert({ ...candidate, title: '  ' }, 'https://a.com/x', ' Página ')?.title, 'Página');
  assert.equal(queueInsert({ ...candidate, title: '' }, 'https://a.com/x', '')?.title, 'Video');
  assert.equal(queueInsert({ ...candidate, title: 'x'.repeat(300) }, 'https://a.com/x', '')?.title.length, 200);
});

test('only http(s) videos from an http(s) page can be queued; the referer falls back to the top page', () => {
  assert.equal(queueInsert({ ...candidate, url: 'blob:https://a.com/1' }, 'https://a.com/x', ''), null);
  assert.equal(queueInsert(candidate, 'about:blank', ''), null);
  assert.equal(queueInsert({ ...candidate, pageUrl: '' }, 'https://a.com/x', '')?.referer, 'https://a.com/x');
});

test('the oldest queued item goes next (created_at, then id); an empty queue has none', () => {
  const items = [
    { id: 'c', created_at: '2026-11-25T10:00:02Z' },
    { id: 'b', created_at: '2026-11-25T10:00:01Z' },
    { id: 'a', created_at: '2026-11-25T10:00:01Z' },
  ];
  assert.equal(oldestQueueItem(items)?.id, 'a');
  assert.equal(oldestQueueItem([]), null);
});

test('only the phone whose delete returned the row casts it', () => {
  const row = { id: 'q1', title: 'Peli' };
  assert.deepEqual(claimedItem('q1', [row]), row);
  // The other phone deleted it first: the delete returns nothing.
  assert.equal(claimedItem('q1', []), null);
  assert.equal(claimedItem('q1', null), null);
  // A row that is not the one asked for is never cast.
  assert.equal(claimedItem('q1', [{ id: 'q2', title: 'Otra' }]), null);
});

test('when a cast ends: advance with a queue, else offer the next episode, else nothing', () => {
  const next = { url: 'https://series.example.com/watch/4', label: 'Siguiente episodio' };
  assert.deepEqual(afterPlaybackEnds({ queueLength: 2, nextEpisode: next }), { kind: 'advance' });
  assert.deepEqual(afterPlaybackEnds({ queueLength: 0, nextEpisode: next }), { kind: 'offer-next', url: next.url });
  assert.deepEqual(afterPlaybackEnds({ queueLength: 0, nextEpisode: null }), { kind: 'idle' });
});

test('failure message and who added each item', () => {
  assert.equal(QUEUE_FAILURE_MESSAGE, 'No se pudo reproducir. Abrí la página para enviarlo de nuevo.');
  assert.equal(queuedByText('Loana'), 'Lo agregó Loana');
  assert.equal(queuedByText('  '), '');
});
