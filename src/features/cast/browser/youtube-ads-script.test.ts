import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';

import { YOUTUBE_ADS_SCRIPT, youtubeAdsStateScript } from './youtube-ads-script.ts';

type Page = { window: Record<string, unknown>; run(code: string): unknown };

/** A fresh Response class per page, so each page's hook wraps only its own prototype. */
function makeResponse() {
  return class FakeResponse {
    body: unknown;
    constructor(body: unknown) {
      this.body = body;
    }
    json() {
      return Promise.resolve(JSON.parse(JSON.stringify(this.body)));
    }
  };
}
type FakeResponse = ReturnType<typeof makeResponse>;

function makePage(hostname = 'm.youtube.com', storage: Record<string, string> = {}): Page {
  const sessionStorage = {
    getItem: (key: string) => (key in storage ? storage[key] : null),
    setItem: (key: string, value: string) => (storage[key] = String(value)),
    removeItem: (key: string) => delete storage[key],
  };
  const window: Record<string, unknown> = {
    location: { hostname, protocol: 'https:' },
    sessionStorage,
    // The context's own JSON/Object builtins: the script patches JSON.parse, which must not leak here.
    Response: makeResponse(),
  };
  window.window = window;
  const context = vm.createContext(window);
  vm.runInContext(YOUTUBE_ADS_SCRIPT, context);
  return { window, run: (code: string) => vm.runInContext(code, context) };
}

const playerResponse = () => ({
  videoDetails: { videoId: 'abc' },
  streamingData: { formats: [1] },
  adPlacements: [{ ad: 1 }],
  playerAds: [{ ad: 2 }],
  adSlots: [{ ad: 3 }],
  adBreakHeartbeatParams: 'x',
});
const CLEAN = { videoDetails: { videoId: 'abc' }, streamingData: { formats: [1] } };

test('removes the ads from the player data the page parses', () => {
  const page = makePage();
  const parsed = page.run(`JSON.parse(${JSON.stringify(JSON.stringify(playerResponse()))})`);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed)), CLEAN);
});

test('removes the ads nested under playerResponse', () => {
  const page = makePage();
  const text = JSON.stringify({ playerResponse: playerResponse(), other: 1 });
  const parsed = page.run(`JSON.parse(${JSON.stringify(text)})`);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed)), { playerResponse: CLEAN, other: 1 });
});

test('removes the ads from the initial player response of the page', () => {
  const page = makePage();
  page.run(`var ytInitialPlayerResponse = ${JSON.stringify(playerResponse())};`);
  assert.deepEqual(JSON.parse(JSON.stringify(page.run('ytInitialPlayerResponse'))), CLEAN);
});

test('removes the ads from fetched player responses', async () => {
  const page = makePage();
  const response = new (page.window.Response as FakeResponse)(playerResponse());
  assert.deepEqual(await response.json(), CLEAN);
});

test('leaves unrelated JSON untouched', () => {
  const page = makePage();
  const parsed = page.run(`JSON.parse('{"a":1,"list":[1,2]}')`);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed)), { a: 1, list: [1, 2] });
  assert.equal(page.run(`JSON.parse('null')`), null);
  assert.equal(page.run(`JSON.parse('3')`), 3);
});

test('keeps the ads while the shield is off', async () => {
  const page = makePage('m.youtube.com', { 'maylo-adblock-off': '1' });
  const parsed = page.run(`JSON.parse(${JSON.stringify(JSON.stringify(playerResponse()))})`);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed)), playerResponse());
  page.run(`var ytInitialPlayerResponse = ${JSON.stringify(playerResponse())};`);
  assert.deepEqual(JSON.parse(JSON.stringify(page.run('ytInitialPlayerResponse'))), playerResponse());
  const response = new (page.window.Response as FakeResponse)(playerResponse());
  assert.deepEqual(await response.json(), playerResponse());
});

test('the shield state script switches pruning on the open page', () => {
  const page = makePage();
  const text = JSON.stringify(JSON.stringify(playerResponse()));
  page.run(youtubeAdsStateScript(false));
  assert.deepEqual(JSON.parse(JSON.stringify(page.run(`JSON.parse(${text})`))), playerResponse());
  page.run(youtubeAdsStateScript(true));
  assert.deepEqual(JSON.parse(JSON.stringify(page.run(`JSON.parse(${text})`))), CLEAN);
});

test('works on youtube.com, its subdomains and youtube-nocookie.com only', () => {
  const text = JSON.stringify(JSON.stringify(playerResponse()));
  for (const host of ['www.youtube.com', 'youtube.com', 'www.youtube-nocookie.com']) {
    const parsed = makePage(host).run(`JSON.parse(${text})`);
    assert.deepEqual(JSON.parse(JSON.stringify(parsed)), CLEAN, host);
  }
  for (const host of ['example.com', 'notyoutube.com', 'youtube.com.evil.net']) {
    const parsed = makePage(host).run(`JSON.parse(${text})`);
    assert.deepEqual(JSON.parse(JSON.stringify(parsed)), playerResponse(), host);
  }
});

test('running the script twice keeps a single hook', () => {
  const page = makePage();
  const parse = page.run('JSON.parse');
  page.run(YOUTUBE_ADS_SCRIPT);
  assert.equal(page.run('JSON.parse'), parse);
});

test('removes the ads from array responses', () => {
  const page = makePage();
  const text = JSON.stringify([{ playerResponse: playerResponse() }, { other: 1 }]);
  const parsed = page.run(`JSON.parse(${JSON.stringify(text)})`);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed)), [{ playerResponse: CLEAN }, { other: 1 }]);
});

test('passes the reviver through and keeps parse errors', () => {
  const page = makePage();
  assert.equal(page.run(`JSON.parse('{"a":1}', function (k, v) { return k === 'a' ? 2 : v; }).a`), 2);
  assert.throws(() => page.run(`JSON.parse('{bad')`), (error: Error) => error.name === 'SyntaxError');
  assert.equal(page.run(`JSON.parse('"s"')`), 's');
  assert.equal(page.run(`JSON.parse('false')`), false);
});

test('the hooks look like the functions they wrap', () => {
  const page = makePage();
  assert.match(String(page.run('JSON.parse.toString()')), /\[native code\]/);
  assert.equal(page.run('JSON.parse.length'), 2);
});
