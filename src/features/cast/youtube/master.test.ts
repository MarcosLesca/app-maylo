import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DUBBED_MASTER, VISIONOS_MASTER } from './master.fixture.ts';
import { audioLabel, audioTracks, filteredMaster, pickHlsStreams, youtubeLoad } from './master.ts';

const MASTER_URL = 'https://manifest.googlevideo.com/api/manifest/hls_variant/expire/EXPIRE/id/VIDEO_ID/file/index.m3u8';
const playlist = (itag: number) =>
  `https://manifest.googlevideo.com/api/manifest/hls_playlist/expire/EXPIRE/ei/EI/ip/IP/id/VIDEO_ID/itag/${itag}/source/youtube/sig/SIG/lsig/LSIG/playlist/index.m3u8`;

test('the real master gives the 1080p avc1 variant and its AAC-LC audio group, not vp09 nor subtitles (S2v)', () => {
  assert.deepEqual(pickHlsStreams(VISIONOS_MASTER, MASTER_URL), {
    video: {
      uri: playlist(270),
      bandwidth: 4688074,
      codecs: 'avc1.640028,mp4a.40.2',
      width: 1920,
      height: 1080,
      frameRate: 25,
      audioGroup: '234',
    },
    audio: { uri: playlist(234), name: 'Default' },
  });
});

/** A master of `variants` (attribute lists) with audio groups a (HE-AAC) and b (AAC-LC). */
function master(variants: string[], audio = ['#EXT-X-MEDIA:URI="a.m3u8",TYPE=AUDIO,GROUP-ID="a",NAME="A",DEFAULT=YES', '#EXT-X-MEDIA:URI="b.m3u8",TYPE=AUDIO,GROUP-ID="b",NAME="B",DEFAULT=YES']) {
  return ['#EXTM3U', ...audio, ...variants.flatMap((attributes, index) => [`#EXT-X-STREAM-INF:${attributes}`, `v${index}.m3u8`]), ''].join('\n');
}
const BASE = 'https://manifest.googlevideo.com/x/index.m3u8';
const picked = (text: string) => {
  const choice = pickHlsStreams(text, BASE);
  return choice && { video: choice.video.uri.replace('https://manifest.googlevideo.com/x/', ''), audio: choice.audio.uri.replace('https://manifest.googlevideo.com/x/', '') };
};

test('the variant order is resolution, then frame rate, then AAC-LC audio, then bandwidth', () => {
  // 1080p60 over 1080p30 over 720p60 (aqz-KE-bpKQ has 720p60 and 1080p60).
  assert.deepEqual(
    picked(master([
      'BANDWIDTH=4553846,CODECS="avc1.4D4020,mp4a.40.2",RESOLUTION=1280x720,FRAME-RATE=60,AUDIO="b"',
      'BANDWIDTH=9000000,CODECS="avc1.640028,mp4a.40.2",RESOLUTION=1920x1080,FRAME-RATE=30,AUDIO="b"',
      'BANDWIDTH=7417746,CODECS="avc1.64002A,mp4a.40.2",RESOLUTION=1920x1080,FRAME-RATE=60,AUDIO="b"',
    ])),
    { video: 'v2.m3u8', audio: 'b.m3u8' },
  );
  // The same video with HE-AAC (mp4a.40.5) or AAC-LC: AAC-LC, even at a lower bandwidth.
  assert.deepEqual(
    picked(master([
      'BANDWIDTH=400000,CODECS="avc1.4D4015,mp4a.40.5",RESOLUTION=426x240,FRAME-RATE=30,AUDIO="a"',
      'BANDWIDTH=395368,CODECS="avc1.4D4015,mp4a.40.2",RESOLUTION=426x240,FRAME-RATE=30,AUDIO="b"',
    ])),
    { video: 'v1.m3u8', audio: 'b.m3u8' },
  );
  // Only HE-AAC: still castable.
  assert.deepEqual(
    picked(master(['BANDWIDTH=310801,CODECS="avc1.4D4015,mp4a.40.5",RESOLUTION=426x240,FRAME-RATE=30,AUDIO="a"'])),
    { video: 'v0.m3u8', audio: 'a.m3u8' },
  );
  // Same everything else: the higher bandwidth.
  assert.deepEqual(
    picked(master([
      'BANDWIDTH=1000,CODECS="avc1.4D401E,mp4a.40.2",RESOLUTION=640x360,FRAME-RATE=30,AUDIO="b"',
      'BANDWIDTH=2000,CODECS="avc1.4D401E,mp4a.40.2",RESOLUTION=640x360,FRAME-RATE=30,AUDIO="b"',
    ])),
    { video: 'v1.m3u8', audio: 'b.m3u8' },
  );
});

test('only avc1 up to 1080p (the short side, so vertical Shorts fit) with an existing audio group', () => {
  assert.deepEqual(
    picked(master([
      'BANDWIDTH=1000,CODECS="avc1.4D401E,mp4a.40.2",RESOLUTION=640x360,FRAME-RATE=30,AUDIO="b"',
      'BANDWIDTH=9000000,CODECS="avc1.640032,mp4a.40.2",RESOLUTION=2560x1440,FRAME-RATE=30,AUDIO="b"',
      'BANDWIDTH=9000000,CODECS="vp09.00.40.08,mp4a.40.2",RESOLUTION=1920x1080,FRAME-RATE=30,AUDIO="b"',
      'BANDWIDTH=9000000,CODECS="avc1.640028,mp4a.40.2",RESOLUTION=1920x1080,FRAME-RATE=30,AUDIO="missing"',
      'BANDWIDTH=9000000,CODECS="avc1.640028,mp4a.40.2",RESOLUTION=1920x1080,FRAME-RATE=30',
    ])),
    { video: 'v0.m3u8', audio: 'b.m3u8' },
  );
  assert.deepEqual(
    picked(master([
      'BANDWIDTH=1000,CODECS="avc1.4D401E,mp4a.40.2",RESOLUTION=360x640,FRAME-RATE=30,AUDIO="b"',
      'BANDWIDTH=3000,CODECS="avc1.640028,mp4a.40.2",RESOLUTION=1080x1920,FRAME-RATE=30,AUDIO="b"',
    ])),
    { video: 'v1.m3u8', audio: 'b.m3u8' },
  );
});

test('inside the audio group the DEFAULT rendition wins; no usable variant is null', () => {
  const audio = [
    '#EXT-X-MEDIA:URI="dub.m3u8",TYPE=AUDIO,GROUP-ID="b",NAME="Doblaje",LANGUAGE="es",DEFAULT=NO',
    '#EXT-X-MEDIA:URI="orig.m3u8",TYPE=AUDIO,GROUP-ID="b",NAME="Original",LANGUAGE="en",DEFAULT=YES',
  ];
  const variant = 'BANDWIDTH=1000,CODECS="avc1.4D401E,mp4a.40.2",RESOLUTION=640x360,FRAME-RATE=30,AUDIO="b"';
  assert.deepEqual(picked(master([variant], audio)), { video: 'v0.m3u8', audio: 'orig.m3u8' });
  assert.deepEqual(pickHlsStreams(master([variant], audio), BASE)?.audio, {
    uri: 'https://manifest.googlevideo.com/x/orig.m3u8',
    name: 'Original',
    language: 'en',
  });
  assert.equal(picked(master(['BANDWIDTH=1,CODECS="vp09.00.40.08,mp4a.40.2",RESOLUTION=1920x1080,AUDIO="b"'])), null);
  assert.equal(pickHlsStreams('', BASE), null);
  assert.equal(pickHlsStreams('<html>no</html>', BASE), null);
});

test('the filtered master has one audio rendition and one variant, at the proxied URLs', () => {
  const choice = pickHlsStreams(VISIONOS_MASTER, MASTER_URL)!;
  assert.equal(
    filteredMaster(choice, { video: 'http://192.168.0.5:8765/s/t/VIDEO/x.m3u8', audio: 'http://192.168.0.5:8765/s/t/AUDIO/x.m3u8' }),
    [
      '#EXTM3U',
      '#EXT-X-INDEPENDENT-SEGMENTS',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Default",DEFAULT=YES,AUTOSELECT=YES,URI="http://192.168.0.5:8765/s/t/AUDIO/x.m3u8"',
      '#EXT-X-STREAM-INF:BANDWIDTH=4688074,CODECS="avc1.640028,mp4a.40.2",RESOLUTION=1920x1080,FRAME-RATE=25.000,AUDIO="audio"',
      'http://192.168.0.5:8765/s/t/VIDEO/x.m3u8',
      '',
    ].join('\n'),
  );
  const dubbed = pickHlsStreams(
    master(['BANDWIDTH=1000,CODECS="avc1.4D401E,mp4a.40.2",AUDIO="b"'], ['#EXT-X-MEDIA:URI="o.m3u8",TYPE=AUDIO,GROUP-ID="b",NAME="Inglés (original)",LANGUAGE="en",DEFAULT=YES']),
    BASE,
  )!;
  assert.equal(
    filteredMaster(dubbed, { video: 'http://p/v/x.m3u8', audio: 'http://p/a/x.m3u8' }),
    [
      '#EXTM3U',
      '#EXT-X-INDEPENDENT-SEGMENTS',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Inglés (original)",LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES,URI="http://p/a/x.m3u8"',
      '#EXT-X-STREAM-INF:BANDWIDTH=1000,CODECS="avc1.4D401E,mp4a.40.2",AUDIO="audio"',
      'http://p/v/x.m3u8',
      '',
    ].join('\n'),
  );
});

test('the load command carries the filtered master inline next to the proxied video playlist', () => {
  const choice = pickHlsStreams(VISIONOS_MASTER, MASTER_URL)!;
  const urls = ['http://192.168.0.5:8765/s/t/VIDEO/x.m3u8', 'http://192.168.0.5:8765/s/t/AUDIO/x.m3u8'] as const;
  const load = youtubeLoad(choice, urls);
  assert.equal(load.url, 'http://192.168.0.5:8765/s/t/VIDEO/master.m3u8');
  assert.deepEqual(Object.keys(load.playlists), [load.url]);
  assert.equal(load.playlists[load.url], filteredMaster(choice, { video: urls[0], audio: urls[1] }));
  // The media playlists are NOT inline: the TV fetches them through the proxy, which rewrites their segments.
  assert.ok(!(urls[0] in load.playlists) && !(urls[1] in load.playlists));
  assert.throws(() => youtubeLoad(choice, ['http://p/v/x.mp4', 'http://p/a/x.mp4']), /x\.m3u8/);
});

const dubbed = (lang: string) =>
  `https://manifest.googlevideo.com/api/manifest/hls_playlist/id/VIDEO_ID/itag/234/xtags/${lang}/playlist/index.m3u8`;

test('a dubbed video plays its original audio, not the first dub, when no track is DEFAULT', () => {
  assert.deepEqual(pickHlsStreams(DUBBED_MASTER, MASTER_URL)?.audio, {
    uri: dubbed('en-US'),
    name: 'American English - original',
    language: 'en-US',
    id: 'en-US.4',
    original: true,
  });
});

test('the original is found by YT-EXT-XTAGS alone, and DEFAULT=YES still wins without marks', () => {
  const plain = DUBBED_MASTER.replace(/ - original/, '');
  assert.equal(pickHlsStreams(plain, MASTER_URL)?.audio.uri, dubbed('en-US'));
  const unmarked = DUBBED_MASTER.replace(/,YT-EXT-XTAGS="[^"]*"/g, '').replace(/ - (original|dubbed)/g, '');
  assert.equal(pickHlsStreams(unmarked, MASTER_URL)?.audio.uri, dubbed('ar'));
  const withDefault = unmarked.replace(/(LANGUAGE="de".*)DEFAULT=NO/, '$1DEFAULT=YES');
  assert.equal(pickHlsStreams(withDefault, MASTER_URL)?.audio.uri, dubbed('de'));
});

test('a chosen audio track id plays that track; an unknown id falls back to the original', () => {
  assert.equal(pickHlsStreams(DUBBED_MASTER, MASTER_URL, 'es.3')?.audio.uri, dubbed('es'));
  assert.equal(pickHlsStreams(DUBBED_MASTER, MASTER_URL, 'xx.9')?.audio.uri, dubbed('en-US'));
});

test('audioTracks lists the original first, then the Spanish dubs, then the rest in master order', () => {
  assert.deepEqual(
    audioTracks(DUBBED_MASTER, MASTER_URL).map((track) => [track.id, audioLabel(track)]),
    [
      ['en-US.4', 'American English (original)'],
      ['es.3', 'Español (doblaje)'],
      ['ar.3', 'العربية (doblaje)'],
      ['de.3', 'Deutsch (doblaje)'],
    ],
  );
  // One track (the usual case) or none: nothing to choose.
  assert.equal(audioTracks(VISIONOS_MASTER, MASTER_URL).length, 1);
  assert.deepEqual(audioTracks('not a master', MASTER_URL), []);
  assert.equal(audioLabel({ uri: 'u', name: '', language: 'bn' }), 'bn');
  assert.equal(audioLabel({ uri: 'u', name: '' }), 'Audio');
});
