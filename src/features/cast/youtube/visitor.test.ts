import assert from 'node:assert/strict';
import { test } from 'node:test';

import { nextPlayerCall, parseVisitorData } from './visitor.ts';

const VISITOR = 'CgtRTHJCX3VRLXdmayiBz53YBjIKCgJBUhIEGgAgXw==';

test('the visitor id of a player answer is its responseContext.visitorData, URL-decoded', () => {
  assert.equal(
    parseVisitorData({ responseContext: { visitorData: 'CgtRTHJCX3VRLXdmayiBz53YBjIKCgJBUhIEGgAgXw%3D%3D' } }),
    VISITOR,
  );
  for (const bad of [null, {}, { responseContext: {} }, { responseContext: { visitorData: '' } }, { responseContext: { visitorData: 7 } }, 'x']) {
    assert.equal(parseVisitorData(bad), null, JSON.stringify(bad));
  }
});

const OK = { playabilityStatus: { status: 'OK' }, responseContext: { visitorData: 'ECHO%3D' } };
const botCheck = (visitorData?: string) => ({
  playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Inicia sesión para confirmar que no eres un bot' },
  ...(visitorData ? { responseContext: { visitorData } } : {}),
});

test('first call without a visitor: LOGIN_REQUIRED hands one over, retried once (L14)', () => {
  assert.deepEqual(nextPlayerCall(botCheck('NEW%3D%3D'), { visitorData: null, from: 'none' }), {
    next: 'retry',
    visitorData: 'NEW==',
  });
  // The retry with that visitor works: it is kept for the next videos.
  assert.deepEqual(nextPlayerCall(OK, { visitorData: 'NEW==', from: 'handshake' }), { next: 'done', remember: 'NEW==' });
});

test('a cached visitor YouTube rejects is dropped for the fresh one of the answer', () => {
  assert.deepEqual(nextPlayerCall(botCheck('FRESH'), { visitorData: 'OLD', from: 'cache' }), { next: 'retry', visitorData: 'FRESH' });
  assert.deepEqual(nextPlayerCall(OK, { visitorData: 'OLD', from: 'cache' }), { next: 'done', remember: 'OLD' });
});

test('no endless handshake: LOGIN_REQUIRED after the handshake, or without a visitor to retry with, is final', () => {
  // An age-restricted or private video asks to sign in with any visitor.
  assert.deepEqual(nextPlayerCall(botCheck('OTHER'), { visitorData: 'NEW', from: 'handshake' }), { next: 'done', remember: null });
  assert.deepEqual(nextPlayerCall(botCheck(), { visitorData: null, from: 'none' }), { next: 'done', remember: null });
  assert.deepEqual(nextPlayerCall(botCheck(), { visitorData: 'OLD', from: 'cache' }), { next: 'done', remember: null });
});

test('other answers end the handshake; only a playable answer remembers the visitor', () => {
  for (const status of ['UNPLAYABLE', 'ERROR', 'LIVE_STREAM_OFFLINE']) {
    const answer = { playabilityStatus: { status }, responseContext: { visitorData: 'X' } };
    assert.deepEqual(nextPlayerCall(answer, { visitorData: 'V', from: 'handshake' }), { next: 'done', remember: null }, status);
  }
  for (const junk of [null, 'x', {}, { playabilityStatus: 'OK' }]) {
    assert.deepEqual(nextPlayerCall(junk, { visitorData: null, from: 'none' }), { next: 'done', remember: null });
  }
  // Playable without any visitor: nothing to remember.
  assert.deepEqual(nextPlayerCall(OK, { visitorData: null, from: 'none' }), { next: 'done', remember: null });
});
