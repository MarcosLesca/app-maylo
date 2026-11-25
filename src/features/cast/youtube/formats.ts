/**
 * Which streams of a YouTube video the TV plays (S2), from the InnerTube
 * `player` response: the best H.264 (avc1) MP4 video up to 1080p and the best
 * AAC (mp4a) audio (stereo first: TV browsers may not decode surround), both
 * with a plain `url` and the byte ranges needed to build HLS playlists. Anything else is a Spanish message for the user.
 * Pure, no imports, so it is tested in Node.
 */

export const YOUTUBE_MESSAGES = {
  login:
    'YouTube pide iniciar sesión para ver este video (por edad o porque es privado), así que no se puede pasar a la tele.',
  unplayable: 'YouTube no deja ver este video fuera de su app (por ejemplo, si es solo para miembros).',
  unavailable: 'Este video de YouTube no está disponible.',
  live: 'Los videos en vivo de YouTube no se pueden pasar a la tele.',
  formats: 'Este video de YouTube no tiene un formato que la tele pueda reproducir.',
  failed: 'No se pudo leer el video de YouTube. Probá de nuevo en un rato.',
  /** The PO token or the n deciphering failed (engine WebView, BotGuard, player script). */
  token: 'No se pudo preparar el video de YouTube para la tele. Probá de nuevo en un rato.',
  /** S4: separate audio and video streams only play on the TV browser receiver. */
  dlna: 'YouTube solo se puede ver con el navegador de la tele.',
  /** The installed APK predates the proxy that allows the YouTube pair (S5). */
  update: 'Para ver YouTube en la tele instalá la última versión de la app.',
};

/** Tallest video the TV gets. */
export const MAX_VIDEO_HEIGHT = 1080;

/** Inclusive byte range inside the format's file. */
export type ByteRange = { start: number; end: number };

export type YoutubeFormat = {
  itag: number;
  url: string;
  /** The RFC 6381 codec, e.g. `avc1.64001F` or `mp4a.40.2`. */
  codecs: string;
  /** Peak bits per second. */
  bitrate: number;
  width?: number;
  height?: number;
  frameRate?: number;
  /** `ftyp` + `moov`: the HLS init segment. */
  initRange: ByteRange;
  /** The `sidx` box that lists the media segments. */
  indexRange: ByteRange;
};

export type YoutubeStreams = { title: string; duration: number | null; video: YoutubeFormat; audio: YoutubeFormat };

export type PickResult = { ok: true; streams: YoutubeStreams } | { ok: false; message: string };

type Raw = Record<string, unknown>;

const isObject = (value: unknown): value is Raw => typeof value === 'object' && value != null && !Array.isArray(value);

function toNumber(value: unknown): number | null {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : null;
}

function byteRange(value: unknown): ByteRange | null {
  if (!isObject(value)) return null;
  const start = toNumber(value.start);
  const end = toNumber(value.end);
  return start != null && end != null && start >= 0 && end >= start ? { start, end } : null;
}

/** `video/mp4; codecs="avc1.4D401F"` → { container: 'video/mp4', codecs: 'avc1.4D401F' }. */
function mimeParts(mimeType: unknown): { container: string; codecs: string } {
  const text = typeof mimeType === 'string' ? mimeType : '';
  const container = text.split(';')[0].trim().toLowerCase();
  const match = /codecs="([^"]*)"/i.exec(text);
  return { container, codecs: match ? match[1].trim() : '' };
}

type Candidate = YoutubeFormat & { isDefault: boolean; isDrc: boolean; stereo: boolean };

function toFormat(raw: unknown): Candidate | null {
  if (!isObject(raw)) return null;
  const url = typeof raw.url === 'string' && /^https:\/\//i.test(raw.url) ? raw.url : null;
  const initRange = byteRange(raw.initRange);
  const indexRange = byteRange(raw.indexRange);
  const itag = toNumber(raw.itag);
  if (!url || !initRange || !indexRange || itag == null) return null;
  const { codecs } = mimeParts(raw.mimeType);
  const track = isObject(raw.audioTrack) ? raw.audioTrack : null;
  const width = toNumber(raw.width);
  const height = toNumber(raw.height);
  const frameRate = toNumber(raw.fps);
  return {
    itag,
    url,
    codecs,
    bitrate: toNumber(raw.bitrate) ?? 0,
    ...(width != null ? { width } : {}),
    ...(height != null ? { height } : {}),
    ...(frameRate != null ? { frameRate } : {}),
    initRange,
    indexRange,
    isDefault: track == null || track.audioIsDefault !== false,
    isDrc: raw.isDrc === true,
    stereo: (toNumber(raw.audioChannels) ?? 2) <= 2,
  };
}

function strip({ isDefault: _isDefault, isDrc: _isDrc, stereo: _stereo, ...format }: Candidate): YoutubeFormat {
  return format;
}

function bestVideo(formats: unknown[]): YoutubeFormat | null {
  let best: Candidate | null = null;
  for (const raw of formats) {
    if (!isObject(raw) || mimeParts(raw.mimeType).container !== 'video/mp4') continue;
    const format = toFormat(raw);
    if (!format || !/^avc1\./i.test(format.codecs) || format.height == null || format.height > MAX_VIDEO_HEIGHT) continue;
    if (
      !best ||
      format.height > best.height! ||
      (format.height === best.height && format.bitrate > best.bitrate)
    ) {
      best = format;
    }
  }
  return best ? strip(best) : null;
}

/** Score order: the default track, then stereo, then not DRC (loudness-compressed), then bitrate. */
function bestAudio(formats: unknown[]): YoutubeFormat | null {
  let best: Candidate | null = null;
  const rank = (format: Candidate) => [format.isDefault ? 1 : 0, format.stereo ? 1 : 0, format.isDrc ? 0 : 1, format.bitrate];
  for (const raw of formats) {
    if (!isObject(raw) || mimeParts(raw.mimeType).container !== 'audio/mp4') continue;
    const format = toFormat(raw);
    if (!format || !/^mp4a\./i.test(format.codecs)) continue;
    if (!best) {
      best = format;
      continue;
    }
    const [a, b] = [rank(format), rank(best)];
    const index = a.findIndex((value, i) => value !== b[i]);
    if (index >= 0 && a[index] > b[index]) best = format;
  }
  return best ? strip(best) : null;
}

/** The streams to cast, or the Spanish reason it cannot be cast. */
export function pickStreams(response: unknown): PickResult {
  const fail = (message: string): PickResult => ({ ok: false, message });
  if (!isObject(response) || !isObject(response.playabilityStatus)) return fail(YOUTUBE_MESSAGES.failed);
  const status = response.playabilityStatus.status;
  if (status === 'LOGIN_REQUIRED' || status === 'AGE_CHECK_REQUIRED' || status === 'AGE_VERIFICATION_REQUIRED') {
    return fail(YOUTUBE_MESSAGES.login);
  }
  if (status === 'LIVE_STREAM_OFFLINE' || status === 'LIVE_STREAM') return fail(YOUTUBE_MESSAGES.live);
  if (status === 'ERROR') return fail(YOUTUBE_MESSAGES.unavailable);
  if (status !== 'OK') return fail(YOUTUBE_MESSAGES.unplayable);

  const details = isObject(response.videoDetails) ? response.videoDetails : {};
  const length = toNumber(details.lengthSeconds);
  if (details.isLive === true || (details.isLiveContent === true && !length)) return fail(YOUTUBE_MESSAGES.live);

  const streaming = isObject(response.streamingData) ? response.streamingData : {};
  const formats = Array.isArray(streaming.adaptiveFormats) ? streaming.adaptiveFormats : [];
  const video = bestVideo(formats);
  const audio = bestAudio(formats);
  if (!video || !audio) return fail(YOUTUBE_MESSAGES.formats);
  return {
    ok: true,
    streams: {
      title: typeof details.title === 'string' ? details.title : '',
      duration: length && length > 0 ? length : null,
      video,
      audio,
    },
  };
}
