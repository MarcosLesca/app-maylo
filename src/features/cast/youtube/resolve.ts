import { PLAYER_URL, STREAM_HEADERS, playerHeaders, playerRequestBody, withoutCookies } from './client';
import { pickHlsStreams, type HlsChoice } from './master';
import { YOUTUBE_MESSAGES, failureText, playabilityMessage } from './messages';
import { nextPlayerCall, type SentVisitor } from './visitor';

/**
 * Network side of a YouTube cast (S2v, L14/L15): the VISIONOS `player` request
 * (with the visitor handshake of visitor.ts), its `hlsManifestUrl`, and the
 * master fetched on the phone to choose the variant and audio the TV plays.
 * No token, `n` or signature. Every request leaves the WebView cookies out.
 * Throws an Error whose message is plain Spanish for the user, with a short
 * `(Detalle: …)` (step and HTTP status) for diagnosing on the device.
 */

export type ResolvedVideo = { title: string; streams: HlsChoice };

/** `log` gets the technical cause behind a Spanish message (dev builds warn it); every request `fetch` gets omits cookies. */
export type ResolveDeps = { fetch: typeof fetch; log: (cause: unknown) => void };

const defaults = (): ResolveDeps => ({
  fetch: (input, init) => fetch(input, init),
  log: (cause) => {
    if (__DEV__) console.warn('[youtube]', cause);
  },
});

/** The visitor of the last playable answer, reused for the next videos. */
let cachedVisitor: string | null = null;

/** A failure already worded for the user. */
class YoutubeError extends Error {
  constructor(message: string, detail: string) {
    super(failureText(message, detail));
  }
}

async function player(videoId: string, { fetch: get }: ResolveDeps): Promise<Record<string, unknown>> {
  let sent: SentVisitor = cachedVisitor ? { visitorData: cachedVisitor, from: 'cache' } : { visitorData: null, from: 'none' };
  for (;;) {
    let response: Response;
    try {
      response = await get(
        PLAYER_URL,
        withoutCookies({
          method: 'POST',
          headers: playerHeaders(sent.visitorData),
          body: playerRequestBody(videoId, sent.visitorData),
        }),
      );
    } catch (cause) {
      throw new YoutubeError(YOUTUBE_MESSAGES.failed, `player sin red (${cause instanceof Error ? cause.message : cause})`);
    }
    if (!response.ok) throw new YoutubeError(YOUTUBE_MESSAGES.failed, `player HTTP ${response.status}`);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new YoutubeError(YOUTUBE_MESSAGES.failed, 'player sin JSON');
    }
    const step = nextPlayerCall(body, sent);
    if (step.next === 'retry') {
      cachedVisitor = null;
      sent = { visitorData: step.visitorData, from: 'handshake' };
      continue;
    }
    if (step.remember) cachedVisitor = step.remember;
    return typeof body === 'object' && body != null ? (body as Record<string, unknown>) : {};
  }
}

function playabilityDetail(body: Record<string, unknown>): string {
  const playability = body.playabilityStatus as { status?: unknown } | undefined;
  return `player ${typeof playability?.status === 'string' ? playability.status : 'sin estado'}`;
}

function manifestUrl(body: Record<string, unknown>): string | null {
  const streaming = body.streamingData as { hlsManifestUrl?: unknown } | undefined;
  const url = streaming?.hlsManifestUrl;
  return typeof url === 'string' && /^https:\/\//i.test(url) ? url : null;
}

async function resolveOnce(videoId: string, deps: ResolveDeps): Promise<ResolvedVideo> {
  const body = await player(videoId, deps);
  const message = playabilityMessage(body);
  if (message) throw new YoutubeError(message, playabilityDetail(body));
  const url = manifestUrl(body);
  if (!url) throw new YoutubeError(YOUTUBE_MESSAGES.formats, 'player sin hlsManifestUrl');
  let response: Response;
  try {
    response = await deps.fetch(url, withoutCookies({ headers: STREAM_HEADERS }));
  } catch (cause) {
    throw new YoutubeError(YOUTUBE_MESSAGES.failed, `master sin red (${cause instanceof Error ? cause.message : cause})`);
  }
  if (!response.ok) throw new YoutubeError(YOUTUBE_MESSAGES.failed, `master HTTP ${response.status}`);
  const streams = pickHlsStreams(await response.text(), response.url || url);
  if (!streams) throw new YoutubeError(YOUTUBE_MESSAGES.formats, 'master sin variante avc1');
  const details = body.videoDetails as { title?: unknown } | undefined;
  return { title: typeof details?.title === 'string' ? details.title : '', streams };
}

export async function resolveYoutube(videoId: string, overrides: Partial<ResolveDeps> = {}): Promise<ResolvedVideo> {
  const deps = { ...defaults(), ...overrides };
  try {
    return await resolveOnce(videoId, deps);
  } catch (cause) {
    deps.log(cause);
    if (cause instanceof YoutubeError) throw cause;
    throw new Error(failureText(YOUTUBE_MESSAGES.failed, cause instanceof Error ? cause.message : String(cause)));
  }
}
