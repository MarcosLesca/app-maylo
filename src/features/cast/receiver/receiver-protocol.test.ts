import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CommandQueue,
  commandsBody,
  CONNECTED_WINDOW_MS,
  isConnected,
  isReceiverKey,
  LONG_POLL_MS,
  MAX_COMMANDS,
  MAX_LONG_POLLS,
  MAX_STATE_BYTES,
  parseAfter,
  RECEIVER_PORTS,
  routeReceiver,
  stateBodyError,
} from './receiver-protocol.ts';

const KEY = 'aB3xY9';

test('the receiver tries port 8765 first, then the next ones up to 8775', () => {
  assert.deepEqual(RECEIVER_PORTS, [8765, 8766, 8767, 8768, 8769, 8770, 8771, 8772, 8773, 8774, 8775]);
});

test('protocol limits match the contract', () => {
  assert.equal(MAX_COMMANDS, 50);
  assert.equal(MAX_STATE_BYTES, 16 * 1024);
  assert.equal(LONG_POLL_MS, 25_000);
  assert.equal(MAX_LONG_POLLS, 2);
  assert.equal(CONNECTED_WINDOW_MS, 5_000);
});

test('a key is exactly 6 ASCII letters or digits', () => {
  assert.equal(isReceiverKey('aB3xY9'), true);
  assert.equal(isReceiverKey('000000'), true);
  assert.equal(isReceiverKey('aB3xY'), false);
  assert.equal(isReceiverKey('aB3xY9z'), false);
  assert.equal(isReceiverKey('aB3x-9'), false);
  assert.equal(isReceiverKey('aB3xñ9'), false);
  assert.equal(isReceiverKey(''), false);
  assert.equal(isReceiverKey('aB3xY9\n'), false);
});

test('receiver routes with the right key', () => {
  assert.deepEqual(routeReceiver('GET', `/tv/${KEY}`, KEY), { kind: 'page' });
  assert.deepEqual(routeReceiver('GET', `/tv/${KEY}/`, KEY), { kind: 'page' });
  assert.deepEqual(routeReceiver('HEAD', `/tv/${KEY}?x=1`, KEY), { kind: 'page' });
  assert.deepEqual(routeReceiver('GET', `/tv/${KEY}/hls.js`, KEY), { kind: 'hls' });
  assert.deepEqual(routeReceiver('GET', `/tv/${KEY}/commands?after=12`, KEY), { kind: 'commands', after: 12 });
  assert.deepEqual(routeReceiver('GET', `/tv/${KEY}/commands`, KEY), { kind: 'commands', after: 0 });
  assert.deepEqual(routeReceiver('POST', `/tv/${KEY}/state`, KEY), { kind: 'state' });
});

test('a wrong key, a stopped receiver or an unknown path is not found', () => {
  assert.deepEqual(routeReceiver('GET', '/tv/zzzzzz', KEY), { kind: 'not-found' });
  assert.deepEqual(routeReceiver('GET', `/tv/${KEY.toLowerCase()}`, KEY), { kind: 'not-found' });
  assert.deepEqual(routeReceiver('GET', '/tv/zzzzzz/hls.js', KEY), { kind: 'not-found' });
  assert.deepEqual(routeReceiver('POST', '/tv/zzzzzz/state', KEY), { kind: 'not-found' });
  assert.deepEqual(routeReceiver('GET', `/tv/${KEY}`, ''), { kind: 'not-found' });
  assert.deepEqual(routeReceiver('GET', '/tv/', ''), { kind: 'not-found' });
  assert.deepEqual(routeReceiver('GET', '/tv', KEY), { kind: 'not-found' });
  assert.deepEqual(routeReceiver('GET', `/tv/${KEY}/other`, KEY), { kind: 'not-found' });
  assert.deepEqual(routeReceiver('GET', `/tv/${KEY}/hls.js/x`, KEY), { kind: 'not-found' });
  assert.deepEqual(routeReceiver('GET', `/tv/${KEY}x`, KEY), { kind: 'not-found' });
});

test('a known receiver path with the wrong method is rejected', () => {
  assert.deepEqual(routeReceiver('POST', `/tv/${KEY}`, KEY), { kind: 'method-not-allowed' });
  assert.deepEqual(routeReceiver('POST', `/tv/${KEY}/commands`, KEY), { kind: 'method-not-allowed' });
  assert.deepEqual(routeReceiver('GET', `/tv/${KEY}/state`, KEY), { kind: 'method-not-allowed' });
  assert.deepEqual(routeReceiver('DELETE', `/tv/${KEY}/hls.js`, KEY), { kind: 'method-not-allowed' });
});

test('paths outside /tv are left to the proxy', () => {
  assert.equal(routeReceiver('GET', '/s/abc/def', KEY), null);
  assert.equal(routeReceiver('GET', '/', KEY), null);
  assert.equal(routeReceiver('GET', '/tvx/aB3xY9', KEY), null);
});

test('after= is a non-negative integer; anything else means from the start', () => {
  assert.equal(parseAfter('after=7'), 7);
  assert.equal(parseAfter('x=1&after=1700000000123'), 1_700_000_000_123);
  assert.equal(parseAfter(''), 0);
  assert.equal(parseAfter('after='), 0);
  assert.equal(parseAfter('after=-3'), 0);
  assert.equal(parseAfter('after=abc'), 0);
  assert.equal(parseAfter('after=1e3'), 0);
  assert.equal(parseAfter('after=1234567890123456'), 0);
});

test('commands must be JSON objects; their id is assigned by the queue', () => {
  const queue = new CommandQueue(1);
  assert.equal(queue.push('{"type":"load","url":"http://x/a.mp4","title":"A"}'), 1);
  assert.equal(queue.push('{"id":99,"type":"play"}'), 2);
  assert.deepEqual(queue.since(0), [
    '{"id":1,"type":"load","url":"http://x/a.mp4","title":"A"}',
    '{"id":2,"type":"play"}',
  ]);
  for (const bad of ['[]', '"play"', '3', 'null', '', 'not json', '{"a":1} x']) {
    assert.throws(() => queue.push(bad), /JSON object/);
  }
  assert.equal(queue.lastId, 2);
});

test('commands come in order, after the given id, at most once per cursor', () => {
  const queue = new CommandQueue(100);
  queue.push('{"type":"play"}');
  queue.push('{"type":"pause"}');
  queue.push('{"type":"seek","seconds":30}');
  assert.deepEqual(queue.since(100), ['{"id":101,"type":"pause"}', '{"id":102,"type":"seek","seconds":30}']);
  assert.deepEqual(queue.since(102), []);
});

test('a cursor beyond the highest id this run issued (the phone restarted) means after=0', () => {
  const queue = new CommandQueue(1);
  assert.deepEqual(queue.since(57), []);
  queue.push('{"type":"stop"}');
  queue.push('{"type":"play"}');
  assert.deepEqual(queue.since(57), ['{"id":1,"type":"stop"}', '{"id":2,"type":"play"}']);
  assert.deepEqual(queue.since(2), []);
  // Cleared commands still count as issued: their cursor is not "beyond".
  queue.clear();
  queue.push('{"type":"pause"}');
  assert.deepEqual(queue.since(2), ['{"id":3,"type":"pause"}']);
});

test('the contract commands keep their fields', () => {
  const queue = new CommandQueue(1);
  queue.push('{"type":"volume","level":40}');
  queue.push('{"type":"mute","muted":true}');
  assert.deepEqual(queue.since(0), ['{"id":1,"type":"volume","level":40}', '{"id":2,"type":"mute","muted":true}']);
});

test('the queue keeps only the last 50 commands and clear() keeps ids increasing', () => {
  const queue = new CommandQueue(1);
  for (let index = 0; index < 60; index += 1) queue.push(`{"n":${index}}`);
  const all = queue.since(0);
  assert.equal(all.length, 50);
  assert.equal(all[0], '{"id":11,"n":10}');
  assert.equal(all[49], '{"id":60,"n":59}');
  queue.clear();
  assert.deepEqual(queue.since(0), []);
  assert.equal(queue.push('{"type":"play"}'), 61);
});

test('the commands response wraps the pending commands', () => {
  assert.equal(commandsBody([]), '{"commands":[]}');
  assert.equal(commandsBody(['{"id":1,"type":"play"}', '{"id":2}']), '{"commands":[{"id":1,"type":"play"},{"id":2}]}');
});

test('the state body needs a Content-Length of at most 16 KB', () => {
  assert.equal(stateBodyError('0'), null);
  assert.equal(stateBodyError('16384'), null);
  assert.equal(stateBodyError('16385'), 413);
  assert.equal(stateBodyError('99999999999999999999'), 413);
  assert.equal(stateBodyError(undefined), 411);
  assert.equal(stateBodyError('abc'), 411);
  assert.equal(stateBodyError('-1'), 411);
});

test('connected means a state seen within the last 5 s', () => {
  assert.equal(isConnected(0, 10_000), false);
  assert.equal(isConnected(10_000, 10_000), true);
  assert.equal(isConnected(10_000, 15_000), true);
  assert.equal(isConnected(10_000, 15_001), false);
});
