import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AllowedTargets, cookieAllowed, MAX_ALLOWED_TARGETS } from './proxy-policy.ts';

test('the cookie goes only to the host of the page it came from (the Referer)', () => {
  assert.equal(cookieAllowed('https://player.x.com/v/master.m3u8', 'https://player.x.com/embed/1'), true);
  assert.equal(cookieAllowed('https://PLAYER.x.com:8443/seg.ts', 'https://player.x.com/embed/1'), true);
  assert.equal(cookieAllowed('http://site.com/a.mp4', 'http://site.com/page'), true);
  assert.equal(cookieAllowed('https://cdn.other.net/seg.ts', 'https://player.x.com/embed/1'), false);
  assert.equal(cookieAllowed('https://x.com/a.mp4', 'https://sub.x.com/page'), false);
  assert.equal(cookieAllowed('https://evil.com/?h=player.x.com', 'https://player.x.com/'), false);
});

test('the cookie is never sent on an https→http downgrade, without a Referer, or to non-http targets', () => {
  assert.equal(cookieAllowed('http://player.x.com/a.mp4', 'https://player.x.com/embed/1'), false);
  assert.equal(cookieAllowed('https://player.x.com/a.mp4', ''), false);
  assert.equal(cookieAllowed('https://player.x.com/a.mp4', 'not a url'), false);
  assert.equal(cookieAllowed('ftp://player.x.com/a.mp4', 'https://player.x.com/'), false);
  assert.equal(cookieAllowed('https://player.x.com/a.mp4', 'file:///player.x.com/'), false);
});

test('a session serves its initial target and the URLs its playlists emitted, nothing else', () => {
  const allowed = new AllowedTargets('https://h.com/master.m3u8');
  assert.equal(allowed.has('https://h.com/master.m3u8'), true);
  assert.equal(allowed.has('https://h.com/low/index.m3u8'), false);
  allowed.add('https://h.com/low/index.m3u8');
  assert.equal(allowed.has('https://h.com/low/index.m3u8'), true);
  assert.equal(allowed.has('https://h.com/master.m3u8?x=1'), false);
  assert.equal(allowed.has('http://192.168.1.1/admin'), false);
  assert.equal(allowed.size, 2);
});

test('past the limit the least recently used target is forgotten first; used targets stay', () => {
  const allowed = new AllowedTargets('https://h.com/live.m3u8', 3);
  allowed.add('https://h.com/1.ts');
  allowed.add('https://h.com/2.ts');
  assert.equal(allowed.has('https://h.com/live.m3u8'), true); // polled live playlist stays fresh
  allowed.add('https://h.com/3.ts');
  assert.equal(allowed.size, 3);
  assert.equal(allowed.has('https://h.com/1.ts'), false);
  assert.equal(allowed.has('https://h.com/live.m3u8'), true);
  allowed.add('https://h.com/2.ts'); // re-adding refreshes instead of duplicating
  allowed.add('https://h.com/4.ts');
  assert.equal(allowed.size, 3);
  assert.equal(allowed.has('https://h.com/3.ts'), false);
  assert.equal(allowed.has('https://h.com/2.ts'), true);
  assert.equal(allowed.has('https://h.com/4.ts'), true);
});

test('the default limit is 20,000 targets', () => {
  assert.equal(MAX_ALLOWED_TARGETS, 20_000);
  const allowed = new AllowedTargets('https://h.com/first.m3u8');
  for (let i = 0; i < MAX_ALLOWED_TARGETS; i++) allowed.add(`https://h.com/${i}.ts`);
  assert.equal(allowed.size, MAX_ALLOWED_TARGETS);
  assert.equal(allowed.has('https://h.com/first.m3u8'), false);
  assert.equal(allowed.has(`https://h.com/${MAX_ALLOWED_TARGETS - 1}.ts`), true);
});
