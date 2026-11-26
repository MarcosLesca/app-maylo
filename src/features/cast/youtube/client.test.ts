import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  PLAYER_URL,
  STREAM_HEADERS,
  VISIONOS_CLIENT,
  playerHeaders,
  playerRequestBody,
  withoutCookies,
} from './client.ts';

const VISITOR = 'CgtRTHJCX3VRLXdmayiBz53YBjIKCgJBUhIEGgAgXw==';
const SAFARI = /^Mozilla\/5\.0 \(Macintosh; Intel Mac OS X 10_15_7\) AppleWebKit\/605\.1\.15 \(KHTML, like Gecko\) Version\/26\.\d+ Safari\/605\.1\.15$/;

test('the player is asked as the VISIONOS client (L14), with the visitor once there is one', () => {
  assert.equal(PLAYER_URL, 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false');
  const client = {
    clientName: 'VISIONOS',
    clientVersion: '1.02',
    deviceMake: 'Apple',
    deviceModel: 'RealityDevice17,1',
    osName: 'visionOS',
    osVersion: '26.5.23O471',
    hl: 'es',
    gl: 'AR',
  };
  assert.deepEqual(JSON.parse(playerRequestBody('aqz-KE-bpKQ', null)), {
    videoId: 'aqz-KE-bpKQ',
    contentCheckOk: true,
    racyCheckOk: true,
    context: { client },
  });
  assert.deepEqual(JSON.parse(playerRequestBody('aqz-KE-bpKQ', VISITOR)).context.client, { ...client, visitorData: VISITOR });
});

test('the player headers name the client (101) and the visitor; the streams get the same Safari user agent', () => {
  assert.equal(VISIONOS_CLIENT.clientId, '101');
  assert.match(VISIONOS_CLIENT.userAgent, SAFARI);
  const base = {
    'Content-Type': 'application/json',
    'User-Agent': VISIONOS_CLIENT.userAgent,
    'X-YouTube-Client-Name': '101',
    'X-YouTube-Client-Version': '1.02',
    Origin: 'https://www.youtube.com',
  };
  assert.deepEqual(playerHeaders(null), base);
  assert.deepEqual(playerHeaders(VISITOR), { ...base, 'X-Goog-Visitor-Id': VISITOR });
  assert.deepEqual(STREAM_HEADERS, { 'User-Agent': VISIONOS_CLIENT.userAgent });
});

test('every YouTube request leaves the WebView cookies out (L11)', () => {
  assert.deepEqual(withoutCookies(), { credentials: 'omit' });
  assert.deepEqual(withoutCookies({ method: 'POST', credentials: 'include' }), { method: 'POST', credentials: 'omit' });
});
