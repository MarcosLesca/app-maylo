import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildReceiverPage, RECEIVER_CORE } from './receiver-page.ts';

type Core = {
  applyCommand: (player: Record<string, (...args: unknown[]) => void>, command: unknown) => boolean;
  pendingCommands: (commands: unknown, lastId: number) => { id: number; type: string }[];
  snapshot: (video: Record<string, unknown> | null, info: { mode: string; error: string | null; title: string }) => unknown;
  nextDelay: (failures: number) => number;
  firstBatch: <T>(commands: T[], elapsedMs: number) => T[];
  isHls: (url: string) => boolean;
};

/** The exact ES5 source the TV runs, evaluated in Node. */
const core = new Function(`${RECEIVER_CORE}\nreturn MayloCore;`)() as Core;

function fakePlayer() {
  const calls: unknown[][] = [];
  const player: Record<string, (...args: unknown[]) => void> = {};
  for (const name of ['load', 'play', 'pause', 'seek', 'stop', 'setVolume', 'setMuted']) {
    player[name] = (...args: unknown[]) => {
      calls.push([name, ...args]);
    };
  }
  return { player, calls };
}

test('each command drives the player once, with validated arguments', () => {
  const { player, calls } = fakePlayer();
  const commands = [
    { id: 1, type: 'load', url: 'http://192.168.0.249:8765/s/t/aGk/x.m3u8', title: 'Peli' },
    { id: 2, type: 'pause' },
    { id: 3, type: 'play' },
    { id: 4, type: 'seek', seconds: 42 },
    { id: 5, type: 'volume', level: 50 },
    { id: 6, type: 'mute', muted: true },
    { id: 7, type: 'stop' },
  ];
  assert.deepEqual(
    commands.map((command) => core.applyCommand(player, command)),
    [true, true, true, true, true, true, true],
  );
  assert.deepEqual(calls, [
    ['load', 'http://192.168.0.249:8765/s/t/aGk/x.m3u8', 'Peli'],
    ['pause'],
    ['play'],
    ['seek', 42],
    ['setVolume', 0.5],
    ['setMuted', true],
    ['stop'],
  ]);
});

test('bad or unknown commands are ignored without touching the player', () => {
  const { player, calls } = fakePlayer();
  for (const command of [
    null,
    'play',
    { type: 'dance' },
    { type: 'seek', seconds: 'x' },
    { type: 'seek', seconds: -3 },
    { type: 'load', url: 'javascript:alert(1)', title: 'x' },
    { type: 'load' },
    { type: 'volume', level: 'loud' },
    { type: 'mute', muted: 'yes' },
  ]) {
    assert.equal(core.applyCommand(player, command), false, JSON.stringify(command));
  }
  assert.deepEqual(calls, []);
  // Volume is clamped to 0-100 before becoming 0-1.
  core.applyCommand(player, { type: 'volume', level: 250 });
  core.applyCommand(player, { type: 'volume', level: -5 });
  assert.deepEqual(calls, [
    ['setVolume', 1],
    ['setVolume', 0],
  ]);
});

test('commands run in id order, each at most once', () => {
  const list = [
    { id: 5, type: 'play' },
    { id: 3, type: 'pause' },
    { id: 4, type: 'seek', seconds: 1 },
    { id: 2, type: 'stop' },
    { id: 'x', type: 'stop' },
  ];
  assert.deepEqual(
    core.pendingCommands(list, 2).map((command) => command.id),
    [3, 4, 5],
  );
  assert.deepEqual(core.pendingCommands(list, 5), []);
  assert.deepEqual(core.pendingCommands(null, 0), []);
});

test('a freshly opened page skips the backlog it gets at once, but runs what arrived while it waited', () => {
  const backlog = [{ id: 7, type: 'load' }, { id: 8, type: 'stop' }];
  assert.deepEqual(core.firstBatch(backlog, 40), []);
  assert.deepEqual(core.firstBatch(backlog, 999), []);
  assert.deepEqual(core.firstBatch(backlog, 1000), backlog);
  assert.deepEqual(core.firstBatch(backlog, 25000), backlog);
});

test('the reported state has the shape the app reads', () => {
  const video = { currentTime: 12.345, duration: 600, paused: false, ended: false, volume: 0.8, muted: false };
  assert.deepEqual(core.snapshot(video, { mode: 'video', error: null, title: 'Peli' }), {
    status: 'playing',
    position: 12.3,
    duration: 600,
    volume: 80,
    muted: false,
    error: null,
    title: 'Peli',
  });
  assert.deepEqual(core.snapshot({ ...video, paused: true }, { mode: 'video', error: null, title: 'Peli' }), {
    status: 'paused',
    position: 12.3,
    duration: 600,
    volume: 80,
    muted: false,
    error: null,
    title: 'Peli',
  });
  assert.equal((core.snapshot({ ...video, paused: true, ended: true }, { mode: 'video', error: null, title: '' }) as { status: string }).status, 'ended');
  assert.equal((core.snapshot({ ...video, paused: true }, { mode: 'loading', error: null, title: '' }) as { status: string }).status, 'loading');
  // Live streams (Infinity) and unknown durations report null.
  assert.equal((core.snapshot({ ...video, duration: Infinity }, { mode: 'video', error: null, title: '' }) as { duration: null }).duration, null);
  assert.equal((core.snapshot({ ...video, duration: Number.NaN }, { mode: 'video', error: null, title: '' }) as { duration: null }).duration, null);
  assert.deepEqual(core.snapshot(null, { mode: 'idle', error: null, title: '' }), {
    status: 'idle',
    position: null,
    duration: null,
    volume: null,
    muted: false,
    error: null,
    title: '',
  });
  assert.deepEqual(core.snapshot(video, { mode: 'error', error: 'No se pudo reproducir este video', title: 'Peli' }), {
    status: 'error',
    position: 12.3,
    duration: 600,
    volume: 80,
    muted: false,
    error: 'No se pudo reproducir este video',
    title: 'Peli',
  });
});

test('reconnection backs off 1, 2, 4, 8 then 10 s', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map(core.nextDelay), [0, 1000, 2000, 4000, 8000, 10000, 10000]);
});

test('HLS is told apart by the playlist path, ignoring the query', () => {
  assert.equal(core.isHls('http://192.168.0.249:8765/s/t/aGk/x.m3u8'), true);
  assert.equal(core.isHls('http://h/a.M3U8?x=1'), true);
  assert.equal(core.isHls('http://h/a.mp4?m3u8'), false);
  assert.equal(core.isHls('http://h/a.webm'), false);
});

const PAGE = buildReceiverPage({ key: 'aB3dE9', phoneName: 'Moto <de> "Mar"' });

test('the page is self-contained: no external URL, scripts or styles', () => {
  assert.doesNotMatch(PAGE, /https?:\/\//i);
  assert.doesNotMatch(PAGE, /(?:src|href)\s*=\s*["']?\/\//i);
  assert.doesNotMatch(PAGE, /<link\b/i);
  assert.match(PAGE, /<style>/);
  assert.match(PAGE, /^<!DOCTYPE html>/);
});

test('the page shows the Spanish idle/error texts and the escaped phone name', () => {
  assert.match(PAGE, /Listo para recibir videos de MayLo/);
  assert.match(PAGE, /No se pudo reproducir este video/);
  assert.match(PAGE, /Moto &lt;de&gt; &quot;Mar&quot;/);
  assert.doesNotMatch(PAGE, /Moto <de>/);
  assert.match(PAGE, /lang="es"/);
});

test('the page talks only to its own key routes and loads hls.js from the same origin', () => {
  assert.match(PAGE, /"aB3dE9"/);
  assert.match(PAGE, /'\/tv\/' \+ KEY \+ '\/commands\?after='/);
  assert.match(PAGE, /'\/tv\/' \+ KEY \+ '\/state'/);
  // Absolute path on the same origin, so a favorite saved with a trailing slash still finds it.
  assert.match(PAGE, /'\/tv\/' \+ KEY \+ '\/hls\.js'/);
  assert.throws(() => buildReceiverPage({ key: '../etc', phoneName: '' }), /key/);
});

/** Inline script bodies of the page. */
function scripts(html: string): string[] {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
}

test('the page script is ES5 for an old TV browser and parses', () => {
  const bodies = scripts(PAGE);
  assert.ok(bodies.length >= 1);
  for (const body of bodies) {
    assert.doesNotMatch(body, /=>/, 'arrow function');
    assert.doesNotMatch(body, /\?\./, 'optional chaining');
    assert.doesNotMatch(body, /\?\?/, 'nullish coalescing');
    assert.doesNotMatch(body, /`/, 'template literal');
    assert.doesNotMatch(body, /\b(?:let|const|class|async|await)\s/, 'ES2015+ keyword');
    assert.doesNotMatch(body, /\bfetch\(/, 'fetch without XHR');
    assert.doesNotMatch(body, /<\/script/i);
    assert.doesNotThrow(() => new Function(body));
  }
  assert.ok(bodies.join('\n').includes('XMLHttpRequest'));
});
