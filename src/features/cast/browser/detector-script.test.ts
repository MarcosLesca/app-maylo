import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';

import { DETECTOR_SCRIPT } from './detector-script.ts';

type Listener = (event: { target: unknown }) => void;

/** A minimal frame: just the globals the detector touches, so we can see what it posts. */
function makeFrame(href = 'https://player.example.com/embed/1') {
  const posted: Record<string, string>[] = [];
  const listeners: Record<string, Listener[]> = {};
  const elements: { tagName: string; src?: string; currentSrc?: string; getAttribute(name: string): string | null }[] = [];
  const fetchCalls: unknown[] = [];
  const xhrOpens: unknown[] = [];

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
      querySelectorAll: () => elements,
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
    addEventListener: (type: string, fn: Listener) => (listeners[type] ??= []).push(fn),
  };
  window.window = window;
  const context = vm.createContext(window);
  vm.runInContext(DETECTOR_SCRIPT, context);

  const video = (src: string) => ({ tagName: 'VIDEO', src, currentSrc: src, getAttribute: () => src });
  return { window, context, posted, listeners, elements, video, fetchCalls, xhrOpens };
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
