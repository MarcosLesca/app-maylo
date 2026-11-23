import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';

import { COSMETIC_REFRESH_MESSAGE, cosmeticRefreshScript, cosmeticScript } from './cosmetic-script.ts';

const BASE = 'https://maylo-web-guard.invalid/cosmetic.css';

type FakeElement = {
  tagName: string;
  rel?: string;
  href?: string;
  parentNode: FakeElement | null;
  isConnected: boolean;
  children: FakeElement[];
  attributes: Record<string, string>;
  setAttribute(name: string, value: string): void;
  appendChild(child: FakeElement): FakeElement;
  removeChild(child: FakeElement): FakeElement;
};

function element(tagName: string, connected = false): FakeElement {
  const el: FakeElement = {
    tagName,
    parentNode: null,
    isConnected: connected,
    children: [],
    attributes: {},
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    appendChild(child) {
      child.parentNode = this;
      child.isConnected = this.isConnected;
      this.children.push(child);
      return child;
    },
    removeChild(child) {
      this.children = this.children.filter((item) => item !== child);
      child.parentNode = null;
      child.isConnected = false;
      return child;
    },
  };
  return el;
}

function makeFrame(href: string, { childFrames = 0, script = cosmeticScript(BASE) } = {}) {
  const html = element('HTML', true);
  const listeners: Record<string, ((event: unknown) => void)[]> = {};
  const observers: (() => void)[] = [];
  const parent = { name: 'parent' };
  const childMessages: unknown[][] = [];
  const frames = Array.from({ length: childFrames }, (_, i) => ({
    postMessage: (data: unknown, origin: string) => childMessages.push([i, data, origin]),
  }));
  const window: Record<string, unknown> = {
    location: { href, hostname: new URL(href).hostname, protocol: new URL(href).protocol },
    document: {
      documentElement: html,
      head: null,
      createElement: (tag: string) => element(tag.toUpperCase()),
      addEventListener: (type: string, fn: (event: unknown) => void) => (listeners[type] ??= []).push(fn),
    },
    frames: Object.assign(frames, { length: childFrames }),
    parent,
    encodeURIComponent,
    MutationObserver: class {
      callback: () => void;
      constructor(callback: () => void) {
        this.callback = callback;
      }
      observe() {
        observers.push(this.callback);
      }
    },
    addEventListener: (type: string, fn: (event: unknown) => void) => (listeners[type] ??= []).push(fn),
  };
  window.window = window;
  const context = vm.createContext(window);
  vm.runInContext(script, context);
  vm.runInContext(script, context);
  const links = () => html.children.filter((child) => child.tagName === 'LINK');
  const emit = (type: string, event: unknown = {}) => (listeners[type] ?? []).forEach((fn) => fn(event));
  return { window, context, html, links, observers, emit, parent, childMessages };
}

test('the loader adds one stylesheet link for the frame host at document start, even when injected twice', () => {
  const frame = makeFrame('https://www.Example.com/watch?v=1');
  const links = frame.links();
  assert.equal(links.length, 1);
  assert.equal(links[0].rel, 'stylesheet');
  assert.equal(links[0].href, `${BASE}?host=www.example.com`);
});

test('the loader re-adds the link when the page removes it', () => {
  const frame = makeFrame('https://site.org/');
  frame.html.removeChild(frame.links()[0]);
  assert.equal(frame.links().length, 0);
  frame.observers.forEach((callback) => callback());
  assert.equal(frame.links().length, 1);
  frame.emit('DOMContentLoaded');
  assert.equal(frame.links().length, 1);
});

test('frames that are not http(s) pages load nothing', () => {
  assert.equal(makeFrame('about:blank').links().length, 0);
  assert.equal(makeFrame('data:text/html,hi').links().length, 0);
});

test('a refresh from the app or the parent frame reloads the stylesheet and reaches child frames', () => {
  const frame = makeFrame('https://site.org/', { childFrames: 2 });
  vm.runInContext(cosmeticRefreshScript(), frame.context);
  let links = frame.links();
  assert.equal(links.length, 1);
  assert.equal(links[0].href, `${BASE}?host=site.org&v=1`);
  assert.deepEqual(frame.childMessages, [
    [0, COSMETIC_REFRESH_MESSAGE, '*'],
    [1, COSMETIC_REFRESH_MESSAGE, '*'],
  ]);

  frame.emit('message', { data: COSMETIC_REFRESH_MESSAGE, source: frame.parent });
  links = frame.links();
  assert.equal(links.length, 1);
  assert.equal(links[0].href, `${BASE}?host=site.org&v=2`);
});

test('a refresh message from anything but the parent frame is ignored', () => {
  const frame = makeFrame('https://site.org/');
  frame.emit('message', { data: COSMETIC_REFRESH_MESSAGE, source: {} });
  frame.emit('message', { data: 'other', source: frame.parent });
  assert.equal(frame.links()[0].href, `${BASE}?host=site.org`);
});

test('the refresh script is harmless where the loader is not installed', () => {
  assert.doesNotThrow(() => vm.runInContext(cosmeticRefreshScript(), vm.createContext({ window: {} })));
});

test('the loader script stays small', () => {
  assert.ok(cosmeticScript(BASE).length < 4000);
});
