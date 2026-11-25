import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  PLAYER_URL,
  TV_CLIENT,
  VISITOR_URL,
  parseVisitorData,
  playerHeaders,
  playerRequestBody,
  visitorRequestBody,
} from './client.ts';

const VISITOR = 'CgtRTHJCX3VRLXdmayiBz53YBjIKCgJBUhIEGgAgXw==';

test('the player is asked as the TVHTML5_SIMPLY client, with the visitor and the signature timestamp (L7)', () => {
  assert.equal(PLAYER_URL, 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false');
  assert.equal(TV_CLIENT.clientName, 'TVHTML5_SIMPLY');
  assert.equal(TV_CLIENT.clientVersion, '1.0');
  assert.deepEqual(JSON.parse(playerRequestBody('aqz-KE-bpKQ', { visitorData: VISITOR, signatureTimestamp: 20779 })), {
    videoId: 'aqz-KE-bpKQ',
    contentCheckOk: true,
    racyCheckOk: true,
    context: {
      client: { clientName: 'TVHTML5_SIMPLY', clientVersion: '1.0', hl: 'es', gl: 'AR', visitorData: VISITOR },
    },
    playbackContext: { contentPlaybackContext: { html5Preference: 'HTML5_PREF_WANTS', signatureTimestamp: 20779 } },
  });
});

test('the player headers name the client and the visitor; googlevideo gets the same user agent', () => {
  assert.deepEqual(playerHeaders(VISITOR), {
    'Content-Type': 'application/json',
    'User-Agent': TV_CLIENT.userAgent,
    'X-YouTube-Client-Name': '75',
    'X-YouTube-Client-Version': '1.0',
    'X-Goog-Visitor-Id': VISITOR,
    Origin: 'https://www.youtube.com',
  });
});

test('the visitor id comes from the InnerTube visitor_id endpoint, URL-decoded', () => {
  assert.equal(VISITOR_URL, 'https://www.youtube.com/youtubei/v1/visitor_id?prettyPrint=false');
  const body = JSON.parse(visitorRequestBody());
  assert.equal(body.context.client.clientName, 'WEB');
  assert.match(body.context.client.clientVersion, /^2\.\d{8}\.\d{2}\.\d{2}$/);
  assert.equal(
    parseVisitorData({ responseContext: { visitorData: 'CgtRTHJCX3VRLXdmayiBz53YBjIKCgJBUhIEGgAgXw%3D%3D' } }),
    VISITOR,
  );
  for (const bad of [null, {}, { responseContext: {} }, { responseContext: { visitorData: '' } }, { responseContext: { visitorData: 7 } }, 'x']) {
    assert.equal(parseVisitorData(bad), null, JSON.stringify(bad));
  }
});
