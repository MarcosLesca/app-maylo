import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isOverlayOnly, shouldShowHeadlessNotification } from './presentation.ts';

test('reactions never show a banner while the app is open (the overlay shows them)', () => {
  assert.equal(isOverlayOnly({ kind: 'reaction', url: '/' }), true);
});

test('every other push keeps showing in the foreground', () => {
  assert.equal(isOverlayOnly({ url: '/tasks' }), false);
  assert.equal(isOverlayOnly({ kind: 'message', url: '/messages' }), false);
  assert.equal(isOverlayOnly(undefined), false);
  assert.equal(isOverlayOnly(null), false);
});

test('the background task notifies a reaction only when the app is not in the foreground', () => {
  assert.equal(shouldShowHeadlessNotification('reaction', 'active'), false);
  assert.equal(shouldShowHeadlessNotification('reaction', 'background'), true);
  assert.equal(shouldShowHeadlessNotification('reaction', 'inactive'), true);
  assert.equal(shouldShowHeadlessNotification('reaction', null), true);
});

test('chat messages are still always notified by the background task', () => {
  assert.equal(shouldShowHeadlessNotification('message', 'active'), true);
  assert.equal(shouldShowHeadlessNotification('message', 'background'), true);
});
