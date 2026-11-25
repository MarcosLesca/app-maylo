import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classifyReport, endedNow } from './session-rules.ts';

test('a cast ends once, on the poll where ended turns true', () => {
  assert.equal(endedNow(false, true), true);
  assert.equal(endedNow(true, true), false);
  assert.equal(endedNow(false, false), false);
  assert.equal(endedNow(true, false), false);
});

test('a receiver report is this video, a stale one from before the load, or another phone took over', () => {
  // The TV shows our title (trimmed): ours.
  assert.equal(classifyReport({ title: 'Capítulo 3', reportedTitle: ' Capítulo 3 ', confirmed: false }), 'own');
  assert.equal(classifyReport({ title: 'Capítulo 3', reportedTitle: 'Capítulo 3', confirmed: true }), 'own');
  // Another title before the TV ever showed ours: still the previous video (load pending).
  assert.equal(classifyReport({ title: 'Capítulo 3', reportedTitle: 'Capítulo 2', confirmed: false }), 'stale');
  // Another title after ours was shown: someone else cast over this session.
  assert.equal(classifyReport({ title: 'Capítulo 3', reportedTitle: 'Capítulo 4', confirmed: true }), 'superseded');
  // No title reported (DLNA, older TV page, idle): treated as ours.
  assert.equal(classifyReport({ title: 'Capítulo 3', reportedTitle: undefined, confirmed: false }), 'own');
  assert.equal(classifyReport({ title: 'Capítulo 3', reportedTitle: '', confirmed: true }), 'own');
});
