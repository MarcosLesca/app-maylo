import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MAX_EXTRA_TARGETS,
  base64UrlEncode,
  extraTargetsValid,
  isHlsPlaylist,
  proxyUrl,
  rewritePlaylist,
  sessionProxyUrls,
  suffixFor,
} from './hls.ts';

const BASE = 'http://192.168.1.20:41234/s/abc123';
const wrap = (target: string) => `${BASE}/${Buffer.from(target, 'utf8').toString('base64url')}${suffixFor(target)}`;

test('targets are base64url-encoded as UTF-8 without padding', () => {
  for (const text of ['https://a.com/x?y=1&z=2', 'https://a.com/peli-ñandú.mp4', 'a', 'ab', 'https://x.io/🎬.m3u8']) {
    assert.equal(base64UrlEncode(text), Buffer.from(text, 'utf8').toString('base64url'));
  }
});

test('the file-like suffix comes from the target path extension, ignoring query and case', () => {
  assert.equal(suffixFor('https://cdn.x/a/master.m3u8?token=1'), '/x.m3u8');
  assert.equal(suffixFor('https://cdn.x/seg/00001.TS#t'), '/x.ts');
  assert.equal(suffixFor('https://cdn.x/video.mp4'), '/x.mp4');
  assert.equal(suffixFor('https://cdn.x/play?id=7.mp4'), '');
  assert.equal(suffixFor('https://cdn.x/a.dir/stream'), '');
  assert.equal(suffixFor('https://cdn.x/file.toolongext'), '');
});

test('proxy URLs carry the session base, the encoded target and the suffix', () => {
  const target = 'https://cdn.x/a/master.m3u8?t=1';
  assert.equal(proxyUrl(BASE, target), `${BASE}/${base64UrlEncode(target)}/x.m3u8`);
  assert.equal(proxyUrl(BASE, target, '/x.mp4'), `${BASE}/${base64UrlEncode(target)}/x.mp4`);
  assert.equal(proxyUrl(BASE, 'https://cdn.x/stream'), `${BASE}/${base64UrlEncode('https://cdn.x/stream')}`);
});

test('a response is an HLS playlist by content type, by path, or by its first bytes', () => {
  assert.equal(isHlsPlaylist('application/vnd.apple.mpegurl', 'https://x/a', ''), true);
  assert.equal(isHlsPlaylist('audio/x-mpegURL; charset=utf-8', 'https://x/a', ''), true);
  assert.equal(isHlsPlaylist('application/octet-stream', 'https://x/live/index.M3U8?k=1', ''), true);
  assert.equal(isHlsPlaylist('text/plain', 'https://x/a', '\uFEFF #EXTM3U\n#EXT-X-VERSION:3'), true);
  assert.equal(isHlsPlaylist('video/mp4', 'https://x/a.mp4', '\u0000\u0000\u0000 ftyp'), false);
  assert.equal(isHlsPlaylist('', 'https://x/m3u8/video.mp4', ''), false);
});

test('a master playlist wraps every variant and every URI attribute, resolved against the playlist URL', () => {
  const playlistUrl = 'https://cdn.example.com/hls/movie/master.m3u8?sig=9';
  const body = [
    '#EXTM3U',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Español",URI="audio/es.m3u8"',
    '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,AUDIO="aud"',
    '360p/index.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=2400000',
    'https://other.cdn.net/720p/index.m3u8?x=1',
    '#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=100000,URI="iframes.m3u8"',
    '',
  ].join('\n');
  assert.equal(
    rewritePlaylist(body, playlistUrl, BASE),
    [
      '#EXTM3U',
      `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Español",URI="${wrap('https://cdn.example.com/hls/movie/audio/es.m3u8')}"`,
      '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,AUDIO="aud"',
      wrap('https://cdn.example.com/hls/movie/360p/index.m3u8'),
      '#EXT-X-STREAM-INF:BANDWIDTH=2400000',
      wrap('https://other.cdn.net/720p/index.m3u8?x=1'),
      `#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=100000,URI="${wrap('https://cdn.example.com/hls/movie/iframes.m3u8')}"`,
      '',
    ].join('\n'),
  );
});

test('a media playlist wraps segments, keys and init maps with relative, root and scheme-relative paths', () => {
  const playlistUrl = 'https://edge.cdn.io/v/1080/index.m3u8';
  const body = [
    '\uFEFF#EXTM3U',
    '#EXT-X-TARGETDURATION:6',
    '#EXT-X-KEY:METHOD=AES-128,URI="key.bin?k=1",IV=0x1234',
    '#EXT-X-MAP:URI="/init/init.mp4"',
    '#EXTINF:6.0,',
    '  ../seg/0001.ts  ',
    '#EXTINF:6.0,',
    '//mirror.cdn.io/seg/0002.ts',
    '# a comment mentioning URI="nothing.ts"',
    '#EXT-X-ENDLIST',
  ].join('\r\n');
  assert.equal(
    rewritePlaylist(body, playlistUrl, BASE),
    [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:6',
      `#EXT-X-KEY:METHOD=AES-128,URI="${wrap('https://edge.cdn.io/v/1080/key.bin?k=1')}",IV=0x1234`,
      `#EXT-X-MAP:URI="${wrap('https://edge.cdn.io/init/init.mp4')}"`,
      '#EXTINF:6.0,',
      wrap('https://edge.cdn.io/v/seg/0001.ts'),
      '#EXTINF:6.0,',
      wrap('https://mirror.cdn.io/seg/0002.ts'),
      '# a comment mentioning URI="nothing.ts"',
      '#EXT-X-ENDLIST',
    ].join('\n'),
  );
});

test('rewrites MEDIA/KEY/MAP and nested variants, keeps skd:/data:', () => {
  const out = rewritePlaylist('#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI="//cdn.x/a.m3u8"\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://abc"\n#EXT-X-KEY:METHOD=AES-128,URI="data:text/plain;base64,AAA"\n#EXT-X-MAP:URI="../init.mp4"\nlow/index.m3u8\n',
    'https://h.com/a/b/master.m3u8', 'http://p:1/s/t');
  assert.match(out, /URI="http:\/\/p:1\/s\/t\/[\w-]+\/x\.m3u8"/);
  assert.match(out, /URI="skd:\/\/abc"/);
  assert.match(out, /URI="data:text\/plain;base64,AAA"/);
  assert.ok(out.includes(`/s/t/${base64UrlEncode('https://h.com/a/init.mp4')}/x.mp4`));
  assert.ok(out.includes(`/s/t/${base64UrlEncode('https://h.com/a/b/low/index.m3u8')}/x.m3u8`));
});

test('every absolute target the rewrite emits is reported once per URI, in order, for the session allow-set', () => {
  const emitted: string[] = [];
  rewritePlaylist(
    '#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://abc"\n#EXT-X-MAP:URI="../init.mp4"\n# URI="c.ts"\nseg1.ts\nhttps://o.net/seg2.ts\n',
    'https://h.com/a/b/index.m3u8',
    'http://p:1/s/t',
    (target) => emitted.push(target),
  );
  assert.deepEqual(emitted, ['https://h.com/a/init.mp4', 'https://h.com/a/b/seg1.ts', 'https://o.net/seg2.ts']);
});

test('URIs that are not http(s) after resolving are left untouched', () => {
  const body = [
    '#EXTM3U',
    '#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://key-id-1"',
    '#EXT-X-KEY:METHOD=AES-128,URI="data:text/plain;base64,AAAA"',
    '#EXTINF:4,',
    'seg.ts',
  ].join('\n');
  assert.equal(
    rewritePlaylist(body, 'http://plain.host/live/a.m3u8', BASE),
    [
      '#EXTM3U',
      '#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://key-id-1"',
      '#EXT-X-KEY:METHOD=AES-128,URI="data:text/plain;base64,AAAA"',
      '#EXTINF:4,',
      wrap('http://plain.host/live/seg.ts'),
    ].join('\n'),
  );
});

test('a session may also allow at most 4 extra exact http(s) targets (S5, YouTube video + audio)', () => {
  assert.equal(MAX_EXTRA_TARGETS, 4);
  assert.equal(extraTargetsValid([]), true);
  assert.equal(extraTargetsValid(['https://rr1.googlevideo.com/videoplayback?itag=140']), true);
  assert.equal(extraTargetsValid(['http://a/1', 'https://a/2', 'https://a/3', 'https://a/4']), true);
  assert.equal(extraTargetsValid(['http://a/1', 'https://a/2', 'https://a/3', 'https://a/4', 'https://a/5']), false);
  for (const bad of ['ftp://a/1', 'file:///etc/passwd', 'javascript:alert(1)', '', 'HTTPS://a/1', ' https://a/1']) {
    assert.equal(extraTargetsValid([bad]), false, bad);
  }
});

test('every target of one session gets its proxy URL under the same session base', () => {
  const targets = ['https://rr1.googlevideo.com/videoplayback?itag=299', 'https://rr1.googlevideo.com/videoplayback?itag=140'];
  assert.deepEqual(sessionProxyUrls('http://192.168.1.20:8765', 'abc123', targets, '/x.mp4'), [
    `http://192.168.1.20:8765/s/abc123/${base64UrlEncode(targets[0])}/x.mp4`,
    `http://192.168.1.20:8765/s/abc123/${base64UrlEncode(targets[1])}/x.mp4`,
  ]);
});
