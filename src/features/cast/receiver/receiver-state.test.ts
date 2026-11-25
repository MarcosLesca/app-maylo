import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  connectionText,
  generateKey,
  isReceiverKey,
  parseReceiverPlayback,
  parseReceiverReport,
  receiverFlags,
  receiverLabel,
  serializeCommand,
} from './receiver-state.ts';

test('a receiver key is 6 characters of [A-Za-z0-9], also at the edges of the random range', () => {
  for (let index = 0; index < 200; index++) assert.match(generateKey(), /^[A-Za-z0-9]{6}$/);
  assert.equal(generateKey(() => 0), 'AAAAAA');
  assert.equal(generateKey(() => 0.999999), '999999');
  // A broken random source (1 or NaN) still yields a valid key.
  assert.match(generateKey(() => 1), /^[A-Za-z0-9]{6}$/);
  assert.match(generateKey(() => Number.NaN), /^[A-Za-z0-9]{6}$/);
});

test('only stored values of exactly 6 letters/digits are reused as the key', () => {
  assert.equal(isReceiverKey('aB3dE9'), true);
  for (const bad of ['aB3dE', 'aB3dE9x', 'aB3-E9', '', null, undefined, 123456, 'ñB3dE9']) {
    assert.equal(isReceiverKey(bad), false, String(bad));
  }
});

test('commands are serialized as JSON objects with clamped, validated values', () => {
  assert.deepEqual(JSON.parse(serializeCommand({ type: 'load', url: 'http://192.168.0.249:8765/s/t/aGk/x.mp4', title: 'Peli' })), {
    type: 'load',
    url: 'http://192.168.0.249:8765/s/t/aGk/x.mp4',
    title: 'Peli',
  });
  assert.deepEqual(JSON.parse(serializeCommand({ type: 'play' })), { type: 'play' });
  assert.deepEqual(JSON.parse(serializeCommand({ type: 'pause' })), { type: 'pause' });
  assert.deepEqual(JSON.parse(serializeCommand({ type: 'stop' })), { type: 'stop' });
  assert.deepEqual(JSON.parse(serializeCommand({ type: 'seek', seconds: 12.5 })), { type: 'seek', seconds: 12.5 });
  assert.deepEqual(JSON.parse(serializeCommand({ type: 'seek', seconds: -4 })), { type: 'seek', seconds: 0 });
  assert.deepEqual(JSON.parse(serializeCommand({ type: 'volume', level: 140 })), { type: 'volume', level: 100 });
  assert.deepEqual(JSON.parse(serializeCommand({ type: 'volume', level: 33.6 })), { type: 'volume', level: 34 });
  assert.deepEqual(JSON.parse(serializeCommand({ type: 'volume', level: -1 })), { type: 'volume', level: 0 });
  assert.deepEqual(JSON.parse(serializeCommand({ type: 'mute', muted: true })), { type: 'mute', muted: true });
  assert.throws(() => serializeCommand({ type: 'load', url: 'javascript:alert(1)', title: 'x' }), /http/);
  assert.throws(() => serializeCommand({ type: 'seek', seconds: Number.NaN }), /seek/);
});

test('reported state is parsed into a typed playback; junk fields become null/defaults', () => {
  assert.deepEqual(
    parseReceiverPlayback(
      JSON.stringify({ status: 'playing', position: 12.3, duration: 600, volume: 80, muted: false, error: null, title: 'Peli' }),
    ),
    { status: 'playing', position: 12.3, duration: 600, volume: 80, muted: false, error: null, title: 'Peli', from: '' },
  );
  assert.deepEqual(parseReceiverPlayback(JSON.stringify({ status: 'error', error: 'No se pudo reproducir este video', position: 'x', volume: 300 })), {
    status: 'error',
    position: null,
    duration: null,
    volume: 100,
    muted: false,
    error: 'No se pudo reproducir este video',
    title: '',
    from: '',
  });
  assert.equal(parseReceiverPlayback(JSON.stringify({ status: 'dancing' })), null);
  assert.equal(parseReceiverPlayback('not json'), null);
  assert.equal(parseReceiverPlayback(''), null);
  assert.equal(parseReceiverPlayback('[]'), null);
});

test('the reported sender (from) is kept trimmed and short; anything else is empty', () => {
  assert.equal(parseReceiverPlayback(JSON.stringify({ status: 'playing', title: 'Peli', from: 'Loana' }))?.from, 'Loana');
  assert.equal(parseReceiverPlayback(JSON.stringify({ status: 'paused', from: '  Marcos  ' }))?.from, 'Marcos');
  assert.equal(parseReceiverPlayback(JSON.stringify({ status: 'playing', from: 'x'.repeat(80) }))?.from, 'x'.repeat(60));
  for (const bad of [42, null, ['Loana'], { name: 'Loana' }]) {
    assert.equal(parseReceiverPlayback(JSON.stringify({ status: 'playing', from: bad }))?.from, '', JSON.stringify(bad));
  }
  // Older TV pages send no `from`.
  assert.equal(parseReceiverPlayback(JSON.stringify({ status: 'playing' }))?.from, '');
});

test('the native report becomes connected/address/playback', () => {
  assert.deepEqual(
    parseReceiverReport({ connected: true, address: '::ffff:192.168.0.248', lastSeenMs: 5, state: '{"status":"idle"}' }),
    {
      connected: true,
      address: '192.168.0.248',
      lastSeenMs: 5,
      playback: { status: 'idle', position: null, duration: null, volume: null, muted: false, error: null, title: '', from: '' },
    },
  );
  assert.deepEqual(parseReceiverReport({ connected: false, address: '', lastSeenMs: 0, state: '' }), {
    connected: false,
    address: '',
    lastSeenMs: 0,
    playback: null,
  });
  assert.deepEqual(parseReceiverReport(null), { connected: false, address: '', lastSeenMs: 0, playback: null });
});

test('labels for the sheet and the connect screen', () => {
  assert.equal(receiverLabel('192.168.0.248'), 'Navegador de la tele (192.168.0.248)');
  assert.equal(receiverLabel(''), 'Navegador de la tele');
  assert.equal(connectionText(null), 'Esperando a la tele…');
  assert.equal(connectionText({ connected: false, address: '192.168.0.248', lastSeenMs: 0, playback: null }), 'Esperando a la tele…');
  assert.equal(
    connectionText({ connected: true, address: '192.168.0.248', lastSeenMs: 0, playback: null }),
    'Tele conectada (192.168.0.248)',
  );
});

test('the reported status maps to paused / failed / ended; ended is not just paused', () => {
  assert.deepEqual(receiverFlags('playing'), { paused: false, failed: false, ended: false });
  assert.deepEqual(receiverFlags('loading'), { paused: false, failed: false, ended: false });
  assert.deepEqual(receiverFlags('paused'), { paused: true, failed: false, ended: false });
  assert.deepEqual(receiverFlags('ended'), { paused: true, failed: false, ended: true });
  assert.deepEqual(receiverFlags('error'), { paused: true, failed: true, ended: false });
  assert.deepEqual(receiverFlags('idle'), { paused: true, failed: false, ended: false });
});
