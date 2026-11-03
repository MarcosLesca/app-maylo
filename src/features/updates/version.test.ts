import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isNewerVersion, parseVersion } from './version.ts';

test('parses tags with or without a leading v', () => {
  assert.deepEqual(parseVersion('v1.2.3'), [1, 2, 3]);
  assert.deepEqual(parseVersion('1.4'), [1, 4, 0]);
  assert.equal(parseVersion('latest'), null);
});

test('detects newer versions by numeric comparison', () => {
  assert.equal(isNewerVersion('v1.10.0', '1.9.0'), true);
  assert.equal(isNewerVersion('v2.0.0', '1.99.99'), true);
  assert.equal(isNewerVersion('v1.0.1', '1.0.0'), true);
});

test('same, older or invalid versions are never newer', () => {
  assert.equal(isNewerVersion('v1.0.0', '1.0.0'), false);
  assert.equal(isNewerVersion('v0.9.0', '1.0.0'), false);
  assert.equal(isNewerVersion('nightly', '1.0.0'), false);
});
