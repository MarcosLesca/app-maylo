import assert from 'node:assert/strict';
import { test } from 'node:test';

import { receiverFailureText } from './remote-failure.ts';

const BASE = 'La tele no pudo reproducir este video. Probá con otro o usá “Duplicar la pantalla”.';

test('the failure text stays as before when the TV reports no detail (DLNA, older pages)', () => {
  assert.equal(receiverFailureText(), BASE);
  assert.equal(receiverFailureText(null), BASE);
});

test('the failure text ends with a short technical line: type/details, HTTP status and stream', () => {
  assert.equal(
    receiverFailureText({ type: 'networkError', details: 'fragLoadError', code: 403, stream: 'audio', fatal: true }),
    `${BASE} Detalle: networkError/fragLoadError 403 (audio)`,
  );
  assert.equal(
    receiverFailureText({ type: 'mediaError', details: 'bufferAppendError', code: null, stream: 'video', fatal: true }),
    `${BASE} Detalle: mediaError/bufferAppendError (video)`,
  );
  assert.equal(
    receiverFailureText({ type: 'mediaError', details: 'bufferAppendError', code: null, stream: '', fatal: false }),
    `${BASE} Detalle: mediaError/bufferAppendError`,
  );
});
