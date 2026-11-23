import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  allowRuleLines,
  applyNetworkExceptions,
  dropProtectedDomains,
  isDomainName,
  isProtectedDomain,
  parseNetworkRules,
} from './adblock-rules.ts';
import { isDomainName as isAppDomainName } from './adblock.ts';

const sorted = (set: Iterable<string>) => [...set].sort();

test('parseNetworkRules keeps plain ||domain^ rules with no options or only third-party/3p/popup/all', () => {
  const text = [
    '[Adblock Plus 2.0]',
    '! Title: EasyList',
    '||ads.example.com^',
    '||Tracker.IO^$third-party',
    '||pop.example.net^$popup',
    '||all.example.org^$all',
    '||three.example.org^$3p',
    '||combo.example.org^$third-party,popup',
    '  ||spaced.example.org^  ',
  ].join('\n');
  assert.deepEqual(sorted(parseNetworkRules(text).blocked), [
    'ads.example.com',
    'all.example.org',
    'combo.example.org',
    'pop.example.net',
    'spaced.example.org',
    'three.example.org',
    'tracker.io',
  ]);
});

test('parseNetworkRules skips rules with other options, paths, wildcards, IPs, cosmetic and comment lines', () => {
  const text = [
    '||script.example.com^$script',
    '||domain-only.example.com^$domain=site.com',
    '||first.example.com^$~third-party',
    '||mixed.example.com^$third-party,image',
    '||path.example.com/ads/',
    '||path2.example.com^*/banner',
    '||wild*.example.com^',
    '||10.0.0.1^',
    '||single^',
    '|https://abs.example.com^',
    '/banner/ads.',
    '##.ad-banner',
    'example.com##.ad',
    '! ||commented.example.com^',
    '||trailing.example.com^|',
    '',
  ].join('\n');
  const rules = parseNetworkRules(text);
  assert.deepEqual(sorted(rules.blocked), []);
  assert.deepEqual(sorted(rules.exceptions), []);
});

test('parseNetworkRules collects @@||domain^ exceptions: unrestricted ones globally, $domain= ones per site', () => {
  const text = [
    '@@||cdn.example.com^',
    '@@||Player.Example.org^$script',
    '@@||googlesyndication.com^$script,domain=Site.com|other.net|~not.site.com|google.*',
    '@@||only-negated.com^$domain=~x.com',
    '@@||path.example.com/x.js',
    '@@||wild*.x.com^',
  ].join('\n');
  const rules = parseNetworkRules(text);
  assert.deepEqual(sorted(rules.exceptions), ['cdn.example.com', 'only-negated.com', 'player.example.org']);
  assert.deepEqual([...rules.siteExceptions].map(([host, sites]) => [host, sorted(sites)]), [
    ['googlesyndication.com', ['other.net', 'site.com']],
  ]);
  assert.deepEqual(sorted(rules.blocked), []);
});

test('exceptions that only change cosmetic or other non-request behavior are not network exceptions', () => {
  const text = [
    '@@||site.com^$generichide',
    '@@||site2.com^$elemhide',
    '@@||site3.com^$stealth',
    '@@||site4.com^$csp',
    '@@||site5.com^$badfilter',
    '@@||site6.com^$document',
  ].join('\n');
  const rules = parseNetworkRules(text);
  assert.deepEqual(sorted(rules.exceptions), ['site6.com']);
  assert.equal(rules.siteExceptions.size, 0);
});

test('parseNetworkRules merges several lists into the same rules', () => {
  const rules = parseNetworkRules('||a.com^\n@@||b.com^');
  parseNetworkRules('||c.com^\n@@||d.com^$domain=e.com', rules);
  assert.deepEqual(sorted(rules.blocked), ['a.com', 'c.com']);
  assert.deepEqual(sorted(rules.exceptions), ['b.com']);
  assert.deepEqual(sorted(rules.siteExceptions.keys()), ['d.com']);
});

test('applyNetworkExceptions drops a domain excepted itself or through a parent, and sorts', () => {
  const blocked = ['ads.example.com', 'tracker.io', 'cdn.site.org', 'site.org', 'keep.example.net', 'doubleclick.net'];
  const exceptions = new Set(['tracker.io', 'site.org', 'survey.g.doubleclick.net']);
  assert.deepEqual(applyNetworkExceptions(blocked, exceptions), ['ads.example.com', 'doubleclick.net', 'keep.example.net']);
});

test('applyNetworkExceptions keeps everything when there are no exceptions', () => {
  assert.deepEqual(applyNetworkExceptions(['b.com', 'a.com'], new Set()), ['a.com', 'b.com']);
});

test('allowRuleLines keeps the exceptions the domain list still needs: subdomains of blocked ones and per-site ones', () => {
  const rules = parseNetworkRules(
    [
      '@@||survey.g.doubleclick.net^',
      '@@||unrelated.org^',
      '@@||googlesyndication.com^$domain=site.com|other.net',
      '@@||pagead2.ads.net^$domain=x.com',
      '@@||nothing.blocked.org^$domain=y.com',
    ].join('\n'),
  );
  assert.deepEqual(allowRuleLines(['ads.net', 'doubleclick.net', 'pagead2.googlesyndication.com'], rules), [
    '@@googlesyndication.com other.net,site.com',
    '@@pagead2.ads.net x.com',
    '@@survey.g.doubleclick.net',
  ]);
});

test('generic CDNs and platforms, and their parents, are protected; specific ad hosts under them are not', () => {
  assert.equal(isProtectedDomain('cloudfront.net'), true);
  assert.equal(isProtectedDomain('akamaized.net'), true);
  assert.equal(isProtectedDomain('googleapis.com'), true);
  assert.equal(isProtectedDomain('com'), true);
  assert.equal(isProtectedDomain('d1234.cloudfront.net'), false);
  assert.equal(isProtectedDomain('doubleclick.net'), false);
  assert.deepEqual(dropProtectedDomains(['cloudfront.net', 'd1234.cloudfront.net', 'doubleclick.net', 'jsdelivr.net', 'youtube.com']), [
    'd1234.cloudfront.net',
    'doubleclick.net',
  ]);
});

test('isDomainName agrees with adblock.ts (the copy keeps this module self-contained)', () => {
  for (const name of ['a.com', 'ads.example.co.uk', 'xn--p1ai.xn--p1ai', 'com', '10.0.0.1', 'a_b.com', '-a.com', 'a..com', 'wild*.com', '']) {
    assert.equal(isDomainName(name), isAppDomainName(name), name);
  }
});
