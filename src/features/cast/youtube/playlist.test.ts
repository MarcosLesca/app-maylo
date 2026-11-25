import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildMasterPlaylist, buildMediaPlaylist, youtubeLoad } from './playlist.ts';

const VIDEO = 'http://192.168.1.5:8765/s/tok/aHR0cHM6Ly92aWRlbw';

test('buildMediaPlaylist maps the init range to EXT-X-MAP and every sidx segment to a byte range', () => {
  const text = buildMediaPlaylist({
    uri: VIDEO,
    initRange: { start: 0, end: 738 },
    segments: [
      { start: 807, end: 1806, duration: 5.005 },
      { start: 1807, end: 3806, duration: 5.0049999 },
      { start: 3807, end: 4306, duration: 2.5 },
    ],
  });
  assert.equal(
    text,
    [
      '#EXTM3U',
      '#EXT-X-VERSION:7',
      '#EXT-X-TARGETDURATION:6',
      '#EXT-X-MEDIA-SEQUENCE:0',
      '#EXT-X-PLAYLIST-TYPE:VOD',
      '#EXT-X-INDEPENDENT-SEGMENTS',
      `#EXT-X-MAP:URI="${VIDEO}",BYTERANGE="739@0"`,
      '#EXTINF:5.005,',
      '#EXT-X-BYTERANGE:1000@807',
      VIDEO,
      '#EXTINF:5.005,',
      '#EXT-X-BYTERANGE:2000@1807',
      VIDEO,
      '#EXTINF:2.500,',
      '#EXT-X-BYTERANGE:500@3807',
      VIDEO,
      '#EXT-X-ENDLIST',
      '',
    ].join('\n'),
  );
});

test('buildMediaPlaylist rounds the target duration up to whole seconds', () => {
  const text = buildMediaPlaylist({
    uri: VIDEO,
    initRange: { start: 0, end: 9 },
    segments: [{ start: 10, end: 19, duration: 10 }, { start: 20, end: 29, duration: 10.4 }],
  });
  assert.match(text, /^#EXT-X-TARGETDURATION:11$/m);
});

test('buildMasterPlaylist offers the video variant with its AAC audio rendition', () => {
  const text = buildMasterPlaylist({
    video: { uri: 'video.m3u8', codecs: 'avc1.64002a', bitrate: 6_000_000, width: 1920, height: 1080, frameRate: 59.94 },
    audio: { uri: 'audio.m3u8', codecs: 'mp4a.40.2', bitrate: 130_000 },
  });
  assert.equal(
    text,
    [
      '#EXTM3U',
      '#EXT-X-VERSION:7',
      '#EXT-X-INDEPENDENT-SEGMENTS',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Audio",DEFAULT=YES,AUTOSELECT=YES,URI="audio.m3u8"',
      '#EXT-X-STREAM-INF:BANDWIDTH=6130000,CODECS="avc1.64002a,mp4a.40.2",RESOLUTION=1920x1080,FRAME-RATE=59.940,AUDIO="audio"',
      'video.m3u8',
      '',
    ].join('\n'),
  );
});

test('buildMasterPlaylist leaves out the size and frame rate when YouTube does not give them', () => {
  const text = buildMasterPlaylist({
    video: { uri: 'v', codecs: 'avc1.4D400C', bitrate: 180_000 },
    audio: { uri: 'a', codecs: 'mp4a.40.5', bitrate: 50_000 },
  });
  assert.match(text, /^#EXT-X-STREAM-INF:BANDWIDTH=230000,CODECS="avc1.4D400C,mp4a.40.5",AUDIO="audio"$/m);
});

test('the playlists refuse an empty segment list', () => {
  assert.throws(() => buildMediaPlaylist({ uri: VIDEO, initRange: { start: 0, end: 1 }, segments: [] }), /segment/);
});

test('youtubeLoad builds the three playlists the TV gets in the load command, keyed by URL', () => {
  const session = 'http://192.168.1.5:8765/s/tok';
  const videoUrl = `${session}/VIDEO64/x.mp4`;
  const audioUrl = `${session}/AUDIO64/x.mp4`;
  const load = youtubeLoad({
    video: {
      url: videoUrl,
      format: { codecs: 'avc1.64002a', bitrate: 6_000_000, width: 1920, height: 1080, frameRate: 60, initRange: { start: 0, end: 739 } },
      segments: [{ start: 1000, end: 1999, duration: 5 }],
    },
    audio: {
      url: audioUrl,
      format: { codecs: 'mp4a.40.2', bitrate: 130_000, initRange: { start: 0, end: 631 } },
      segments: [{ start: 700, end: 899, duration: 10 }],
    },
  });
  assert.equal(load.url, `${session}/VIDEO64/master.m3u8`);
  assert.deepEqual(Object.keys(load.playlists), [load.url, `${session}/VIDEO64/index.m3u8`, `${session}/AUDIO64/index.m3u8`]);
  assert.equal(
    load.playlists[load.url],
    buildMasterPlaylist({
      video: { uri: 'index.m3u8', codecs: 'avc1.64002a', bitrate: 6_000_000, width: 1920, height: 1080, frameRate: 60 },
      audio: { uri: `${session}/AUDIO64/index.m3u8`, codecs: 'mp4a.40.2', bitrate: 130_000 },
    }),
  );
  // Media segments use the short relative URI: it resolves to the one proxied URL of the stream.
  assert.equal(
    load.playlists[`${session}/VIDEO64/index.m3u8`],
    buildMediaPlaylist({ uri: 'x.mp4', initRange: { start: 0, end: 739 }, segments: [{ start: 1000, end: 1999, duration: 5 }] }),
  );
  assert.equal(new URL('x.mp4', `${session}/AUDIO64/index.m3u8`).href, audioUrl);
  assert.equal(new URL('index.m3u8', load.url).href, `${session}/VIDEO64/index.m3u8`);
  assert.match(load.playlists[`${session}/AUDIO64/index.m3u8`], /#EXT-X-MAP:URI="x\.mp4",BYTERANGE="632@0"/);
});

test('youtubeLoad needs proxied stream URLs ending in /x.mp4', () => {
  const stream = { format: { codecs: 'a', bitrate: 1, initRange: { start: 0, end: 1 } }, segments: [{ start: 2, end: 3, duration: 1 }] };
  assert.throws(() => youtubeLoad({ video: { ...stream, url: 'http://h/s/t/V' }, audio: { ...stream, url: 'http://h/s/t/A/x.mp4' } }), /x\.mp4/);
});
