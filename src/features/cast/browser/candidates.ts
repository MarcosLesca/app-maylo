/**
 * Videos found by the injected detector (detector-script.ts) and the labels the
 * cast sheet shows for them. Pure, no imports, so it is tested in Node.
 */

export const DETECTOR_MESSAGE_TYPE = 'maylo-video';

export type VideoCandidate = {
  /** Absolute http(s) URL of the video or playlist. */
  url: string;
  /** URL of the frame that requested it; sent as Referer. */
  pageUrl: string;
  title: string;
  userAgent: string;
  cookie: string;
};

const text = (value: unknown) => (typeof value === 'string' ? value : '');

/** A candidate from a WebView message, or null for anything else (other scripts post messages too). */
export function parseDetectorMessage(data: string): VideoCandidate | null {
  let message: unknown;
  try {
    message = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof message !== 'object' || message == null) return null;
  const fields = message as Record<string, unknown>;
  if (fields.type !== DETECTOR_MESSAGE_TYPE) return null;
  const url = text(fields.url);
  if (!/^https?:\/\//i.test(url)) return null; // blob:/data: cannot be fetched by the TV.
  return {
    url,
    pageUrl: text(fields.pageUrl),
    title: text(fields.title),
    userAgent: text(fields.userAgent),
    cookie: text(fields.cookie),
  };
}

export const PAGE_MESSAGE_TYPE = 'maylo-page';

/** The top page's URL and title after it changed without a load (single-page apps such as YouTube). */
export type PageChange = { url: string; title: string };

function originOf(url: string): string | null {
  const match = /^(https?:\/\/[^/?#]+)/i.exec(url);
  return match ? match[1].toLowerCase() : null;
}

/**
 * A page change from a WebView message, or null for anything else. The history API
 * cannot change a page's origin, so with `currentUrl` a change to another origin is
 * rejected (a page could otherwise spoof the address the redirect guard trusts).
 */
export function parsePageMessage(data: string, currentUrl?: string): PageChange | null {
  let message: unknown;
  try {
    message = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof message !== 'object' || message == null) return null;
  const fields = message as Record<string, unknown>;
  if (fields.type !== PAGE_MESSAGE_TYPE) return null;
  const url = text(fields.url);
  if (!/^https?:\/\//i.test(url)) return null;
  if (currentUrl !== undefined && originOf(url) !== originOf(currentUrl)) return null;
  return { url, title: text(fields.title) };
}

export const PLAYER_FRAME_MESSAGE_TYPE = 'maylo-frame';

/** Smallest iframe worth opening as the player (see detector-script.ts). */
export const MIN_PLAYER_FRAME = { width: 200, height: 120 };

/** A large visible iframe of the top page; opening it lets the main-frame detector see its video. */
export type PlayerFrame = { url: string; pageUrl: string; area: number };

/** A player frame from a WebView message, or null for anything else. */
export function parsePlayerFrameMessage(data: string): PlayerFrame | null {
  let message: unknown;
  try {
    message = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof message !== 'object' || message == null) return null;
  const fields = message as Record<string, unknown>;
  if (fields.type !== PLAYER_FRAME_MESSAGE_TYPE) return null;
  const url = text(fields.url);
  const { width, height } = fields;
  if (!/^https?:\/\//i.test(url) || typeof width !== 'number' || typeof height !== 'number') return null;
  if (width < MIN_PLAYER_FRAME.width || height < MIN_PLAYER_FRAME.height) return null;
  return { url, pageUrl: text(fields.pageUrl), area: width * height };
}

/** The list with the frame appended, or the same list when its URL is already there. */
export function addPlayerFrame(list: PlayerFrame[], frame: PlayerFrame): PlayerFrame[] {
  return list.some((item) => item.url === frame.url) ? list : [...list, frame];
}

/** The largest frame that is not the page itself, or null. */
export function playerFrameToOpen(frames: PlayerFrame[], topUrl: string): PlayerFrame | null {
  let best: PlayerFrame | null = null;
  for (const frame of frames) {
    if (samePage(topUrl, frame.url)) continue;
    if (!best || frame.area > best.area) best = frame;
  }
  return best;
}

/** The list with the candidate appended, or the same list when its URL is already there. */
export function addCandidate(list: VideoCandidate[], candidate: VideoCandidate): VideoCandidate[] {
  return list.some((item) => item.url === candidate.url) ? list : [...list, candidate];
}

const pathOf = (url: string) => url.split(/[?#]/)[0].toLowerCase();

/** "Video HLS" for playlists, the container otherwise (MP4 when the path does not say). */
export function videoKindLabel(url: string): string {
  const path = pathOf(url);
  if (path.endsWith('.m3u8')) return 'Video HLS';
  if (path.endsWith('.webm')) return 'Video WebM';
  if (path.endsWith('.mkv')) return 'Video MKV';
  return 'Video MP4';
}

export function foundLabel(count: number): string {
  return count === 1 ? '1 encontrado en la página' : `${count} encontrados en la página`;
}

/** Headers the page used for the video; the TV cannot send them itself (see proxy.ts). */
export function castHeaders(candidate: VideoCandidate): Record<string, string> {
  const headers: Record<string, string> = {};
  if (candidate.pageUrl) headers.Referer = candidate.pageUrl;
  if (candidate.userAgent) headers['User-Agent'] = candidate.userAgent;
  if (candidate.cookie) headers.Cookie = candidate.cookie;
  return headers;
}

/** True when both URLs are the same document (only the #fragment differs). */
export function samePage(a: string, b: string): boolean {
  return a !== '' && a.split('#')[0] === b.split('#')[0];
}

/** One sentence the user can act on, from whatever the DLNA client threw. */
export function castErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  // The YouTube messages (youtube/formats.ts) are already written for the user.
  if (/YouTube/.test(message)) return message;
  if (/no respondió/i.test(message)) return 'La tele no respondió. Revisá que esté prendida y en el mismo Wi-Fi.';
  if (/falló/i.test(message)) return 'La tele no pudo abrir este video. Probá con otro o usá “Duplicar la pantalla”.';
  if (/network request failed/i.test(message))
    return 'No se pudo hablar con la tele. Revisá que el teléfono esté en el mismo Wi-Fi.';
  return 'Algo salió mal al mandar el video a la tele. Probá de nuevo.';
}
