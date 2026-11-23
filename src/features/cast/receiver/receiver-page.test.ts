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
  receiverPath: (receiver: { base: string; key: string }, rest: string) => string;
  reachable: (receiver: { failures: number }) => boolean;
  statusText: (label: string, connected: boolean) => string;
  hubFromSearch: (search: unknown) => string | null;
  hubFallbackDue: (hub: string | null, lastAnswerAt: number, now: number) => boolean;
  hubEntry: (hub: string) => string;
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

test('the page talks only to its receivers\' key routes and loads hls.js from the same origin', () => {
  assert.match(PAGE, /"aB3dE9"/);
  assert.match(PAGE, /core\.receiverPath\(phone, '\/commands\?after=' \+ phone\.lastId\)/);
  assert.match(PAGE, /core\.receiverPath\(phone, '\/state'\)/);
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

test('each receiver is reached at its own origin and key; this phone\'s by a same-origin path', () => {
  assert.equal(core.receiverPath({ base: '', key: 'aB3dE9' }, '/commands?after=5'), '/tv/aB3dE9/commands?after=5');
  assert.equal(
    core.receiverPath({ base: 'http://192.168.0.30:8765', key: 'Zz9Yy8' }, '/state'),
    'http://192.168.0.30:8765/tv/Zz9Yy8/state',
  );
  // State goes only to phones whose last poll answered (no piling on an absent phone).
  assert.equal(core.reachable({ failures: 0 }), true);
  assert.equal(core.reachable({ failures: 1 }), false);
  assert.equal(core.statusText('MayLo de Ana', true), 'MayLo de Ana: conectado');
  assert.equal(core.statusText('MayLo de Ana', false), 'MayLo de Ana: buscando…');
});

const SHARED = buildReceiverPage({
  key: 'aB3dE9',
  phoneName: 'MayLo de Marcos',
  peers: [
    { url: 'http://192.168.0.30:8765/tv/Zz9Yy8', label: 'MayLo de <Ana>' },
    { url: 'javascript:alert(1)', label: 'Malo' },
    { url: 'http://192.168.0.31:8765/tv/aB3dE9', label: 'Mismo key' },
  ],
});

/** The RECEIVERS list the page script runs with. */
function receiversOf(html: string): { base: string; key: string; label: string }[] {
  const body = scripts(html)[0];
  return new Function(`${body.split('var MayloCore')[0]}\nreturn RECEIVERS;`)() as { base: string; key: string; label: string }[];
}

test('the page polls every known phone: this one first, then the valid other ones', () => {
  assert.deepEqual(receiversOf(SHARED), [
    { base: '', key: 'aB3dE9', label: 'MayLo de Marcos' },
    { base: 'http://192.168.0.30:8765', key: 'Zz9Yy8', label: 'MayLo de <Ana>' },
  ]);
  assert.deepEqual(receiversOf(PAGE), [{ base: '', key: 'aB3dE9', label: 'Moto <de> "Mar"' }]);
  // The only absolute URL in the page is the other phone's origin.
  assert.deepEqual([...SHARED.matchAll(/https?:\/\/[^"'\s<]*/gi)].map((match) => match[0]), ['http://192.168.0.30:8765']);
  assert.doesNotMatch(SHARED, /javascript:alert/);
  assert.doesNotMatch(SHARED, /Mismo key/);
});

test('each phone gets its own status line, escaped', () => {
  assert.match(SHARED, /<div id="net-0">MayLo de Marcos: buscando…<\/div>/);
  assert.match(SHARED, /<div id="net-1">MayLo de &lt;Ana&gt;: buscando…<\/div>/);
  assert.doesNotMatch(SHARED, /<Ana>/);
  for (const body of scripts(SHARED)) {
    assert.doesNotMatch(body, /=>|`|\blet\s|\bconst\s/);
    assert.doesNotThrow(() => new Function(body));
  }
});

test('?hub= is read as an http origin only', () => {
  const encoded = encodeURIComponent('http://192.168.0.50');
  assert.equal(core.hubFromSearch('?hub=' + encoded), 'http://192.168.0.50');
  assert.equal(core.hubFromSearch('?x=1&hub=' + encodeURIComponent('http://maylo-tv.local:8080')), 'http://maylo-tv.local:8080');
  assert.equal(core.hubFromSearch('?hub=http://maylo-tv.local'), 'http://maylo-tv.local');
  assert.equal(core.hubFromSearch('?hub=HTTP%3A%2F%2FMaylo-TV.local'), 'http://maylo-tv.local');
  for (const search of [
    '',
    '?',
    '?x=1',
    '?hub=',
    '?hub=' + encodeURIComponent('https://192.168.0.50'),
    '?hub=' + encodeURIComponent('http://192.168.0.50/'),
    '?hub=' + encodeURIComponent('http://192.168.0.50/evil'),
    '?hub=' + encodeURIComponent('http://192.168.0.50?x'),
    '?hub=' + encodeURIComponent('http://user@192.168.0.50'),
    '?hub=' + encodeURIComponent('javascript:alert(1)'),
    '?hub=' + encodeURIComponent('//evil.com'),
    '?hub=%E0%A4%A',
    '?hub=' + encodeURIComponent('http://a b'),
    '?hub=' + encodeURIComponent('http://192.168.0.50:99999'),
  ]) {
    assert.equal(core.hubFromSearch(search), null, search);
  }
  assert.equal(core.hubFromSearch(undefined), null);
  assert.equal(core.hubEntry('http://192.168.0.50'), 'http://192.168.0.50/');
});

test('the page goes back to the hub only after its own phone has not answered for 15 s', () => {
  const hub = 'http://192.168.0.50';
  assert.equal(core.hubFallbackDue(hub, 100_000, 100_000), false);
  assert.equal(core.hubFallbackDue(hub, 100_000, 114_999), false);
  assert.equal(core.hubFallbackDue(hub, 100_000, 115_000), true);
  assert.equal(core.hubFallbackDue(hub, 100_000, 160_000), true);
  // Without a hub (the favorite of a phone, not of the ESP32) the page stays.
  assert.equal(core.hubFallbackDue(null, 100_000, 160_000), false);
  assert.equal(core.hubFallbackDue('', 100_000, 160_000), false);
});

test('the page wires the hub fallback to its own phone and location.replace', () => {
  assert.match(PAGE, /core\.hubFromSearch\(location\.search\)/);
  assert.match(PAGE, /location\.replace\(core\.hubEntry\(hub\)\)/);
  assert.match(PAGE, /core\.hubFallbackDue\(hub, ownAnsweredAt, /);
});

test('state is posted as text/plain so another phone gets it without a preflight', () => {
  assert.match(PAGE, /setRequestHeader\('Content-Type', 'text\/plain'\)/);
  assert.doesNotMatch(PAGE, /application\/json/);
});
