import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ATT_URL,
  TOKEN_MARGIN_MS,
  attRequestBody,
  generateItRequest,
  parseChallenge,
  parseIntegrityToken,
  tokenExpiresAt,
  usableSession,
} from './po-token.ts';

test('the BotGuard challenge is asked from InnerTube att/get as ENGAGEMENT_TYPE_UNBOUND (L7)', () => {
  assert.equal(ATT_URL, 'https://www.youtube.com/youtubei/v1/att/get?prettyPrint=false');
  const body = JSON.parse(attRequestBody());
  assert.equal(body.engagementType, 'ENGAGEMENT_TYPE_UNBOUND');
  assert.equal(body.context.client.clientName, 'WEB');
});

test('parseChallenge returns the interpreter URL (https), program and global name', () => {
  assert.deepEqual(
    parseChallenge({
      challenge: 'x',
      bgChallenge: {
        interpreterUrl: { privateDoNotAccessOrElseTrustedResourceUrlWrappedValue: '//www.google.com/js/th/abc.js' },
        interpreterHash: 'abc',
        program: 'PROGRAM',
        globalName: 'trayride',
      },
    }),
    { interpreterUrl: 'https://www.google.com/js/th/abc.js', program: 'PROGRAM', globalName: 'trayride' },
  );
  for (const bad of [
    null,
    {},
    { bgChallenge: { program: 'p', globalName: 'g' } },
    { bgChallenge: { interpreterUrl: { privateDoNotAccessOrElseTrustedResourceUrlWrappedValue: '//evil.com/x.js' }, program: 'p', globalName: 'g' } },
    { bgChallenge: { interpreterUrl: { privateDoNotAccessOrElseTrustedResourceUrlWrappedValue: '//www.google.com/x.js' }, program: '', globalName: 'g' } },
    { bgChallenge: { interpreterUrl: { privateDoNotAccessOrElseTrustedResourceUrlWrappedValue: '//www.google.com/x.js' }, program: 'p', globalName: 'a b' } },
  ]) {
    assert.equal(parseChallenge(bad), null, JSON.stringify(bad));
  }
});

test('GenerateIT goes to jnn-pa.googleapis.com with the YouTube request key (BgUtils)', () => {
  const request = generateItRequest('BG-RESPONSE');
  assert.equal(request.url, 'https://jnn-pa.googleapis.com/$rpc/google.internal.waa.v1.Waa/GenerateIT');
  assert.deepEqual(request.headers, {
    'Content-Type': 'application/json+protobuf',
    'X-Goog-Api-Key': 'AIzaSyDyT5W0Jh49F30Pqqtyfdf7pDLFKLJoAnw',
    'X-User-Agent': 'grpc-web-javascript/0.1',
  });
  assert.deepEqual(JSON.parse(request.body), ['O43z0dpjhgX20SCx4KAo', 'BG-RESPONSE']);
});

test('parseIntegrityToken reads the token and its lifetime; a fallback-only answer is a failure', () => {
  assert.deepEqual(parseIntegrityToken(['TOKEN', 43200, 33000, 'fallback']), { token: 'TOKEN', ttlSeconds: 43200 });
  assert.deepEqual(parseIntegrityToken(['TOKEN']), { token: 'TOKEN', ttlSeconds: 43200 });
  assert.equal(parseIntegrityToken([null, 43200, null, 'fallback']), null);
  assert.equal(parseIntegrityToken(['', 43200]), null);
  assert.equal(parseIntegrityToken({}), null);
});

test('the token lives its lifetime, at most 12 h, minus a safety margin', () => {
  const now = 1_000_000;
  assert.equal(TOKEN_MARGIN_MS, 30 * 60 * 1000);
  assert.equal(tokenExpiresAt(now, 43200), now + 12 * 3600 * 1000 - TOKEN_MARGIN_MS);
  assert.equal(tokenExpiresAt(now, 99999), now + 12 * 3600 * 1000 - TOKEN_MARGIN_MS);
  assert.equal(tokenExpiresAt(now, 7200), now + 2 * 3600 * 1000 - TOKEN_MARGIN_MS);
  assert.equal(tokenExpiresAt(now, 60), now);
});

test('a cached session is reused only before it expires', () => {
  const session = { visitorData: 'v', poToken: 'p', expiresAt: 5000 };
  assert.equal(usableSession(session, 4999), session);
  assert.equal(usableSession(session, 5000), null);
  assert.equal(usableSession(null, 0), null);
});
