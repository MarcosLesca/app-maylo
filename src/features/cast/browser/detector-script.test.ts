import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';

import { DETECTOR_SCRIPT } from './detector-script.ts';

type Listener = (event: { target: unknown }) => void;

/** A minimal frame: just the globals the detector touches, so we can see what it posts. */
type FakeIframe = {
  tagName: string;
  src: string;
  getAttribute(name: string): string | null;
  getBoundingClientRect(): { width: number; height: number };
  style: { display?: string; visibility?: string; opacity?: string };
};

function makeFrame(href = 'https://player.example.com/embed/1', { top = true } = {}) {
  const posted: Record<string, string>[] = [];
  const listeners: Record<string, Listener[]> = {};
  const elements: { tagName: string; src?: string; currentSrc?: string; getAttribute(name: string): string | null }[] = [];
  const fetchCalls: unknown[] = [];
  const xhrOpens: unknown[] = [];
  const iframes: FakeIframe[] = [];

  class FakeXHR {
    open(method: string, url: string) {
      xhrOpens.push([method, url]);
    }
  }

  const window: Record<string, unknown> = {
    location: { href },
    navigator: { userAgent: 'UA-frame' },
    document: {
      title: 'Movie page',
      cookie: 'sid=abc',
      documentElement: {},
      querySelectorAll: (selector: string) => (selector === 'iframe' ? iframes : elements),
      addEventListener: (type: string, fn: Listener) => (listeners[type] ??= []).push(fn),
    },
    ReactNativeWebView: { postMessage: (data: string) => posted.push(JSON.parse(data)) },
    fetch: (input: unknown) => {
      fetchCalls.push(input);
      return Promise.resolve('response');
    },
    XMLHttpRequest: FakeXHR,
    URL,
    JSON,
    setTimeout: (fn: () => void) => fn(),
    getComputedStyle: (el: FakeIframe) => el.style,
    addEventListener: (type: string, fn: Listener) => (listeners[type] ??= []).push(fn),
  };
  window.window = window;
  window.top = top ? window : {};
  const context = vm.createContext(window);
  vm.runInContext(DETECTOR_SCRIPT, context);

  const video = (src: string) => ({ tagName: 'VIDEO', src, currentSrc: src, getAttribute: () => src });
  const iframe = (src: string, width: number, height: number, style: FakeIframe['style'] = {}): FakeIframe => ({
    tagName: 'IFRAME',
    src,
    getAttribute: () => src,
    getBoundingClientRect: () => ({ width, height }),
    style,
  });
  return { window, context, posted, listeners, elements, iframes, iframe, video, fetchCalls, xhrOpens };
}

const run = (frame: ReturnType<typeof makeFrame>, code: string) => vm.runInContext(code, frame.context);

test('fetch of a media path is reported with page URL, title, user agent and cookie, and still performed', async () => {
  const frame = makeFrame();
  const result = await run(frame, `fetch('/hls/master.m3u8?token=1')`);
  assert.equal(result, 'response');
  assert.equal(frame.fetchCalls.length, 1);
  assert.deepEqual(frame.posted, [
    {
      type: 'maylo-video',
      url: 'https://player.example.com/hls/master.m3u8?token=1',
      pageUrl: 'https://player.example.com/embed/1',
      title: 'Movie page',
      userAgent: 'UA-frame',
      cookie: 'sid=abc',
    },
  ]);
});

test('XHR of .mp4, .webm and .mkv paths is reported; other paths are not', () => {
  const frame = makeFrame();
  run(
    frame,
    `for (const u of ['https://cdn.x/a.mp4', 'https://cdn.x/b.webm?x=1', 'https://cdn.x/c.MKV', 'https://cdn.x/seg1.ts', 'https://cdn.x/api.json', 'https://cdn.x/mp4']) {
      const x = new XMLHttpRequest(); x.open('GET', u);
    }`,
  );
  assert.equal(frame.xhrOpens.length, 6);
  assert.deepEqual(
    frame.posted.map((m) => m.url),
    ['https://cdn.x/a.mp4', 'https://cdn.x/b.webm?x=1', 'https://cdn.x/c.MKV'],
  );
});

test('video sources are reported once, blob: sources are skipped', () => {
  const frame = makeFrame();
  frame.elements.push(frame.video('https://cdn.x/movie'), frame.video('blob:https://player.example.com/123'));
  for (const fn of frame.listeners.loadstart ?? []) fn({ target: frame.elements[0] });
  for (const fn of frame.listeners.DOMContentLoaded ?? []) fn({ target: null });
  for (const fn of frame.listeners.loadstart ?? []) fn({ target: frame.elements[0] });
  assert.deepEqual(frame.posted.map((m) => m.url), ['https://cdn.x/movie']);
});

test('running the script twice in a frame does not wrap fetch twice', async () => {
  const frame = makeFrame();
  run(frame, DETECTOR_SCRIPT);
  await run(frame, `fetch('https://cdn.x/a.mp4')`);
  assert.equal(frame.fetchCalls.length, 1);
  assert.equal(frame.posted.length, 1);
});

test('the script has no per-site rules', () => {
  assert.doesNotMatch(DETECTOR_SCRIPT, /cinecalidad|youtube|archive\.org/i);
});

const fire = (frame: ReturnType<typeof makeFrame>, type: string) => {
  for (const fn of frame.listeners[type] ?? []) fn({ target: null });
};

test('the top page reports large visible iframes once, as a separate message kind', () => {
  const frame = makeFrame('https://movies.example.com/watch/7');
  frame.iframes.push(
    frame.iframe('https://player.other.net/embed/9', 640.4, 360),
    frame.iframe('/embed/local', 200, 120),
    frame.iframe('https://ads.example.com/banner', 300, 100),
    frame.iframe('https://ads.example.com/tall', 150, 600),
    frame.iframe('about:blank', 800, 450),
    frame.iframe('javascript:void(0)', 800, 450),
    frame.iframe('https://hidden.example.com/a', 800, 450, { display: 'none' }),
    frame.iframe('https://hidden.example.com/b', 800, 450, { visibility: 'hidden' }),
  );
  fire(frame, 'DOMContentLoaded');
  fire(frame, 'load');
  assert.deepEqual(frame.posted, [
    {
      type: 'maylo-frame',
      url: 'https://player.other.net/embed/9',
      pageUrl: 'https://movies.example.com/watch/7',
      width: 640,
      height: 360,
    },
    {
      type: 'maylo-frame',
      url: 'https://movies.example.com/embed/local',
      pageUrl: 'https://movies.example.com/watch/7',
      width: 200,
      height: 120,
    },
  ]);
});

test('frames inside other frames do not report iframes (only the top page can open them)', () => {
  const frame = makeFrame('https://player.other.net/embed/9', { top: false });
  frame.iframes.push(frame.iframe('https://player.other.net/inner', 640, 360));
  fire(frame, 'DOMContentLoaded');
  fire(frame, 'load');
  assert.deepEqual(frame.posted, []);
});

test('trusted taps are reported (throttled) with a timestamp; synthetic clicks are not', () => {
  const frame = makeFrame();
  let clock = 5_000;
  frame.window.Date = { now: () => clock };
  const tap = (type: string, isTrusted: boolean) => {
    for (const fn of frame.listeners[type] ?? []) (fn as (event: unknown) => void)({ target: null, isTrusted });
  };
  tap('pointerdown', true);
  tap('click', true);
  tap('click', false);
  clock += 400;
  tap('click', true);
  assert.deepEqual(frame.posted, [
    { type: 'maylo-tap', at: 5_000 },
    { type: 'maylo-tap', at: 5_400 },
  ]);
});
