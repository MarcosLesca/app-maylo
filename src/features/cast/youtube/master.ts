/**
 * The HLS master the TV plays for a YouTube video (S2v, L15). VISIONOS hands
 * out a master on manifest.googlevideo.com with every variant (avc1 144p–1080p,
 * vp09 up to 2160p) and the audio as `EXT-X-MEDIA` groups (not muxed). The
 * phone keeps the best avc1 variant up to 1080p and one rendition of its AUDIO
 * group, and writes a small master pointing at both media playlists through the
 * phone proxy, which fetches them and rewrites their segments like any remote
 * HLS. The master itself travels inline in the `load` command (the receiver's
 * playlist loader answers it). String-based (no URL), so it behaves the same in
 * Hermes and Node. Pure, no imports, so it is tested in Node.
 */

/** Tallest video the TV gets (the short side, so vertical Shorts count as 1080p too). */
export const MAX_VIDEO_SIDE = 1080;

export type HlsVariant = {
  /** Absolute URL of the video media playlist. */
  uri: string;
  bandwidth: number;
  /** The variant's CODECS: video and audio, e.g. `avc1.640028,mp4a.40.2`. */
  codecs: string;
  width?: number;
  height?: number;
  frameRate?: number;
  audioGroup: string;
};

/**
 * One audio track. A dubbed video (D-audio) has every language in the same
 * group, all DEFAULT=NO: `id` is its YT-EXT-AUDIO-CONTENT-ID (`es.3`) and
 * `original` marks the track the video was made with.
 */
export type HlsAudio = { uri: string; name: string; language?: string; id?: string; original?: true };

export type HlsChoice = { video: HlsVariant; audio: HlsAudio };

const ATTRIBUTE = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;

function attributes(list: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [, key, raw] of list.matchAll(ATTRIBUTE)) {
    out[key] = raw.startsWith('"') ? raw.slice(1, -1) : raw;
  }
  return out;
}

function toNumber(value: string | undefined): number | null {
  if (value == null || value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** `ref` against the playlist at `base` (absolute, host-relative or path-relative). */
function resolveUri(ref: string, base: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) return ref;
  const origin = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i.exec(base)?.[0] ?? '';
  if (ref.startsWith('//')) return `${base.split(':')[0]}:${ref}`;
  if (ref.startsWith('/')) return `${origin}${ref}`;
  const path = base.split(/[?#]/)[0];
  return `${path.slice(0, path.lastIndexOf('/') + 1)}${ref}`;
}

type Rendition = HlsAudio & { group: string; isDefault: boolean };

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** The bytes of a base64/base64url text as Latin-1 characters (enough to find ASCII words). */
function decodeBase64(text: string): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const char of text.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')) {
    const digit = BASE64URL.indexOf(char);
    if (digit < 0) return '';
    value = (value << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((value >> bits) & 0xff);
    }
  }
  return out;
}

/** YouTube marks the original track `acont=original` in YT-EXT-XTAGS, and its NAME ends in "- original". */
function isOriginal(media: Record<string, string>): boolean {
  if (/acont[^a-z]*original/.test(decodeBase64(media['YT-EXT-XTAGS'] ?? ''))) return true;
  return /\s-\s*original$/i.test(media.NAME ?? '');
}

/** The track to play from `group`: the chosen id, else the original, else DEFAULT, else the first. */
function pickRendition(group: Rendition[], audioId?: string): Rendition {
  return (
    (audioId ? group.find((rendition) => rendition.id === audioId || rendition.uri === audioId) : undefined) ??
    group.find((rendition) => rendition.original) ??
    group.find((rendition) => rendition.isDefault) ??
    group[0]
  );
}

function publicAudio({ group: _group, isDefault: _isDefault, ...audio }: Rendition): HlsAudio {
  return audio;
}

/** Rank of a usable variant, compared item by item: area, frame rate, AAC-LC audio, bandwidth. */
const rank = (variant: HlsVariant) => [
  (variant.width ?? 0) * (variant.height ?? 0),
  variant.frameRate ?? 0,
  variant.codecs.split(',').some((codec) => codec.trim().toLowerCase() === 'mp4a.40.2') ? 1 : 0,
  variant.bandwidth,
];

function better(a: HlsVariant, b: HlsVariant): boolean {
  const [x, y] = [rank(a), rank(b)];
  const index = x.findIndex((value, i) => value !== y[i]);
  return index >= 0 && x[index] > y[index];
}

type Parsed = { variant: HlsVariant; group: Rendition[] };

/** The best H.264 variant up to 1080p whose AUDIO group exists, with that group. */
function parseMaster(master: string, masterUrl: string): Parsed | null {
  const lines = master.replace(/^\uFEFF/, '').split(/\r?\n/).map((line) => line.trim());
  if (lines[0] !== '#EXTM3U') return null;
  const renditions: Rendition[] = [];
  const variants: HlsVariant[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('#EXT-X-MEDIA:')) {
      const media = attributes(line.slice('#EXT-X-MEDIA:'.length));
      if (media.TYPE !== 'AUDIO' || !media.URI || !media['GROUP-ID']) continue;
      renditions.push({
        uri: resolveUri(media.URI, masterUrl),
        name: media.NAME ?? '',
        ...(media.LANGUAGE ? { language: media.LANGUAGE } : {}),
        ...(media['YT-EXT-AUDIO-CONTENT-ID'] ? { id: media['YT-EXT-AUDIO-CONTENT-ID'] } : {}),
        ...(isOriginal(media) ? { original: true as const } : {}),
        group: media['GROUP-ID'],
        isDefault: media.DEFAULT === 'YES',
      });
    } else if (line.startsWith('#EXT-X-STREAM-INF:')) {
      const info = attributes(line.slice('#EXT-X-STREAM-INF:'.length));
      // The URI line follows, maybe after blank lines or other tags (never another variant's).
      let next = i + 1;
      while (next < lines.length && (lines[next] === '' || (lines[next].startsWith('#') && !lines[next].startsWith('#EXT-X-STREAM-INF:')))) {
        next++;
      }
      const uri = lines[next];
      if (!uri || uri.startsWith('#')) continue;
      i = next;
      const [width, height] = (info.RESOLUTION ?? '').split('x').map((side) => toNumber(side));
      const frameRate = toNumber(info['FRAME-RATE']);
      variants.push({
        uri: resolveUri(uri, masterUrl),
        bandwidth: toNumber(info.BANDWIDTH) ?? 0,
        codecs: info.CODECS ?? '',
        ...(width != null && height != null ? { width, height } : {}),
        ...(frameRate != null ? { frameRate } : {}),
        audioGroup: info.AUDIO ?? '',
      });
    }
  }
  let best: HlsVariant | null = null;
  for (const variant of variants) {
    if (!/^avc1\./i.test(variant.codecs.trim())) continue;
    if (variant.width != null && variant.height != null && Math.min(variant.width, variant.height) > MAX_VIDEO_SIDE) continue;
    if (!renditions.some((rendition) => rendition.group === variant.audioGroup)) continue;
    if (!best || better(variant, best)) best = variant;
  }
  if (!best) return null;
  const chosen = best;
  return { variant: chosen, group: renditions.filter((rendition) => rendition.group === chosen.audioGroup) };
}

/**
 * The best H.264 variant up to 1080p whose AUDIO group exists, and one track of
 * that group: `audioId` when given and present, else the original, else the
 * DEFAULT rendition, else the first; null when the master has none.
 */
export function pickHlsStreams(master: string, masterUrl: string, audioId?: string): HlsChoice | null {
  const parsed = parseMaster(master, masterUrl);
  if (!parsed) return null;
  return { video: parsed.variant, audio: publicAudio(pickRendition(parsed.group, audioId)) };
}

/**
 * The audio tracks the user can choose for the variant pickHlsStreams plays
 * (one per id): the original first, then the `preferred` language's ones, then
 * the rest in master order. One track or none means there is nothing to choose.
 */
export function audioTracks(master: string, masterUrl: string, preferred = 'es'): HlsAudio[] {
  const group = parseMaster(master, masterUrl)?.group ?? [];
  const seen = new Set<string>();
  const tracks = group.filter((rendition) => {
    const key = rendition.id ?? rendition.uri;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const score = (track: Rendition) =>
    track.original ? 0 : track.language?.toLowerCase().split('-')[0] === preferred ? 1 : 2;
  return tracks
    .map((track, index) => ({ track, index }))
    .sort((a, b) => score(a.track) - score(b.track) || a.index - b.index)
    .map(({ track }) => publicAudio(track));
}

/** "Español - dubbed" → "Español (doblaje)"; "… - original" → "… (original)". */
export function audioLabel(track: HlsAudio): string {
  const name = track.name
    .replace(/\s-\s*dubbed(-auto)?$/i, ' (doblaje)')
    .replace(/\s-\s*original$/i, ' (original)')
    .trim();
  return name || track.language || 'Audio';
}

/** An attribute value safe inside an HLS quoted string. */
const quoted = (text: string) => text.replace(/["\r\n]/g, '');

/** One audio rendition and one variant, at `urls` (their proxied media playlists). */
export function filteredMaster({ video, audio }: HlsChoice, urls: { video: string; audio: string }): string {
  const media = ['TYPE=AUDIO', 'GROUP-ID="audio"', `NAME="${quoted(audio.name) || 'Audio'}"`];
  if (audio.language) media.push(`LANGUAGE="${quoted(audio.language)}"`);
  media.push('DEFAULT=YES', 'AUTOSELECT=YES', `URI="${urls.audio}"`);
  const variant = [`BANDWIDTH=${video.bandwidth}`, `CODECS="${quoted(video.codecs)}"`];
  if (video.width != null && video.height != null) variant.push(`RESOLUTION=${video.width}x${video.height}`);
  if (video.frameRate != null) variant.push(`FRAME-RATE=${video.frameRate.toFixed(3)}`);
  variant.push('AUDIO="audio"');
  return [
    '#EXTM3U',
    '#EXT-X-INDEPENDENT-SEGMENTS',
    `#EXT-X-MEDIA:${media.join(',')}`,
    `#EXT-X-STREAM-INF:${variant.join(',')}`,
    urls.video,
    '',
  ].join('\n');
}

/** The load command's playlists: URL of the master, and its text by that URL. */
export type YoutubeLoad = { url: string; playlists: Record<string, string> };

const PLAYLIST_FILE = '/x.m3u8';

/**
 * `proxied` are the proxy URLs of the video and audio media playlists (one
 * session, suffix `/x.m3u8`). The master sits next to the video one; the TV
 * never fetches it (the receiver page answers it from the load command), while
 * the media playlists go to the proxy.
 */
export function youtubeLoad(choice: HlsChoice, proxied: readonly string[]): YoutubeLoad {
  const [video, audio] = proxied;
  if (!video?.endsWith(PLAYLIST_FILE) || !audio?.endsWith(PLAYLIST_FILE)) {
    throw new Error(`The proxied media playlists must end in ${PLAYLIST_FILE}.`);
  }
  const url = `${video.slice(0, -PLAYLIST_FILE.length)}/master.m3u8`;
  return { url, playlists: { [url]: filteredMaster(choice, { video, audio }) } };
}
