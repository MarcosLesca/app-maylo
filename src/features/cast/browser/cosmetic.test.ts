import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildCosmeticIndex,
  COSMETIC_CHUNK_SIZE,
  cosmeticCss,
  cosmeticCssForHost,
  cosmeticSelectors,
  createCosmeticRules,
  isSafeSelector,
  parseCosmeticRules,
} from './cosmetic.ts';

const LIST = [
  '[Adblock Plus 2.0]',
  '! Title: test',
  '##.ad-banner',
  '###top-ad',
  '##div[id^="ad-"]',
  '##.shared',
  '#@#.shared',
  'example.com##.example-ad',
  'Example.com,other.org##.both-ad',
  'example.com#@#.ad-banner',
  'sub.example.com#@#.example-ad',
  '~safe.net##.not-on-safe',
  'news.org,~live.news.org##.news-ad',
  'google.*##.entity-ad',
  'example.com#?#.x:-abp-has(.y)',
  'example.com#$#.x { display: none; }',
  'example.com#%#window.x = 1',
  'example.com##+js(set-constant, x, 1)',
  'example.com##^script:has-text(ads)',
  'example.com##.x:has-text(Sponsored)',
  '##.y:matches-css(display: block)',
  '##.z:xpath(//div)',
  '##.w:-abp-contains(ad)',
  '##.unbalanced[',
  '||ads.example.com^',
  '||site.com/#ad##',
  '',
].join('\n');

function index() {
  return buildCosmeticIndex(parseCosmeticRules(LIST));
}

test('isSafeSelector accepts ordinary CSS selectors', () => {
  for (const selector of [
    '.ad',
    '#top-ad',
    'div[id^="ad-"]',
    'a[href*="://ads.example.com/"]',
    '.md\\:hidden',
    'div > .ad + span ~ p',
    'ul li:nth-child(2n+1)',
    '.a:not(.b)',
    '.wrapper:has(> .ad)',
    'div[style="width: 300px; height: 250px;"]',
    '[data-ad] , .b',
    'amp-ad',
    '.x::before',
  ]) {
    assert.equal(isSafeSelector(selector), true, selector);
  }
});

test('isSafeSelector rejects extended, procedural and malformed selectors', () => {
  for (const selector of [
    '',
    '.x:has-text(ad)',
    '.x:-abp-has(.y)',
    '.x:matches-css(a: b)',
    '.x:xpath(//div)',
    '.x:contains(ad)',
    '.x:upward(2)',
    '.x:remove()',
    '.x:style(color: red)',
    '.x { color: red }',
    '.x;',
    '.x!important',
    '.unbalanced[',
    'div(',
    '.a)',
    '[a="b]',
    '> .x',
    '.x >',
    '.a,,.b',
    '.a,',
    '+js(x)',
    '.x /* c */',
    'a'.repeat(1025),
  ]) {
    assert.equal(isSafeSelector(selector), false, selector);
  }
});

test('generic selectors exclude generic exceptions, extended rules and invalid selectors', () => {
  assert.deepEqual(index().generic, ['#top-ad', '.ad-banner', '.not-on-safe', 'div[id^="ad-"]']);
});

test('site rules are stored per lowercased host; entity (google.*) and extended site rules are skipped', () => {
  const { hosts } = index();
  assert.deepEqual(hosts, {
    'example.com': ['.both-ad', '.example-ad'],
    'news.org': ['.news-ad'],
    'other.org': ['.both-ad'],
  });
});

test('#@# site exceptions and negated domains are recorded per host', () => {
  const { exceptions } = index();
  assert.deepEqual(exceptions, {
    'example.com': ['.ad-banner'],
    'live.news.org': ['.news-ad'],
    'safe.net': ['.not-on-safe'],
    'sub.example.com': ['.example-ad'],
  });
});

test('parseCosmeticRules merges several lists into the same rules', () => {
  const rules = createCosmeticRules();
  parseCosmeticRules('##.one\na.com##.a', rules);
  parseCosmeticRules('##.two\n#@#.one\na.com##.b', rules);
  assert.deepEqual(buildCosmeticIndex(rules), {
    generic: ['.two'],
    hosts: { 'a.com': ['.a', '.b'] },
    exceptions: {},
    genericHide: [],
    elemHide: [],
  });
});

test('a site selector that is also generic is kept only once, as generic', () => {
  const built = buildCosmeticIndex(parseCosmeticRules('##.ad\na.com##.ad\na.com##.own'));
  assert.deepEqual(built.generic, ['.ad']);
  assert.deepEqual(built.hosts, { 'a.com': ['.own'] });
});

test('cosmeticSelectors walks the host and its parent domains and removes their exceptions', () => {
  const built = index();
  assert.deepEqual(cosmeticSelectors(built, 'WWW.Example.com.'), {
    generic: ['#top-ad', '.not-on-safe', 'div[id^="ad-"]'],
    specific: ['.both-ad', '.example-ad'],
  });
  assert.deepEqual(cosmeticSelectors(built, 'a.sub.example.com'), {
    generic: ['#top-ad', '.not-on-safe', 'div[id^="ad-"]'],
    specific: ['.both-ad'],
  });
  assert.deepEqual(cosmeticSelectors(built, 'safe.net'), { generic: ['#top-ad', '.ad-banner', 'div[id^="ad-"]'], specific: [] });
  assert.deepEqual(cosmeticSelectors(built, 'live.news.org').specific, []);
  assert.deepEqual(cosmeticSelectors(built, 'www.news.org').specific, ['.news-ad']);
});

test('cosmeticSelectors gives only generic selectors to unknown, dotless and empty hosts, and never uses a bare TLD', () => {
  const built = buildCosmeticIndex(parseCosmeticRules('##.g\ncom##.tld'));
  const plain = { generic: ['.g'], specific: [] };
  assert.deepEqual(cosmeticSelectors(built, 'unknown.org'), plain);
  assert.deepEqual(cosmeticSelectors(built, 'localhost'), plain);
  assert.deepEqual(cosmeticSelectors(built, ''), plain);
  assert.deepEqual(cosmeticSelectors(built, 'site.com'), plain);
});

test('cosmeticCss writes display:none!important blocks of at most the chunk size, :has() selectors in their own blocks', () => {
  assert.equal(COSMETIC_CHUNK_SIZE, 1000);
  assert.equal(cosmeticCss([]), '');
  assert.equal(cosmeticCss(['.a', '#b']), '.a,#b{display:none!important}\n');
  assert.equal(
    cosmeticCss(['.a', '.w:has(.ad)', '.b', '.c'], 2),
    '.a,.b{display:none!important}\n.c{display:none!important}\n.w:has(.ad){display:none!important}\n',
  );
  const many = Array.from({ length: 2500 }, (_, i) => `.ad${i}`);
  const blocks = cosmeticCss(many).trimEnd().split('\n');
  assert.equal(blocks.length, 3);
  assert.equal(blocks[0].split(',').length, 1000);
  assert.equal(blocks[2].split(',').length, 500);
});

test('cosmeticCssForHost joins the generic and site blocks for a host, and is empty when disabled', () => {
  const built = index();
  assert.equal(
    cosmeticCssForHost(built, 'example.com', true),
    '#top-ad,.not-on-safe,div[id^="ad-"]{display:none!important}\n.both-ad,.example-ad{display:none!important}\n',
  );
  assert.equal(cosmeticCssForHost(built, 'example.com', false), '');
});

test('@@||site^$generichide turns off generic selectors and $elemhide/$document all selectors on that site', () => {
  const built = buildCosmeticIndex(
    parseCosmeticRules(
      [
        '##.g',
        'quiet.com##.q',
        'off.org##.o',
        '@@||quiet.com^$generichide',
        '@@||off.org^$elemhide',
        '@@||doc.net^$document',
        '@@||scoped.com^$generichide,domain=x.com',
        '@@||Ghide.io^$ghide',
      ].join('\n'),
    ),
  );
  assert.deepEqual(built.genericHide, ['ghide.io', 'quiet.com']);
  assert.deepEqual(built.elemHide, ['doc.net', 'off.org']);
  assert.deepEqual(cosmeticSelectors(built, 'www.quiet.com'), { generic: [], specific: ['.q'] });
  assert.deepEqual(cosmeticSelectors(built, 'off.org'), { generic: [], specific: [] });
  assert.deepEqual(cosmeticSelectors(built, 'a.doc.net'), { generic: [], specific: [] });
  assert.deepEqual(cosmeticSelectors(built, 'scoped.com'), { generic: ['.g'], specific: [] });
  assert.equal(cosmeticCssForHost(built, 'off.org', true), '');
});
