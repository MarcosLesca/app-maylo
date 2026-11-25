import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  addCandidate,
  castErrorMessage,
  castHeaders,
  foundLabel,
  addPlayerFrame,
  parseDetectorMessage,
  parsePageMessage,
  parsePlayerFrameMessage,
  playerFrameToOpen,
  samePage,
  videoKindLabel,
  type VideoCandidate,
} from './candidates.ts';

const MESSAGE = {
  type: 'maylo-video',
  url: 'https://cdn.example.com/movie.mp4',
  pageUrl: 'https://player.example.com/embed/1',
  title: 'Night of the Living Dead (1968)',
  userAgent: 'Mozilla/5.0 (Linux; Android 14)',
  cookie: 'a=1; b=2',
};

const candidate = (url: string): VideoCandidate => ({ ...MESSAGE, url, type: undefined } as unknown as VideoCandidate);

test('a detector message becomes a candidate with URL, referer page, title, user agent and cookie', () => {
  assert.deepEqual(parseDetectorMessage(JSON.stringify(MESSAGE)), {
    url: MESSAGE.url,
    pageUrl: MESSAGE.pageUrl,
    title: MESSAGE.title,
    userAgent: MESSAGE.userAgent,
    cookie: MESSAGE.cookie,
  });
});

test('messages that are not detector candidates are ignored', () => {
  assert.equal(parseDetectorMessage('not json'), null);
  assert.equal(parseDetectorMessage(JSON.stringify({ type: 'other', url: MESSAGE.url })), null);
  assert.equal(parseDetectorMessage(JSON.stringify({ ...MESSAGE, url: 'blob:https://x/123' })), null);
  assert.equal(parseDetectorMessage(JSON.stringify({ ...MESSAGE, url: 'data:video/mp4;base64,AA' })), null);
  assert.equal(parseDetectorMessage(JSON.stringify({ ...MESSAGE, url: 42 })), null);
});

test('missing optional fields default to empty strings', () => {
  const parsed = parseDetectorMessage(JSON.stringify({ type: 'maylo-video', url: MESSAGE.url }));
  assert.deepEqual(parsed, { url: MESSAGE.url, pageUrl: '', title: '', userAgent: '', cookie: '' });
});

test('candidates are deduplicated by URL and keep detection order', () => {
  const first = candidate('https://cdn.example.com/master.m3u8');
  const second = candidate('https://cdn.example.com/movie.mp4');
  let list = addCandidate([], first);
  list = addCandidate(list, second);
  const again = addCandidate(list, { ...first, title: 'otro' });
  assert.equal(again, list, 'a repeated URL leaves the list unchanged');
  assert.deepEqual(list.map((c) => c.url), [first.url, second.url]);
});

test('the kind label follows the URL path', () => {
  assert.equal(videoKindLabel('https://x/a/movie.mp4?token=1'), 'Video MP4');
  assert.equal(videoKindLabel('https://x/a/index.M3U8#t=2'), 'Video HLS');
  assert.equal(videoKindLabel('https://x/a/clip.webm'), 'Video WebM');
  assert.equal(videoKindLabel('https://x/a/clip.mkv'), 'Video MKV');
  assert.equal(videoKindLabel('https://x/stream?id=7'), 'Video MP4');
});

test('the found label is singular for one and plural otherwise', () => {
  assert.equal(foundLabel(1), '1 encontrado en la página');
  assert.equal(foundLabel(3), '3 encontrados en la página');
});

test('cast headers carry the page as Referer plus User-Agent and Cookie, skipping empty ones', () => {
  assert.deepEqual(castHeaders(candidate(MESSAGE.url)), {
    Referer: MESSAGE.pageUrl,
    'User-Agent': MESSAGE.userAgent,
    Cookie: MESSAGE.cookie,
  });
  assert.deepEqual(castHeaders({ ...candidate(MESSAGE.url), cookie: '', userAgent: '' }), { Referer: MESSAGE.pageUrl });
});

test('the same page ignores the fragment, a different path is a new page', () => {
  assert.equal(samePage('https://a.com/x#one', 'https://a.com/x#two'), true);
  assert.equal(samePage('https://a.com/x', 'https://a.com/y'), false);
  assert.equal(samePage('', 'https://a.com/x'), false);
});

const FRAME = {
  type: 'maylo-frame',
  url: 'https://player.other.net/embed/9',
  pageUrl: 'https://movies.example.com/watch/7',
  width: 640,
  height: 360,
};

test('an iframe message becomes a player frame; anything else is ignored', () => {
  assert.deepEqual(parsePlayerFrameMessage(JSON.stringify(FRAME)), {
    url: FRAME.url,
    pageUrl: FRAME.pageUrl,
    area: 640 * 360,
  });
  assert.equal(parsePlayerFrameMessage(JSON.stringify(MESSAGE)), null);
  assert.equal(parsePlayerFrameMessage('nope'), null);
  assert.equal(parsePlayerFrameMessage(JSON.stringify({ ...FRAME, url: 'about:blank' })), null);
  assert.equal(parsePlayerFrameMessage(JSON.stringify({ ...FRAME, url: 'javascript:alert(1)' })), null);
  assert.equal(parsePlayerFrameMessage(JSON.stringify({ ...FRAME, width: 199 })), null);
  assert.equal(parsePlayerFrameMessage(JSON.stringify({ ...FRAME, height: 119 })), null);
  assert.equal(parsePlayerFrameMessage(JSON.stringify({ ...FRAME, width: '640' })), null);
  assert.equal(parseDetectorMessage(JSON.stringify(FRAME)), null, 'a frame is not a video candidate');
});

test('player frames are deduplicated by URL; the largest one that is not the page itself is offered', () => {
  const big = parsePlayerFrameMessage(JSON.stringify(FRAME))!;
  const small = parsePlayerFrameMessage(JSON.stringify({ ...FRAME, url: 'https://p.net/b', width: 300, height: 200 }))!;
  const self = parsePlayerFrameMessage(
    JSON.stringify({ ...FRAME, url: 'https://movies.example.com/watch/7#x', width: 1000, height: 1000 }),
  )!;
  let frames = addPlayerFrame([], small);
  frames = addPlayerFrame(frames, big);
  assert.equal(addPlayerFrame(frames, { ...big, area: 1 }), frames);
  frames = addPlayerFrame(frames, self);
  assert.equal(playerFrameToOpen(frames, 'https://movies.example.com/watch/7'), big);
  assert.equal(playerFrameToOpen([], 'https://movies.example.com/watch/7'), null);
  assert.equal(playerFrameToOpen([self], 'https://movies.example.com/watch/7'), null);
});

test('cast errors are explained in plain Spanish', () => {
  assert.equal(
    castErrorMessage(new Error('la TV no respondió en 10 s')),
    'La tele no respondió. Revisá que esté prendida y en el mismo Wi-Fi.',
  );
  assert.equal(
    castErrorMessage(new Error('SetAVTransportURI falló (HTTP 500, UPnP 714: Illegal MIME-type)')),
    'La tele no pudo abrir este video. Probá con otro o usá “Duplicar la pantalla”.',
  );
  assert.equal(
    castErrorMessage(new TypeError('Network request failed')),
    'No se pudo hablar con la tele. Revisá que el teléfono esté en el mismo Wi-Fi.',
  );
  assert.equal(castErrorMessage('boom'), 'Algo salió mal al mandar el video a la tele. Probá de nuevo.');
});

test('page messages (SPA navigation) carry the top page URL and title', () => {
  assert.deepEqual(parsePageMessage(JSON.stringify({ type: 'maylo-page', url: 'https://m.youtube.com/watch?v=aqz-KE-bpKQ', title: 'Big Buck Bunny - YouTube' })), {
    url: 'https://m.youtube.com/watch?v=aqz-KE-bpKQ',
    title: 'Big Buck Bunny - YouTube',
  });
  assert.deepEqual(parsePageMessage(JSON.stringify({ type: 'maylo-page', url: 'https://a.com/x' })), { url: 'https://a.com/x', title: '' });
  for (const bad of ['x', '{}', JSON.stringify({ type: 'maylo-page', url: 'javascript:1', title: '' }), JSON.stringify({ type: 'maylo-video', url: 'https://a.com/x' })]) {
    assert.equal(parsePageMessage(bad), null, bad);
  }
});

test('YouTube errors reach the user as they are', () => {
  for (const message of [
    'YouTube solo se puede ver con el navegador de la tele.',
    'Los videos en vivo de YouTube no se pueden pasar a la tele.',
    'No se pudo preparar el video de YouTube para la tele. Probá de nuevo en un rato.',
  ]) {
    assert.equal(castErrorMessage(new Error(message)), message);
  }
});
