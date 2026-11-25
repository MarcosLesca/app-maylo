/**
 * Pure app-side helpers for the TV browser receiver: the persisted key, the
 * commands the app queues for the TV and the state the TV reports back. No
 * imports, so it is tested in Node; the native calls live in receiver-client.ts.
 */

const KEY_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const KEY_LENGTH = 6;

/** Random 6-character [A-Za-z0-9] key; `random` returns [0, 1). */
export function generateKey(random: () => number = Math.random): string {
  let key = '';
  for (let index = 0; index < KEY_LENGTH; index++) {
    const value = random();
    const slot = Number.isFinite(value) ? Math.floor(value * KEY_ALPHABET.length) : 0;
    key += KEY_ALPHABET[Math.min(KEY_ALPHABET.length - 1, Math.max(0, slot))];
  }
  return key;
}

export function isReceiverKey(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9]{6}$/.test(value);
}

/** What the app asks the TV page to do (S4). */
export type ReceiverCommand =
  /**
   * `playlists` (YouTube, S3): HLS playlist texts by URL that the page answers
   * from memory instead of fetching them; `url` is then the master's URL.
   */
  | { type: 'load'; url: string; title: string; playlists?: Record<string, string> }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'stop' }
  | { type: 'seek'; seconds: number }
  | { type: 'volume'; level: number }
  | { type: 'mute'; muted: boolean };

/** JSON object string for pushReceiverCommandAsync; throws on a value the TV must never get. */
export function serializeCommand(command: ReceiverCommand): string {
  switch (command.type) {
    case 'load':
      if (!/^https?:\/\//i.test(command.url)) throw new Error('load needs an http(s) URL');
      if (!command.playlists) return JSON.stringify({ type: 'load', url: command.url, title: command.title });
      for (const [url, text] of Object.entries(command.playlists)) {
        if (!/^https?:\/\//i.test(url) || !text.startsWith('#EXTM3U')) {
          throw new Error('load playlists need http(s) URLs and #EXTM3U texts');
        }
      }
      return JSON.stringify({ type: 'load', url: command.url, title: command.title, playlists: command.playlists });
    case 'seek':
      if (!Number.isFinite(command.seconds)) throw new Error('seek needs a number of seconds');
      return JSON.stringify({ type: 'seek', seconds: Math.max(0, command.seconds) });
    case 'volume':
      return JSON.stringify({ type: 'volume', level: Math.min(100, Math.max(0, Math.round(command.level))) });
    case 'mute':
      return JSON.stringify({ type: 'mute', muted: command.muted });
    default:
      return JSON.stringify({ type: command.type });
  }
}

export type ReceiverStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error';
const STATUSES: readonly string[] = ['idle', 'loading', 'playing', 'paused', 'ended', 'error'];

/** Last state the TV page posted (S3). */
export type ReceiverPlayback = {
  status: ReceiverStatus;
  position: number | null;
  duration: number | null;
  volume: number | null;
  muted: boolean;
  error: string | null;
  title: string;
  /** Who loaded the current video (sender label, S8); '' when unknown or from an older TV page. */
  from: string;
};

const finite = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** The TV's state JSON, or null when it is not one. */
export function parseReceiverPlayback(json: string): ReceiverPlayback | null {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value == null || Array.isArray(value)) return null;
  const fields = value as Record<string, unknown>;
  if (typeof fields.status !== 'string' || !STATUSES.includes(fields.status)) return null;
  const position = finite(fields.position);
  const duration = finite(fields.duration);
  const volume = finite(fields.volume);
  return {
    status: fields.status as ReceiverStatus,
    position: position == null ? null : Math.max(0, position),
    duration: duration != null && duration > 0 ? duration : null,
    volume: volume == null ? null : Math.min(100, Math.max(0, Math.round(volume))),
    muted: fields.muted === true,
    error: typeof fields.error === 'string' && fields.error ? fields.error : null,
    title: typeof fields.title === 'string' ? fields.title : '',
    from: typeof fields.from === 'string' ? fields.from.trim().slice(0, 60) : '',
  };
}

/** getReceiverStateAsync as the app uses it. */
export type ReceiverReport = {
  /** State posted within the last 5 s. */
  connected: boolean;
  /** TV IPv4 ('' before it ever posted). */
  address: string;
  lastSeenMs: number;
  playback: ReceiverPlayback | null;
};

export type NativeReceiverState = { connected: boolean; address: string; lastSeenMs: number; state: string };

/** IPv4-mapped IPv6 as plain IPv4, without brackets. */
function plainAddress(address: string): string {
  const value = address.trim().replace(/^\[|\]$/g, '');
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(value);
  return mapped ? mapped[1] : value;
}

export function parseReceiverReport(native: NativeReceiverState | null | undefined): ReceiverReport {
  if (!native) return { connected: false, address: '', lastSeenMs: 0, playback: null };
  return {
    connected: native.connected === true,
    address: typeof native.address === 'string' ? plainAddress(native.address) : '',
    lastSeenMs: typeof native.lastSeenMs === 'number' ? native.lastSeenMs : 0,
    playback: typeof native.state === 'string' && native.state ? parseReceiverPlayback(native.state) : null,
  };
}

/** Name of the receiver in the sheet's TV list (S5). */
export function receiverLabel(address: string): string {
  return address ? `Navegador de la tele (${address})` : 'Navegador de la tele';
}

/** Live status line of the connect screen (S2). */
export function connectionText(report: ReceiverReport | null): string {
  return report?.connected ? `Tele conectada (${report.address})` : 'Esperando a la tele…';
}

/**
 * How the remote and the session read a reported status (D1): `ended` is its own
 * flag (an ended video is also not playing), `failed` for error.
 */
export function receiverFlags(status: ReceiverStatus): { paused: boolean; failed: boolean; ended: boolean } {
  return {
    paused: status !== 'playing' && status !== 'loading',
    failed: status === 'error',
    ended: status === 'ended',
  };
}
