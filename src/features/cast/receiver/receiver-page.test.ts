import assert from 'node:assert/strict';
import { test } from 'node:test';

import { youtubeLoad } from '../youtube/master.ts';
import { buildReceiverPage, RECEIVER_CORE } from './receiver-page.ts';

type Core = {
  applyCommand: (player: Record<string, (...args: unknown[]) => void>, command: unknown) => boolean;
  pendingCommands: (commands: unknown, lastId: number) => { id: number; type: string }[];
  snapshot: (
    video: Record<string, unknown> | null,
    info: { mode: string; error: string | null; title: string; from?: unknown },
  ) => unknown;
  nextDelay: (failures: number) => number;
  firstBatch: <T>(commands: T[], elapsedMs: number) => T[];
  isHls: (url: string) => boolean;
  receiverPath: (receiver: { base: string; key: string }, rest: string) => string;
  reachable: (receiver: { failures: number }) => boolean;
  statusText: (label: string, connected: boolean) => string;
  hubFromSearch: (search: unknown) => string | null;
  hubFallbackDue: (hub: string | null, lastAnswerAt: number, now: number) => boolean;
  hubEntry: (hub: string) => string;
  personName: (label: string) => string;
  initial: (name: string) => string;
  presence: (connected: boolean | null) => { className: string; text: string };
  senderText: (name: string) => string;
  badgeText: (name: string) => string;
  formatTime: (seconds: unknown) => string;
  progress: (current: unknown, duration: unknown) => number;
  osdVisible: (paused: boolean, shownAt: number | null, now: number) => boolean;
  parseIsoDate: (value: unknown) => { year: number; month: number; day: number } | null;
  anniversaryDay: (month: number, day: number, year: number) => number;
  daysUntil: (iso: unknown, now: Date) => number | null;
  yearsTogether: (iso: unknown, now: Date) => number | null;
  countdownText: (iso: unknown, now: Date) => string;
  clockText: (now: Date) => string;
  ambientDue: (mode: string, ended: boolean, activityAt: number, now: number) => boolean;
  driftOffset: (now: number) => { x: number; y: number };
  playlistLoader: (Base: unknown, lists: Record<string, string>) => unknown;
  hlsConfig: () => Record<string, number>;
  errorInfo: (data: Record<string, unknown>) => unknown;
  recovery: (data: Record<string, unknown>, past: unknown[], now: number) => string;
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
    from: '',
  });
  assert.deepEqual(core.snapshot({ ...video, paused: true }, { mode: 'video', error: null, title: 'Peli' }), {
    status: 'paused',
    position: 12.3,
    duration: 600,
    volume: 80,
    muted: false,
    error: null,
    title: 'Peli',
    from: '',
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
    from: '',
  });
  assert.deepEqual(core.snapshot(video, { mode: 'error', error: 'No se pudo reproducir este video', title: 'Peli' }), {
    status: 'error',
    position: 12.3,
    duration: 600,
    volume: 80,
    muted: false,
    error: 'No se pudo reproducir este video',
    title: 'Peli',
    from: '',
  });
});

test('the reported state names the phone that loaded the video, as the loading screen does', () => {
  const video = { currentTime: 3, duration: 600, paused: false, ended: false, volume: 1, muted: false };
  const sender = core.personName('MayLo de Loana');
  const state = core.snapshot(video, { mode: 'video', error: null, title: 'Peli', from: sender }) as { from: string; title: string };
  assert.equal(state.from, 'Loana');
  assert.equal(state.title, 'Peli');
  assert.equal(core.senderText(state.from), 'Lo mandó Loana · cargando el video…');
  assert.equal((core.snapshot(video, { mode: 'loading', error: null, title: 'Peli', from: sender }) as { from: string }).from, 'Loana');
  // Unknown sender or not a string: empty; long names are cut like labels (60).
  assert.equal((core.snapshot(video, { mode: 'video', error: null, title: 'Peli' }) as { from: string }).from, '');
  assert.equal((core.snapshot(video, { mode: 'video', error: null, title: 'Peli', from: 7 }) as { from: string }).from, '');
  assert.equal((core.snapshot(video, { mode: 'video', error: null, title: '', from: 'x'.repeat(80) }) as { from: string }).from, 'x'.repeat(60));
});

test('the page posts the sender it shows', () => {
  assert.match(PAGE, /core\.snapshot\([^)]*\{ mode: mode, error: errorText, title: title, from: sender, detail: lastError \}\)/);
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

test('the page shows the Spanish texts of the four states; names only reach it as escaped script data', () => {
  for (const text of [
    'Listo para recibir videos',
    'En MayLo abrí la página del video y tocá “Ver en la tele”.',
    'No se pudo reproducir este video',
    'Probá con otro servidor o calidad en la página, o usá “Duplicar la pantalla” desde MayLo.',
    'Sigue listo para recibir otro video.',
    'TV MayLo · recibiendo desde ',
  ]) {
    assert.ok(PAGE.includes(text), text);
  }
  // The name is data in RECEIVERS (escaped for the script), drawn with text nodes only.
  assert.ok(PAGE.includes('Moto \\u003cde\\u003e \\"Mar\\"'));
  assert.doesNotMatch(PAGE, /Moto <de>/);
  assert.doesNotMatch(PAGE, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  assert.match(PAGE, /lang="es"/);
});

test('the page CSS is safe for an old TV browser', () => {
  const css = PAGE.split('<style>')[1].split('</style>')[0];
  assert.doesNotMatch(css, /var\(--|--[a-z-]+\s*:/, 'CSS variables');
  assert.doesNotMatch(css, /\bgap\s*:/, 'flex/grid gap');
  assert.doesNotMatch(css, /display\s*:\s*(?:inline-)?grid|place-items/, 'grid');
  // Every gradient background comes after a solid color in the same rule.
  for (const rule of css.split('}')) {
    if (!/gradient\(/.test(rule)) continue;
    assert.match(rule, /background\s*:\s*(?:#[0-9A-Fa-f]{3,8}|rgba?\([^)]*\))\s*;[^}]*background\s*:[^;]*gradient\(/, rule);
  }
  assert.match(css, /prefers-reduced-motion/);
  assert.ok(PAGE.length < 30000, `page is ${PAGE.length} bytes`);
});

test('avatars show the member name, its initial and whether the phone answers', () => {
  assert.equal(core.personName('MayLo de Marcos'), 'Marcos');
  assert.equal(core.personName('maylo de  Loana '), 'Loana');
  assert.equal(core.personName('Moto <de> "Mar"'), 'Moto <de> "Mar"');
  assert.equal(core.personName('MayLo'), 'MayLo');
  assert.equal(core.initial('loana'), 'L');
  assert.equal(core.initial('😀 Ana'), '😀');
  assert.equal(core.initial(''), '?');
  assert.deepEqual(core.presence(true), { className: 'on', text: 'En línea' });
  assert.deepEqual(core.presence(false), { className: 'off', text: 'Sin conexión' });
  assert.deepEqual(core.presence(null), { className: '', text: 'Buscando…' });
});

test('loading and the OSD name the phone that sent the video, when known', () => {
  assert.equal(core.senderText('Loana'), 'Lo mandó Loana · cargando el video…');
  assert.equal(core.senderText(''), 'Cargando el video…');
  assert.equal(core.badgeText('Loana'), 'MayLo · Loana');
  assert.equal(core.badgeText(''), 'MayLo');
});

test('OSD times read m:ss under an hour and h:mm:ss above; unknown is --:--', () => {
  assert.deepEqual(
    [0, 5.9, 59, 60, 724, 3599, 3600, 5760, 36000].map(core.formatTime),
    ['0:00', '0:05', '0:59', '1:00', '12:04', '59:59', '1:00:00', '1:36:00', '10:00:00'],
  );
  for (const bad of [Infinity, Number.NaN, -1, null, 'x']) assert.equal(core.formatTime(bad), '--:--', String(bad));
  assert.equal(core.progress(724, 5760), (724 / 5760) * 100);
  assert.equal(core.progress(10, 5), 100);
  assert.equal(core.progress(10, Infinity), 0);
  assert.equal(core.progress(10, 0), 0);
  assert.equal(core.progress(Number.NaN, 100), 0);
});

test('the OSD shows for 4 s after a command, and stays while paused', () => {
  assert.equal(core.osdVisible(false, null, 50_000), false);
  assert.equal(core.osdVisible(false, 50_000, 50_000), true);
  assert.equal(core.osdVisible(false, 50_000, 53_999), true);
  assert.equal(core.osdVisible(false, 50_000, 54_000), false);
  assert.equal(core.osdVisible(true, 50_000, 90_000), true);
  assert.equal(core.osdVisible(true, null, 90_000), true);
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

test('each phone gets its own avatar, drawn from script data with text nodes', () => {
  assert.match(SHARED, /<div id="phones"><\/div>/);
  assert.match(SHARED, /createTextNode\(core\.initial\(/);
  assert.match(SHARED, /core\.personName\(RECEIVERS\[r\]\.label\)/);
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

/* Ambient mode (S3, D6): clock and yearly anniversary countdown while nothing plays. */

const at = (year: number, month: number, day: number, hour = 12, minute = 0) => new Date(year, month - 1, day, hour, minute);

test('ambient countdown counts the days to the next yearly anniversary', () => {
  assert.equal(core.countdownText('2020-03-14', at(2026, 3, 1)), 'Faltan 13 días para nuestro aniversario');
  assert.equal(core.countdownText('2020-03-14', at(2026, 3, 12, 23, 59)), 'Faltan 2 días para nuestro aniversario');
  // Past this year's date: counts to next year's.
  assert.equal(core.daysUntil('2020-03-14', at(2026, 3, 15)), 364);
  assert.equal(core.countdownText('2020-03-14', at(2026, 3, 15)), 'Faltan 364 días para nuestro aniversario');
  // Midnight and late evening of the same day count the same.
  assert.equal(core.daysUntil('2020-03-14', at(2026, 3, 1, 0, 0)), 13);
  assert.equal(core.daysUntil('2020-03-14', at(2026, 3, 1, 23, 59)), 13);
});

test('ambient countdown says tomorrow when 1 day is left', () => {
  assert.equal(core.daysUntil('2020-03-14', at(2026, 3, 13)), 1);
  assert.equal(core.countdownText('2020-03-14', at(2026, 3, 13)), '¡Mañana es nuestro aniversario!');
});

test('ambient countdown on the day shows the years together, singular for 1', () => {
  assert.equal(core.daysUntil('2020-03-14', at(2026, 3, 14, 0, 0)), 0);
  assert.equal(core.yearsTogether('2020-03-14', at(2026, 3, 14)), 6);
  assert.equal(core.countdownText('2020-03-14', at(2026, 3, 14)), '¡Hoy es nuestro aniversario! · 6 años juntos');
  assert.equal(core.countdownText('2020-03-14', at(2026, 3, 14, 23, 59)), '¡Hoy es nuestro aniversario! · 6 años juntos');
  assert.equal(core.countdownText('2025-03-14', at(2026, 3, 14)), '¡Hoy es nuestro aniversario! · 1 año juntos');
  // The very first day (or a date still ahead) has no years yet.
  assert.equal(core.countdownText('2026-03-14', at(2026, 3, 14)), '¡Hoy es nuestro aniversario!');
});

test('ambient countdown without a valid date is empty, so only the clock shows', () => {
  for (const bad of [null, undefined, '', 'x', '2020-02-30', '2021-02-29', '2020-13-01', '2020-3-14', 20200314]) {
    assert.equal(core.countdownText(bad, at(2026, 3, 1)), '', String(bad));
    assert.equal(core.daysUntil(bad, at(2026, 3, 1)), null, String(bad));
    assert.equal(core.parseIsoDate(bad), null, String(bad));
  }
  assert.deepEqual(core.parseIsoDate('2020-02-29'), { year: 2020, month: 2, day: 29 });
});

test('a Feb 29 anniversary falls on Feb 28 in non-leap years', () => {
  assert.equal(core.anniversaryDay(2, 29, 2027), 28);
  assert.equal(core.anniversaryDay(2, 29, 2028), 29);
  assert.equal(core.anniversaryDay(2, 29, 2100), 28);
  assert.equal(core.anniversaryDay(2, 29, 2000), 29);
  assert.equal(core.anniversaryDay(3, 14, 2027), 14);
  assert.equal(core.countdownText('2020-02-29', at(2027, 2, 27)), '¡Mañana es nuestro aniversario!');
  assert.equal(core.countdownText('2020-02-29', at(2027, 2, 28)), '¡Hoy es nuestro aniversario! · 7 años juntos');
  assert.equal(core.countdownText('2020-02-29', at(2028, 2, 28)), '¡Mañana es nuestro aniversario!');
  assert.equal(core.countdownText('2020-02-29', at(2028, 2, 29)), '¡Hoy es nuestro aniversario! · 8 años juntos');
  // Right after it, the next one is Feb 29 2028.
  assert.equal(core.daysUntil('2020-02-29', at(2027, 3, 1)), 365);
});

test('ambient countdown crosses the year boundary', () => {
  assert.equal(core.countdownText('2019-01-01', at(2026, 12, 30)), 'Faltan 2 días para nuestro aniversario');
  assert.equal(core.countdownText('2019-01-01', at(2026, 12, 31, 23, 59)), '¡Mañana es nuestro aniversario!');
  assert.equal(core.countdownText('2019-01-01', at(2027, 1, 1, 0, 0)), '¡Hoy es nuestro aniversario! · 8 años juntos');
  assert.equal(core.countdownText('2019-12-31', at(2027, 1, 1)), 'Faltan 364 días para nuestro aniversario');
});

test('the ambient clock is HH:MM in 24 h, no seconds', () => {
  assert.equal(core.clockText(new Date(2026, 0, 1, 9, 5, 59)), '09:05');
  assert.equal(core.clockText(new Date(2026, 0, 1, 0, 0)), '00:00');
  assert.equal(core.clockText(new Date(2026, 0, 1, 23, 59)), '23:59');
  assert.equal(core.clockText(new Date(2026, 0, 1, 13, 30)), '13:30');
});

test('ambient shows after 60 s without activity and only while nothing plays', () => {
  assert.equal(core.ambientDue('idle', false, 100_000, 159_999), false);
  assert.equal(core.ambientDue('idle', false, 100_000, 160_000), true);
  assert.equal(core.ambientDue('error', false, 100_000, 160_000), true);
  assert.equal(core.ambientDue('video', true, 100_000, 160_000), true);
  assert.equal(core.ambientDue('video', false, 100_000, 900_000), false);
  assert.equal(core.ambientDue('loading', false, 100_000, 900_000), false);
  // Any activity (a command, a video starting or ending) restarts the 60 s.
  assert.equal(core.ambientDue('idle', false, 150_000, 160_000), false);
});

test('the ambient content drifts slowly within a small area against burn-in', () => {
  const seen = new Set<string>();
  let previous = core.driftOffset(0);
  for (let t = 1000; t <= 3_600_000; t += 1000) {
    const offset = core.driftOffset(t);
    assert.ok(Math.abs(offset.x) <= 60 && Math.abs(offset.y) <= 40, JSON.stringify(offset));
    assert.ok(Math.abs(offset.x - previous.x) <= 1 && Math.abs(offset.y - previous.y) <= 1, `jump at ${t}`);
    seen.add(`${offset.x},${offset.y}`);
    previous = offset;
  }
  assert.ok(seen.size > 100, `only ${seen.size} positions in an hour`);
});

const AMBIENT = buildReceiverPage({ key: 'aB3dE9', phoneName: 'MayLo de Marcos', anniversary: '2020-03-14' });

/** The ANNIVERSARY value the page script runs with. */
function anniversaryOf(html: string): unknown {
  const body = scripts(html)[0];
  return new Function(`${body.split('var MayloCore')[0]}\nreturn ANNIVERSARY;`)();
}

test('the anniversary date is inlined as script data; a missing or bad one is null', () => {
  assert.equal(anniversaryOf(AMBIENT), '2020-03-14');
  assert.equal(anniversaryOf(PAGE), null);
  assert.equal(anniversaryOf(buildReceiverPage({ key: 'aB3dE9', phoneName: '', anniversary: null })), null);
  for (const bad of ['2020-02-30', '</script><script>alert(1)', '14/03/2020']) {
    const html = buildReceiverPage({ key: 'aB3dE9', phoneName: '', anniversary: bad });
    assert.equal(anniversaryOf(html), null, bad);
    assert.doesNotMatch(html, /alert\(1\)/);
  }
});

test('the page has the ambient screen wired to the core helpers, ES5 and self-contained', () => {
  assert.match(AMBIENT, /<div id="ambient"/);
  assert.match(AMBIENT, /id="ambient-clock"/);
  assert.match(AMBIENT, /id="ambient-count"/);
  assert.match(AMBIENT, /core\.ambientDue\(mode, video\.ended, activityAt, /);
  assert.match(AMBIENT, /core\.countdownText\(ANNIVERSARY, /);
  assert.match(AMBIENT, /core\.clockText\(/);
  assert.match(AMBIENT, /core\.driftOffset\(/);
  assert.doesNotMatch(AMBIENT, /https?:\/\//i);
  assert.ok(AMBIENT.length < 30000, `page is ${AMBIENT.length} bytes`);
  for (const body of scripts(AMBIENT)) {
    assert.doesNotMatch(body, /=>|`|\?\.|\?\?|\b(?:let|const|class|async|await)\s/);
    assert.doesNotThrow(() => new Function(body));
  }
});

test('state is posted as text/plain so another phone gets it without a preflight', () => {
  assert.match(PAGE, /setRequestHeader\('Content-Type', 'text\/plain'\)/);
  assert.doesNotMatch(PAGE, /application\/json/);
});

/* YouTube (S3): the load command carries its playlists; hls.js reads them through a custom loader. */

test('a load with playlists hands them to the player; invalid ones are left out', () => {
  const { player, calls } = fakePlayer();
  const url = 'http://192.168.0.249:8765/s/t/VID/master.m3u8';
  const playlists = { [url]: '#EXTM3U\n' };
  assert.equal(core.applyCommand(player, { type: 'load', url, title: 'Peli', playlists }), true);
  assert.equal(core.applyCommand(player, { type: 'load', url, title: 'Peli', playlists: 'x' }), true);
  assert.equal(core.applyCommand(player, { type: 'load', url, title: 'Peli', playlists: ['#EXTM3U'] }), true);
  assert.deepEqual(calls, [
    ['load', url, 'Peli', playlists],
    ['load', url, 'Peli'],
    ['load', url, 'Peli'],
  ]);
});

type Callbacks = { onSuccess: (response: unknown, stats: unknown, context: unknown, details: unknown) => void };
type LoaderInstance = {
  stats: { loaded: number; total: number; loading: { start: number; first: number; end: number } };
  load: (context: { url: string }, config: unknown, callbacks: Callbacks) => void;
  abort: () => void;
  destroy: () => void;
};

test('the playlist loader answers known playlist URLs from memory and passes the rest to hls.js', async () => {
  const log: unknown[] = [];
  function Base(this: Record<string, unknown>, config: unknown) {
    log.push(['new', config]);
    this.stats = { loaded: 0, total: 0, loading: { start: 0, first: 0, end: 0 } };
    this.load = (context: { url: string }) => log.push(['load', context.url]);
    this.abort = () => log.push(['abort']);
    this.destroy = () => log.push(['destroy']);
  }
  const url = 'http://192.168.0.249:8765/s/t/VID/index.m3u8';
  const Loader = core.playlistLoader(Base, { [url]: '#EXTM3U\n#EXT-X-ENDLIST\n' }) as unknown as new (config: unknown) => LoaderInstance;
  const loader = new Loader({ timeout: 1 });
  const answers: unknown[] = [];
  const context = { url };
  loader.load(context, {}, { onSuccess: (response, stats, ctx) => answers.push([response, stats, ctx]) });
  assert.deepEqual(answers, [], 'answered asynchronously, like a request');
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(answers.length, 1);
  const [response, stats, ctx] = answers[0] as [{ url: string; data: string }, LoaderInstance['stats'], unknown];
  assert.deepEqual(response, { url, data: '#EXTM3U\n#EXT-X-ENDLIST\n' });
  assert.equal(ctx, context);
  assert.equal(stats, loader.stats);
  assert.equal(stats.loaded, 23);
  assert.equal(stats.total, 23);
  assert.ok(stats.loading.end >= stats.loading.start && stats.loading.start > 0);
  loader.load({ url: 'http://192.168.0.249:8765/s/t/VID/x.mp4' }, {}, { onSuccess: () => answers.push('no') });
  loader.abort();
  loader.destroy();
  assert.deepEqual(log, [['new', { timeout: 1 }], ['load', 'http://192.168.0.249:8765/s/t/VID/x.mp4'], ['abort'], ['destroy']]);
});

test('a YouTube load (S2v): the inline master is answered from memory, its proxied media playlists go to the network', async () => {
  const requested: string[] = [];
  function Base(this: Record<string, unknown>) {
    this.stats = { loaded: 0, total: 0, loading: { start: 0, first: 0, end: 0 } };
    this.load = (context: { url: string }) => requested.push(context.url);
    this.abort = () => {};
    this.destroy = () => {};
  }
  const video = 'http://192.168.0.249:8765/s/t/VIDEO/x.m3u8';
  const audio = 'http://192.168.0.249:8765/s/t/AUDIO/x.m3u8';
  const load = youtubeLoad(
    { video: { uri: 'https://v', bandwidth: 1, codecs: 'avc1.640028,mp4a.40.2', audioGroup: '234' }, audio: { uri: 'https://a', name: 'Default' } },
    [video, audio],
  );
  const Loader = core.playlistLoader(Base, load.playlists) as unknown as new (config: unknown) => LoaderInstance;
  const loader = new Loader({});
  const answers: { url: string; data: string }[] = [];
  for (const url of [load.url, video, audio]) {
    loader.load({ url }, {}, { onSuccess: (response) => answers.push(response as { url: string; data: string }) });
  }
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(answers, [{ url: load.url, data: load.playlists[load.url] }]);
  assert.deepEqual(requested, [video, audio]);
  assert.equal(core.isHls(load.url), true);
});

test('the page gives hls.js the playlist loader only for loads that carry playlists', () => {
  assert.match(PAGE, /load: function \(url, nextTitle, lists\)/);
  assert.match(PAGE, /if \(lists\) config\.pLoader = core\.playlistLoader\(Hls\.DefaultConfig\.loader, lists\);/);
});

/* S6: long playback survives — bounded buffers, recovery before the error screen, error details. */

test('every HLS load gets bounded TV buffers (hls.js keeps all played video by default)', () => {
  assert.deepEqual(core.hlsConfig(), { backBufferLength: 10, maxBufferLength: 30, maxMaxBufferLength: 60, maxBufferSize: 30e6 });
  // A fresh object each load, so the YouTube pLoader never leaks into the next load.
  assert.notEqual(core.hlsConfig(), core.hlsConfig());
  assert.match(PAGE, /var config = core\.hlsConfig\(\);/);
  assert.match(PAGE, /hls = new Hls\(config\);/);
});

const fatal = (type: string, details: string, extra: Record<string, unknown> = {}) => ({ type, details, fatal: true, ...extra });

test('a non-fatal hls.js error needs nothing and spends no budget', () => {
  const past: unknown[] = [];
  assert.equal(core.recovery({ type: 'mediaError', details: 'bufferFullError', fatal: false }, past, 1000), 'none');
  assert.equal(core.recovery({ type: 'networkError', details: 'fragLoadError' }, past, 1000), 'none');
  assert.deepEqual(past, []);
});

test('a fatal network error reloads from the current position; manifest failures fail at once', () => {
  const past: unknown[] = [];
  assert.equal(core.recovery(fatal('networkError', 'fragLoadError', { response: { code: 0 } }), past, 1000), 'network');
  assert.equal(core.recovery(fatal('networkError', 'levelLoadTimeOut'), past, 2000), 'network');
  assert.equal(past.length, 2);
  for (const details of ['manifestLoadError', 'manifestLoadTimeOut', 'manifestParsingError']) {
    assert.equal(core.recovery(fatal('networkError', details), [], 1000), 'fail', details);
  }
});

test('a fatal network error with a client HTTP status (403 past the PO-token cap) fails fast without spending budget', () => {
  for (const code of [400, 401, 403, 404, 410]) {
    const past: unknown[] = [];
    assert.equal(core.recovery(fatal('networkError', 'fragLoadError', { response: { code } }), past, 1000), 'fail', String(code));
    assert.deepEqual(past, [], String(code));
  }
  // Timeouts, throttling and server errors are transient: retried.
  for (const code of [408, 429, 500, 503]) {
    assert.equal(core.recovery(fatal('networkError', 'fragLoadError', { response: { code } }), [], 1000), 'network', String(code));
  }
});

test('a fatal media error recovers, then swaps the audio codec, then gives up', () => {
  const past: unknown[] = [];
  assert.equal(core.recovery(fatal('mediaError', 'bufferAppendError'), past, 1000), 'media');
  assert.equal(core.recovery(fatal('mediaError', 'mediaSourceRequiresReset'), past, 5000), 'swap');
  assert.equal(core.recovery(fatal('mediaError', 'bufferAppendError'), past, 9000), 'fail');
  // A media error a minute after the last one starts over.
  const later: unknown[] = [];
  assert.equal(core.recovery(fatal('mediaError', 'bufferAppendError'), later, 1000), 'media');
  assert.equal(core.recovery(fatal('mediaError', 'bufferAppendError'), later, 61_000), 'media');
});

test('at most 3 recoveries per 60 s, then the error screen', () => {
  const past: unknown[] = [];
  const error = fatal('networkError', 'fragLoadTimeOut');
  assert.deepEqual([1000, 2000, 3000, 4000].map((now) => core.recovery(error, past, now)), ['network', 'network', 'network', 'fail']);
  assert.equal(past.length, 3);
  assert.equal(core.recovery(error, past, 60_999), 'fail');
  assert.equal(core.recovery(error, past, 61_000), 'network');
  // Network recoveries count for the budget, not for the media ladder.
  assert.equal(core.recovery(fatal('mediaError', 'bufferAppendError'), past, 63_500), 'media');
  assert.equal(core.recovery(fatal('mediaError', 'bufferAppendError'), past, 63_600), 'swap');
  assert.equal(core.recovery(error, past, 63_700), 'fail');
});

test('other fatal errors (key system, mux, other) go to the error screen', () => {
  for (const type of ['keySystemError', 'muxError', 'otherError', undefined]) {
    assert.equal(core.recovery(fatal(String(type), 'x'), [], 1000), 'fail', String(type));
  }
});

test('the last hls.js error is reported with type, details, HTTP status and stream', () => {
  assert.deepEqual(
    core.errorInfo({ type: 'networkError', details: 'fragLoadError', fatal: true, response: { code: 403, text: 'x' }, frag: { type: 'audio' } }),
    { type: 'networkError', details: 'fragLoadError', code: 403, stream: 'audio', fatal: true },
  );
  // hls.js names the video+audio main stream "main".
  assert.deepEqual(core.errorInfo({ type: 'networkError', details: 'fragLoadError', fatal: true, response: { code: 403 }, frag: { type: 'main' } }), {
    type: 'networkError',
    details: 'fragLoadError',
    code: 403,
    stream: 'video',
    fatal: true,
  });
  assert.deepEqual(core.errorInfo({ type: 'mediaError', details: 'bufferAppendError', sourceBufferName: 'audio', frag: { type: 'main' }, fatal: false }), {
    type: 'mediaError',
    details: 'bufferAppendError',
    code: null,
    stream: 'audio',
    fatal: false,
  });
  assert.deepEqual(core.errorInfo({ type: 'networkError', details: 'levelLoadError', fatal: true, response: { code: 0 }, context: { type: 'audioTrack' } }), {
    type: 'networkError',
    details: 'levelLoadError',
    code: null,
    stream: 'audioTrack',
    fatal: true,
  });
  assert.deepEqual(core.errorInfo({}), { type: '', details: '', code: null, stream: '', fatal: false });
});

test('the reported state carries the last hls.js error only when there is one', () => {
  const video = { currentTime: 15, duration: 600, paused: false, ended: false, volume: 1, muted: false };
  const detail = { type: 'networkError', details: 'fragLoadError', code: 403, stream: 'video', fatal: true };
  const failed = core.snapshot(video, { mode: 'error', error: 'No se pudo reproducir este video', title: 'Peli', detail } as never) as Record<string, unknown>;
  assert.deepEqual(failed.detail, detail);
  assert.equal(failed.status, 'error');
  assert.equal('detail' in (core.snapshot(video, { mode: 'video', error: null, title: 'Peli' }) as object), false);
  assert.equal('detail' in (core.snapshot(video, { mode: 'video', error: null, title: 'Peli', detail: null } as never) as object), false);
});

test('the page runs the recovery on hls.js errors of its own load and reports the last one', () => {
  assert.match(PAGE, /if \(mine !== token \|\| !data\) return;\s*lastError = core\.errorInfo\(data\);\s*recover\(data\);/);
  assert.match(PAGE, /core\.recovery\(data, recoveries, new Date\(\)\.getTime\(\)\)/);
  assert.match(PAGE, /hls\.startLoad\(video\.currentTime\)/);
  assert.match(PAGE, /hls\.swapAudioCodec\(\)/);
  assert.match(PAGE, /hls\.recoverMediaError\(\)/);
  assert.match(PAGE, /detail: lastError \}\)/);
});
