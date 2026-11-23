import assert from 'node:assert/strict';
import { test } from 'node:test';

import { nowPlaying, nowPlayingText, remoteSubtitle, sentByText } from './now-playing.ts';

type Status = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error';

const report = (status: Status, extra: { title?: string; from?: string; connected?: boolean } = {}) => ({
  connected: extra.connected ?? true,
  address: '192.168.0.248',
  lastSeenMs: 5,
  playback: {
    status,
    position: 10,
    duration: 600,
    volume: 40,
    muted: false,
    error: null,
    title: extra.title ?? 'Peli',
    from: extra.from ?? 'Loana',
  },
});

test('the TV counts as playing something while it loads, plays or is paused, whoever cast it', () => {
  for (const status of ['loading', 'playing', 'paused'] as const) {
    assert.deepEqual(nowPlaying(report(status)), { address: '192.168.0.248', title: 'Peli', from: 'Loana' }, status);
  }
});

test('no bar when the TV is idle, ended, failed, gone or never reported', () => {
  for (const status of ['idle', 'ended', 'error'] as const) assert.equal(nowPlaying(report(status)), null, status);
  assert.equal(nowPlaying(report('playing', { connected: false })), null);
  assert.equal(nowPlaying({ connected: true, address: '192.168.0.248', lastSeenMs: 5, playback: null }), null);
  assert.equal(nowPlaying(null), null);
});

test('the sender is trimmed and a "MayLo de <name>" label becomes the name', () => {
  assert.equal(nowPlaying(report('playing', { from: '  Marcos ' }))?.from, 'Marcos');
  assert.equal(nowPlaying(report('playing', { from: 'MayLo de Loana' }))?.from, 'Loana');
  assert.equal(nowPlaying(report('playing', { from: '' }))?.from, '');
  assert.equal(nowPlaying(report('playing', { title: '  ' }))?.title, '');
});

test('bar text names the video and who sent it, without "lo mandó" when unknown', () => {
  assert.equal(
    nowPlayingText({ address: '192.168.0.248', title: 'Peli', from: 'Loana' }),
    'Ahora en la tele: Peli · lo mandó Loana',
  );
  assert.equal(nowPlayingText({ address: '192.168.0.248', title: 'Peli', from: '' }), 'Ahora en la tele: Peli');
  assert.equal(nowPlayingText({ address: '192.168.0.248', title: '', from: 'Loana' }), 'Ahora en la tele: un video · lo mandó Loana');
});

test('the remote says who sent the video under the title', () => {
  assert.equal(sentByText('Loana'), 'Lo mandó Loana');
  assert.equal(sentByText(''), '');
  assert.equal(remoteSubtitle('Video MP4', 'Loana'), 'Video MP4 · Lo mandó Loana');
  assert.equal(remoteSubtitle('', 'Loana'), 'Lo mandó Loana');
  assert.equal(remoteSubtitle('Video HLS', ''), 'Video HLS');
  assert.equal(remoteSubtitle('', ''), '');
});
