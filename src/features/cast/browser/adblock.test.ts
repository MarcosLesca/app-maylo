import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  blockerLabel,
  compactBlocklist,
  isBlockedHost,
  normalizeHost,
  parseBlocklist,
  shouldBlockRequest,
} from './adblock.ts';

const LIST = new Set(['doubleclick.net', 'ads.example.com', 'tracker.io']);

test('normalizeHost lowercases and drops a trailing dot and IPv6 brackets', () => {
  assert.equal(normalizeHost('Ads.Example.COM.'), 'ads.example.com');
  assert.equal(normalizeHost('  tracker.io '), 'tracker.io');
  assert.equal(normalizeHost('[::1]'), '::1');
});

test('a listed host and every subdomain of it are blocked', () => {
  assert.equal(isBlockedHost('doubleclick.net', LIST), true);
  assert.equal(isBlockedHost('stats.g.doubleclick.net', LIST), true);
  assert.equal(isBlockedHost('ADS.example.com.', LIST), true);
  assert.equal(isBlockedHost('cdn.ads.example.com', LIST), true);
});

test('parents, siblings and look-alike hosts of a listed host are not blocked', () => {
  assert.equal(isBlockedHost('example.com', LIST), false);
  assert.equal(isBlockedHost('www.example.com', LIST), false);
  assert.equal(isBlockedHost('notdoubleclick.net', LIST), false);
  assert.equal(isBlockedHost('doubleclick.net.evil.org', LIST), false);
  assert.equal(isBlockedHost('', LIST), false);
});

test('a bare top-level domain is never looked up, even if listed', () => {
  assert.equal(isBlockedHost('site.com', new Set(['com'])), false);
});

test('parseBlocklist reads hosts-file and plain lines, skipping comments, local names, IPs and junk', () => {
  const text = [
    '# Title: StevenBlack/hosts',
    '127.0.0.1 localhost',
    '0.0.0.0 0.0.0.0',
    '255.255.255.255 broadcasthost',
    '::1 ip6-localhost',
    '0.0.0.0 Ads.Example.com # inline comment',
    '0.0.0.0\ttracker.io',
    'doubleclick.net',
    '0.0.0.0 bad_host!.com',
    '0.0.0.0 10.0.0.1',
    '',
    '   ',
  ].join('\n');
  assert.deepEqual([...parseBlocklist(text)].sort(), ['ads.example.com', 'doubleclick.net', 'tracker.io']);
});

test('compactBlocklist drops subdomains already covered by a listed parent and sorts', () => {
  assert.deepEqual(compactBlocklist(['b.tracker.io', 'tracker.io', 'z.com', 'a.b.z.com', 'ads.x.org']), [
    'ads.x.org',
    'tracker.io',
    'z.com',
  ]);
});

test('the top-level page request is never blocked', () => {
  assert.equal(
    shouldBlockRequest({ url: 'https://ads.example.com/', isMainFrame: true, topHost: '' }, LIST, true),
    false,
  );
});

test('a listed subresource from any frame is blocked while blocking is on', () => {
  const request = { url: 'https://stats.g.doubleclick.net/pixel?x=1', isMainFrame: false, topHost: 'movies.example.org' };
  assert.equal(shouldBlockRequest(request, LIST, true), true);
  assert.equal(shouldBlockRequest(request, LIST, false), false);
});

test('unlisted hosts, non-http schemes and the page’s own host are not blocked', () => {
  assert.equal(shouldBlockRequest({ url: 'https://cdn.site.org/a.js', isMainFrame: false, topHost: 'site.org' }, LIST, true), false);
  assert.equal(shouldBlockRequest({ url: 'data:text/plain,tracker.io', isMainFrame: false, topHost: '' }, LIST, true), false);
  assert.equal(
    shouldBlockRequest({ url: 'https://tracker.io/app.js', isMainFrame: false, topHost: 'TRACKER.io' }, LIST, true),
    false,
  );
  assert.equal(shouldBlockRequest({ url: 'http://user@tracker.io:8080/x', isMainFrame: false, topHost: 'a.com' }, LIST, true), true);
});

test('blockerLabel tells the count and what a tap does', () => {
  assert.equal(blockerLabel(3, true), 'Anuncios bloqueados: 3; tocá para desactivar');
  assert.equal(blockerLabel(0, false), 'Bloqueo de anuncios desactivado; tocá para activar');
});
