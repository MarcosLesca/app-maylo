import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';

import { parseShareMessage, SHARE_SCRIPT, shareText } from './share-script.ts';

type Navigator = { userAgent: string; share?: unknown; canShare?: unknown };

function makePage({ bridge = true, navigator = { userAgent: 'UA' } as Navigator } = {}) {
  const posted: Record<string, unknown>[] = [];
  const window: Record<string, unknown> = {
    location: { href: 'https://m.youtube.com/watch?v=abc' },
    navigator,
    document: { title: 'A video - YouTube' },
    URL,
    JSON,
    Promise,
  };
  if (bridge) window.ReactNativeWebView = { postMessage: (data: string) => posted.push(JSON.parse(data)) };
  window.window = window;
  const context = vm.createContext(window);
  vm.runInContext(SHARE_SCRIPT, context);
  return { navigator, posted };
}

test('adds navigator.share when the WebView lacks it and posts what the page shares', async () => {
  const { navigator, posted } = makePage();
  assert.equal(typeof navigator.share, 'function');
  const share = navigator.share as (data: unknown) => Promise<unknown>;
  const result = await share({ title: 'A video', text: 'Look', url: '/watch?v=abc' });
  assert.equal(result, undefined);
  assert.deepEqual(posted, [
    { type: 'maylo-share', title: 'A video', text: 'Look', url: 'https://m.youtube.com/watch?v=abc' },
  ]);
});

test('canShare accepts text and links but not files', () => {
  const { navigator } = makePage();
  const canShare = navigator.canShare as (data: unknown) => boolean;
  assert.equal(canShare({ url: 'https://example.com' }), true);
  assert.equal(canShare({ text: 'hi' }), true);
  assert.equal(canShare({ files: [{}], url: 'https://example.com' }), false);
  assert.equal(canShare({}), false);
  assert.equal(canShare(undefined), false);
});

test('share rejects data it cannot share and posts nothing', async () => {
  const { navigator, posted } = makePage();
  const share = navigator.share as (data: unknown) => Promise<unknown>;
  await assert.rejects(share({}), (error: { name?: string }) => error.name === 'TypeError');
  await assert.rejects(share({ files: [{}] }), (error: { name?: string }) => error.name === 'TypeError');
  assert.deepEqual(posted, []);
});

test('keeps a native navigator.share untouched', () => {
  const native = () => Promise.resolve();
  const { navigator } = makePage({ navigator: { userAgent: 'UA', share: native } });
  assert.equal(navigator.share, native);
  assert.equal(navigator.canShare, undefined);
});

test('adds nothing in a frame without the app bridge', () => {
  const { navigator } = makePage({ bridge: false });
  assert.equal(navigator.share, undefined);
});

test('parseShareMessage reads only well-formed share messages', () => {
  assert.deepEqual(
    parseShareMessage(JSON.stringify({ type: 'maylo-share', title: 'T', text: 'X', url: 'https://a.com/v' })),
    { title: 'T', text: 'X', url: 'https://a.com/v' },
  );
  assert.deepEqual(parseShareMessage(JSON.stringify({ type: 'maylo-share', url: 'https://a.com/v' })), {
    title: '',
    text: '',
    url: 'https://a.com/v',
  });
  assert.deepEqual(parseShareMessage(JSON.stringify({ type: 'maylo-share', url: 'javascript:alert(1)', text: 'X' })), {
    title: '',
    text: 'X',
    url: '',
  });
  assert.equal(parseShareMessage(JSON.stringify({ type: 'maylo-share', url: 'javascript:alert(1)' })), null);
  assert.equal(parseShareMessage(JSON.stringify({ type: 'maylo-tap', at: 1 })), null);
  assert.equal(parseShareMessage('not json'), null);
});

test('shareText joins the text and the link without repeating it', () => {
  assert.equal(shareText({ title: 'T', text: 'Look', url: 'https://a.com/v' }), 'Look\nhttps://a.com/v');
  assert.equal(shareText({ title: 'T', text: '', url: 'https://a.com/v' }), 'https://a.com/v');
  assert.equal(shareText({ title: 'T', text: 'Look https://a.com/v', url: 'https://a.com/v' }), 'Look https://a.com/v');
  assert.equal(shareText({ title: 'T', text: 'Look', url: '' }), 'Look');
});
