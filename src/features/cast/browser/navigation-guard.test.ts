import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  TAP_WINDOW_MS,
  blockedBannerText,
  decideNavigation,
  hostOf,
  parseTapMessage,
  sameSite,
  siteOf,
} from './navigation-guard.ts';

test('hostOf reads the host of http(s) and other hierarchical URLs', () => {
  assert.equal(hostOf('https://User@Www.Example.com:8443/a?b#c'), 'www.example.com');
  assert.equal(hostOf('http://[::1]:8080/'), '::1');
  assert.equal(hostOf('intent://scan/#Intent;scheme=zxing;end'), 'scan');
  assert.equal(hostOf('about:blank'), '');
  assert.equal(hostOf('not a url'), '');
});

test('siteOf keeps the registrable domain, including common two-level country suffixes', () => {
  assert.equal(siteOf('a.b.example.com'), 'example.com');
  assert.equal(siteOf('www.clarin.com.ar'), 'clarin.com.ar');
  assert.equal(siteOf('news.bbc.co.uk'), 'bbc.co.uk');
  assert.equal(siteOf('example.com'), 'example.com');
  assert.equal(siteOf('localhost'), 'localhost');
  assert.equal(siteOf('192.168.0.10'), '192.168.0.10');
});

test('sameSite compares registrable domains of two URLs', () => {
  assert.equal(sameSite('https://www.example.com/a', 'https://m.example.com/b'), true);
  assert.equal(sameSite('https://example.com/a', 'https://ads.other.net/'), false);
  assert.equal(sameSite('https://a.com.ar/', 'https://b.com.ar/'), false);
});

const base = { currentUrl: 'https://movies.example.com/watch/1', lastTapAt: 0, now: 10_000 };

test('a cross-site top navigation without a recent tap is blocked with its host', () => {
  assert.deepEqual(decideNavigation({ ...base, url: 'https://Ads.Other.net/landing' }), {
    action: 'block',
    host: 'ads.other.net',
  });
  assert.deepEqual(decideNavigation({ ...base, url: 'https://ads.other.net/', lastTapAt: 10_000 - TAP_WINDOW_MS - 1 }), {
    action: 'block',
    host: 'ads.other.net',
  });
});

test('a cross-site navigation within ~1 s of a tap is allowed', () => {
  assert.equal(TAP_WINDOW_MS, 1000);
  assert.deepEqual(decideNavigation({ ...base, url: 'https://other.net/', lastTapAt: 10_000 - TAP_WINDOW_MS }), {
    action: 'allow',
  });
});

test('same-site navigations, the first page and non-network schemes are allowed', () => {
  assert.deepEqual(decideNavigation({ ...base, url: 'https://cdn.example.com/watch/2' }), { action: 'allow' });
  assert.deepEqual(decideNavigation({ ...base, currentUrl: '', url: 'https://anything.net/' }), { action: 'allow' });
  assert.deepEqual(decideNavigation({ ...base, url: 'about:blank' }), { action: 'allow' });
  assert.deepEqual(decideNavigation({ ...base, url: 'blob:https://movies.example.com/1' }), { action: 'allow' });
});

test('subframe navigations are never treated as redirects', () => {
  assert.deepEqual(decideNavigation({ ...base, url: 'https://player.net/', isTopFrame: false }), { action: 'allow' });
});

test('a URL the app itself opens (allowUrl) passes once', () => {
  assert.deepEqual(decideNavigation({ ...base, url: 'https://player.net/e/1', allowUrl: 'https://player.net/e/1' }), {
    action: 'allow',
  });
});

test('app links (intent:, market:) open outside only after a tap; otherwise they are blocked', () => {
  assert.deepEqual(decideNavigation({ ...base, url: 'market://details?id=x', lastTapAt: 9_900 }), { action: 'external' });
  assert.deepEqual(decideNavigation({ ...base, url: 'intent://ad/#Intent;end' }), { action: 'block', host: 'ad' });
  assert.deepEqual(decideNavigation({ ...base, url: 'market:details' }), { action: 'block', host: 'market' });
});

test('parseTapMessage accepts only tap messages', () => {
  assert.deepEqual(parseTapMessage('{"type":"maylo-tap","at":123}'), { at: 123 });
  assert.equal(parseTapMessage('{"type":"maylo-video","url":"x"}'), null);
  assert.equal(parseTapMessage('nope'), null);
});

test('blockedBannerText names the host', () => {
  assert.equal(blockedBannerText('redirect', 'ads.net'), 'Se bloqueó una redirección a ads.net');
  assert.equal(blockedBannerText('popup', 'ads.net'), 'Se bloqueó una ventana emergente a ads.net');
});
