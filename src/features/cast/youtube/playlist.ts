/**
 * HLS playlists for a YouTube video (S3), built on the phone: a master with the
 * H.264 variant and an `EXT-X-MEDIA` AAC rendition, and VOD media playlists
 * whose init segment (`EXT-X-MAP`) and media segments are byte ranges of one
 * fragmented MP4 (from its `initRange` and `sidx`). hls.js asks for each byte
 * range with a Range header. Pure, no imports, so it is tested in Node.
 */

type Range = { start: number; end: number };
type Segment = Range & { duration: number };

export type MediaPlaylistInput = {
  /** Where the TV fetches the file (the proxied googlevideo URL). */
  uri: string;
  initRange: Range;
  segments: Segment[];
};

export type VariantInput = {
  /** Where the TV fetches the media playlist. */
  uri: string;
  codecs: string;
  bitrate: number;
  width?: number;
  height?: number;
  frameRate?: number;
};

/** `<length>@<offset>` of an inclusive range. */
const byteRange = ({ start, end }: Range) => `${end - start + 1}@${start}`;

export function buildMediaPlaylist({ uri, initRange, segments }: MediaPlaylistInput): string {
  if (segments.length === 0) throw new Error('A media playlist needs at least one segment.');
  const target = Math.max(1, Math.ceil(Math.max(...segments.map((segment) => Number(segment.duration.toFixed(3))))));
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:7',
    `#EXT-X-TARGETDURATION:${target}`,
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:VOD',
    '#EXT-X-INDEPENDENT-SEGMENTS',
    `#EXT-X-MAP:URI="${uri}",BYTERANGE="${byteRange(initRange)}"`,
  ];
  for (const segment of segments) {
    lines.push(`#EXTINF:${segment.duration.toFixed(3)},`, `#EXT-X-BYTERANGE:${byteRange(segment)}`, uri);
  }
  lines.push('#EXT-X-ENDLIST', '');
  return lines.join('\n');
}

export function buildMasterPlaylist({ video, audio }: { video: VariantInput; audio: VariantInput }): string {
  const attributes = [`BANDWIDTH=${video.bitrate + audio.bitrate}`, `CODECS="${video.codecs},${audio.codecs}"`];
  if (video.width && video.height) attributes.push(`RESOLUTION=${video.width}x${video.height}`);
  if (video.frameRate) attributes.push(`FRAME-RATE=${video.frameRate.toFixed(3)}`);
  attributes.push('AUDIO="audio"');
  return [
    '#EXTM3U',
    '#EXT-X-VERSION:7',
    '#EXT-X-INDEPENDENT-SEGMENTS',
    `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Audio",DEFAULT=YES,AUTOSELECT=YES,URI="${audio.uri}"`,
    `#EXT-X-STREAM-INF:${attributes.join(',')}`,
    video.uri,
    '',
  ].join('\n');
}

/** What a stream contributes: its one proxied URL (`.../<base64url(target)>/x.mp4`), format and segments. */
export type StreamInput = {
  url: string;
  format: { codecs: string; bitrate: number; width?: number; height?: number; frameRate?: number; initRange: Range };
  segments: Segment[];
};

/** The load command's playlists (S3): URL of the master, and every playlist text by its URL. */
export type YoutubeLoad = { url: string; playlists: Record<string, string> };

const STREAM_FILE = '/x.mp4';

function streamDir(url: string): string {
  if (!url.endsWith(STREAM_FILE)) throw new Error(`A proxied stream URL must end in ${STREAM_FILE}.`);
  return url.slice(0, -STREAM_FILE.length);
}

/**
 * Master and media playlists for the TV, which never fetches them: the
 * receiver page answers these URLs from the load command. They sit next to
 * each stream's proxied URL, so the media segments use the relative `x.mp4`
 * (one short line per segment) and resolve to that one proxied URL.
 */
export function youtubeLoad({ video, audio }: { video: StreamInput; audio: StreamInput }): YoutubeLoad {
  const videoDir = streamDir(video.url);
  const audioDir = streamDir(audio.url);
  const master = `${videoDir}/master.m3u8`;
  const videoPlaylist = `${videoDir}/index.m3u8`;
  const audioPlaylist = `${audioDir}/index.m3u8`;
  const variant = (uri: string, { codecs, bitrate, width, height, frameRate }: StreamInput['format']): VariantInput => ({
    uri,
    codecs,
    bitrate,
    ...(width != null ? { width } : {}),
    ...(height != null ? { height } : {}),
    ...(frameRate != null ? { frameRate } : {}),
  });
  const media = (stream: StreamInput) =>
    buildMediaPlaylist({ uri: STREAM_FILE.slice(1), initRange: stream.format.initRange, segments: stream.segments });
  return {
    url: master,
    playlists: {
      [master]: buildMasterPlaylist({ video: variant('index.m3u8', video.format), audio: variant(audioPlaylist, audio.format) }),
      [videoPlaylist]: media(video),
      [audioPlaylist]: media(audio),
    },
  };
}
