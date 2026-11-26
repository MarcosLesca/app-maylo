import assert from 'node:assert/strict';
import { test } from 'node:test';

import { pickStreams, tokenFailureText, YOUTUBE_MESSAGES } from './formats.ts';

type Raw = Record<string, unknown>;

const ranges = { initRange: { start: '0', end: '738' }, indexRange: { start: '739', end: '806' } };

function video(itag: number, height: number, bitrate: number, codecs = 'avc1.4D401F', extra: Raw = {}): Raw {
  return {
    itag,
    url: `https://rr.googlevideo.com/videoplayback?itag=${itag}`,
    mimeType: `video/mp4; codecs="${codecs}"`,
    bitrate,
    width: Math.round((height * 16) / 9),
    height,
    fps: 30,
    ...ranges,
    ...extra,
  };
}

function audio(itag: number, bitrate: number, codecs = 'mp4a.40.2', extra: Raw = {}): Raw {
  return { itag, url: `https://rr.googlevideo.com/videoplayback?itag=${itag}&a=${bitrate}`, mimeType: `audio/mp4; codecs="${codecs}"`, bitrate, ...ranges, ...extra };
}

function response(formats: Raw[], extra: Raw = {}): Raw {
  return {
    playabilityStatus: { status: 'OK' },
    videoDetails: { title: 'Me at the zoo', lengthSeconds: '19', isLive: false },
    streamingData: { adaptiveFormats: formats },
    ...extra,
  };
}

test('pickStreams takes the tallest avc1 video up to 1080p and the best AAC audio', () => {
  const result = pickStreams(
    response([
      video(137, 1080, 4_000_000),
      video(299, 1080, 6_000_000, 'avc1.64002a', { fps: 60 }),
      video(264, 1440, 9_000_000, 'avc1.640032'),
      video(248, 1080, 3_000_000, 'vp9'),
      video(399, 1080, 2_000_000, 'av01.0.08M.08'),
      video(136, 720, 2_500_000),
      audio(139, 49_000, 'mp4a.40.5'),
      audio(140, 130_000),
      audio(251, 160_000, 'opus', { mimeType: 'audio/webm; codecs="opus"' }),
    ]),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const { streams } = result;
  assert.equal(streams.title, 'Me at the zoo');
  assert.equal(streams.duration, 19);
  assert.equal(streams.video.itag, 299);
  assert.equal(streams.video.codecs, 'avc1.64002a');
  assert.equal(streams.video.height, 1080);
  assert.equal(streams.video.width, 1920);
  assert.equal(streams.video.frameRate, 60);
  assert.equal(streams.video.bitrate, 6_000_000);
  assert.deepEqual(streams.video.initRange, { start: 0, end: 738 });
  assert.deepEqual(streams.video.indexRange, { start: 739, end: 806 });
  assert.equal(streams.video.url, 'https://rr.googlevideo.com/videoplayback?itag=299');
  assert.equal(streams.audio.itag, 140);
  assert.equal(streams.audio.codecs, 'mp4a.40.2');
});

test('pickStreams prefers the default, non-DRC audio track over a louder duplicate', () => {
  const result = pickStreams(
    response([
      video(133, 240, 180_000),
      audio(140, 131_000, 'mp4a.40.2', { isDrc: true }),
      audio(140, 130_000),
      audio(140, 140_000, 'mp4a.40.2', { audioTrack: { audioIsDefault: false, displayName: 'English' } }),
    ]),
  );
  assert.equal(result.ok && result.streams.audio.bitrate, 130_000);
});

test('pickStreams prefers stereo AAC over surround, which TV browsers may not decode', () => {
  const result = pickStreams(
    response([
      video(299, 1080, 6_000_000, 'avc1.64002a'),
      audio(258, 384_000, 'mp4a.40.2', { audioChannels: 6 }),
      audio(140, 130_000, 'mp4a.40.2', { audioChannels: 2 }),
    ]),
  );
  assert.equal(result.ok && result.streams.audio.itag, 140);
  const only = pickStreams(response([video(299, 1080, 1), audio(258, 384_000, 'mp4a.40.2', { audioChannels: 6 })]));
  assert.equal(only.ok && only.streams.audio.itag, 258);
});

test('pickStreams skips formats without a plain url or byte ranges', () => {
  const result = pickStreams(
    response([
      video(137, 1080, 4_000_000, 'avc1.640028', { url: undefined, signatureCipher: 's=x&url=y' }),
      video(136, 720, 2_500_000, 'avc1.4d401f', { indexRange: undefined }),
      video(135, 480, 1_000_000),
      audio(140, 130_000),
    ]),
  );
  assert.equal(result.ok && result.streams.video.itag, 135);
});

test('pickStreams explains unplayable videos in Spanish', () => {
  const cases: [Raw, string][] = [
    [{ playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm your age' } }, YOUTUBE_MESSAGES.login],
    [{ playabilityStatus: { status: 'UNPLAYABLE', reason: 'Join this channel' } }, YOUTUBE_MESSAGES.unplayable],
    [{ playabilityStatus: { status: 'ERROR', reason: 'Video unavailable' } }, YOUTUBE_MESSAGES.unavailable],
    [{ playabilityStatus: { status: 'LIVE_STREAM_OFFLINE' } }, YOUTUBE_MESSAGES.live],
    [response([video(135, 480, 1)], { videoDetails: { title: 'x', isLive: true } }), YOUTUBE_MESSAGES.live],
    [response([video(135, 480, 1)], { videoDetails: { title: 'x', isLiveContent: true, lengthSeconds: '0' } }), YOUTUBE_MESSAGES.live],
    [response([video(248, 1080, 1, 'vp9'), audio(140, 1)]), YOUTUBE_MESSAGES.formats],
    [response([video(135, 480, 1), audio(251, 1, 'opus')]), YOUTUBE_MESSAGES.formats],
    [response([]), YOUTUBE_MESSAGES.formats],
    [{ playabilityStatus: { status: 'OK' } }, YOUTUBE_MESSAGES.formats],
    [{}, YOUTUBE_MESSAGES.failed],
    [null, YOUTUBE_MESSAGES.failed],
    ['<html>', YOUTUBE_MESSAGES.failed],
  ];
  for (const [raw, message] of cases) {
    assert.equal(typeof message, 'string');
    assert.match(message, /YouTube|video/);
    assert.deepEqual(pickStreams(raw), { ok: false, message }, JSON.stringify(raw));
  }
});

test('the Spanish messages are the agreed sentences', () => {
  assert.deepEqual(YOUTUBE_MESSAGES, {
    login: 'YouTube pide iniciar sesión para ver este video (por edad o porque es privado), así que no se puede pasar a la tele.',
    unplayable: 'YouTube no deja ver este video fuera de su app (por ejemplo, si es solo para miembros).',
    unavailable: 'Este video de YouTube no está disponible.',
    live: 'Los videos en vivo de YouTube no se pueden pasar a la tele.',
    formats: 'Este video de YouTube no tiene un formato que la tele pueda reproducir.',
    failed: 'No se pudo leer el video de YouTube. Probá de nuevo en un rato.',
    token: 'No se pudo preparar el video de YouTube para la tele. Probá de nuevo en un rato.',
    dlna: 'YouTube solo se puede ver con el navegador de la tele.',
    update: 'Para ver YouTube en la tele instalá la última versión de la app.',
  });
});

test('tokenFailureText appends a short technical detail to the token message', () => {
  assert.equal(
    tokenFailureText('probe video 403, pot 704'),
    `${YOUTUBE_MESSAGES.token} (Detalle: probe video 403, pot 704)`,
  );
  assert.equal(tokenFailureText(''), YOUTUBE_MESSAGES.token);
  assert.equal(tokenFailureText('x'.repeat(200)).length, YOUTUBE_MESSAGES.token.length + ' (Detalle: )'.length + 120);
});
