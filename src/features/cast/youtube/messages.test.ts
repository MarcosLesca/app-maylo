import assert from 'node:assert/strict';
import { test } from 'node:test';

import { YOUTUBE_MESSAGES, failureText, playabilityMessage } from './messages.ts';

const answer = (status: string, videoDetails: Record<string, unknown> = {}) => ({ playabilityStatus: { status }, videoDetails });

test('a playable answer has no message', () => {
  assert.equal(playabilityMessage(answer('OK', { lengthSeconds: '213', isLiveContent: false })), null);
});

test('each playabilityStatus becomes a Spanish message', () => {
  assert.equal(playabilityMessage(answer('LOGIN_REQUIRED')), YOUTUBE_MESSAGES.login);
  assert.equal(playabilityMessage(answer('AGE_CHECK_REQUIRED')), YOUTUBE_MESSAGES.login);
  assert.equal(playabilityMessage(answer('AGE_VERIFICATION_REQUIRED')), YOUTUBE_MESSAGES.login);
  assert.equal(playabilityMessage(answer('ERROR')), YOUTUBE_MESSAGES.unavailable);
  assert.equal(playabilityMessage(answer('LIVE_STREAM_OFFLINE')), YOUTUBE_MESSAGES.live);
  assert.equal(playabilityMessage(answer('UNPLAYABLE')), YOUTUBE_MESSAGES.unplayable);
  assert.equal(playabilityMessage(answer('CONTENT_CHECK_REQUIRED')), YOUTUBE_MESSAGES.unplayable);
  for (const junk of [null, 'x', {}, { playabilityStatus: {} }]) assert.equal(playabilityMessage(junk), YOUTUBE_MESSAGES.failed);
});

test('live streams are told apart: VISIONOS answers them UNPLAYABLE with isLiveContent (jfKfPfyJRdk)', () => {
  assert.equal(playabilityMessage(answer('UNPLAYABLE', { isLiveContent: true, isPostLiveDvr: true })), YOUTUBE_MESSAGES.live);
  assert.equal(playabilityMessage(answer('OK', { isLive: true })), YOUTUBE_MESSAGES.live);
  // A finished live stream with a length is an ordinary video.
  assert.equal(playabilityMessage(answer('OK', { isLiveContent: true, lengthSeconds: '3600' })), null);
});

test('made-for-kids videos look like any other UNPLAYABLE answer (XqZsoesa55w), so the message names them', () => {
  assert.equal(playabilityMessage(answer('UNPLAYABLE', { isLiveContent: false, lengthSeconds: '136' })), YOUTUBE_MESSAGES.unplayable);
  assert.match(YOUTUBE_MESSAGES.unplayable, /para chicos/);
});

test('every message is plain Spanish that names YouTube, so the cast sheet shows it as is', () => {
  for (const message of Object.values(YOUTUBE_MESSAGES)) assert.match(message, /YouTube/);
  assert.equal(YOUTUBE_MESSAGES.dlna, 'YouTube solo se puede ver con el navegador de la tele.');
});

test('a failure keeps a short technical detail (step and HTTP status) for the device diagnosis', () => {
  assert.equal(
    failureText(YOUTUBE_MESSAGES.failed, 'master HTTP 403'),
    'No se pudo leer el video de YouTube. Probá de nuevo en un rato. (Detalle: master HTTP 403)',
  );
  assert.equal(failureText(YOUTUBE_MESSAGES.login, '  '), YOUTUBE_MESSAGES.login);
  assert.equal(failureText(YOUTUBE_MESSAGES.failed, 'x'.repeat(300)).length, YOUTUBE_MESSAGES.failed.length + ' (Detalle: )'.length + 120);
});
