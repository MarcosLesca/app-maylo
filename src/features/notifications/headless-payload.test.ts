import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseHeadlessPayload } from './headless-payload.ts';

const message = { kind: 'message', title: 'Loana', body: 'hola!', url: '/messages' };

test('headless pushes carry the data as a JSON string', () => {
  assert.deepEqual(parseHeadlessPayload({ notification: null, data: { dataString: JSON.stringify(message) } }), message);
});

test('data delivered as plain fields is also understood', () => {
  assert.deepEqual(parseHeadlessPayload({ notification: null, data: { ...message } }), message);
});

test('broken JSON or missing fields are ignored instead of crashing the task', () => {
  assert.equal(parseHeadlessPayload({ notification: null, data: { dataString: '{oops' } }), null);
  assert.equal(parseHeadlessPayload({ notification: null, data: { dataString: '{"kind":"message"}' } }), null);
  assert.equal(parseHeadlessPayload(undefined), null);
});

test('notification taps (responses) and other kinds are not treated as new messages', () => {
  assert.equal(parseHeadlessPayload({ actionIdentifier: 'expo.modules.notifications.actions.DEFAULT', notification: {} }), null);
  assert.equal(
    parseHeadlessPayload({ notification: null, data: { dataString: JSON.stringify({ ...message, kind: 'other' }) } }),
    null,
  );
});
