import {
  BROWSER_USER_AGENT,
  GOOGLEVIDEO_HEADERS,
  PLAYER_URL,
  VISITOR_URL,
  parseVisitorData,
  playerHeaders,
  playerRequestBody,
  visitorRequestBody,
  webHeaders,
} from './client';
import { callEngine, type EngineCall } from './engine';
import { pickStreams, YOUTUBE_MESSAGES, type YoutubeFormat } from './formats';
import {
  IFRAME_API_URL,
  exportNsigScript,
  findNsigFunction,
  playerIdFromIframeApi,
  playerScriptUrl,
  signatureTimestamp,
} from './player-script';
import {
  ATT_URL,
  attRequestBody,
  generateItRequest,
  parseChallenge,
  parseIntegrityToken,
  tokenExpiresAt,
  usableSession,
  type TokenSession,
} from './po-token';
import { parseSidx, type MediaSegment } from './sidx';
import { nParam, rangeUrl, streamUrl } from './stream-url';

/**
 * Network side of a YouTube cast (S2, S2b, S3), in this order:
 * 1. session: a visitor id and its PO token (BotGuard in the engine WebView),
 *    cached until shortly before the token expires;
 * 2. player: the current player script's signature timestamp, the script
 *    loaded in the engine (once per player id);
 * 3. the TVHTML5_SIMPLY `player` request and the chosen formats;
 * 4. `n` deciphered by the engine, `pot` added, and each format's `sidx`.
 * Throws an Error whose message is plain Spanish for the user.
 */

export type ResolvedStream = { format: YoutubeFormat; segments: MediaSegment[] };
export type ResolvedVideo = { title: string; duration: number | null; video: ResolvedStream; audio: ResolvedStream };

export type Engine = (type: EngineCall, payload: object) => Promise<unknown>;
/** `log` gets the technical cause behind a Spanish message (dev builds warn it). */
export type ResolveDeps = { fetch: typeof fetch; engine: Engine; now: () => number; log: (cause: unknown) => void };

const defaults = (): ResolveDeps => ({
  fetch: (input, init) => fetch(input, init),
  engine: callEngine,
  now: Date.now,
  log: (cause) => {
    if (__DEV__) console.warn('[youtube]', cause);
  },
});

let tokenSession: TokenSession | null = null;
let tokenRequest: Promise<TokenSession> | null = null;
let loadedPlayer: { id: string; signatureTimestamp: number } | null = null;

/** Marks a failure of the token / player / n steps (shown as YOUTUBE_MESSAGES.token). */
class EngineStepError extends Error {}

async function step<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (cause) {
    throw cause instanceof EngineStepError ? cause : new EngineStepError(cause instanceof Error ? cause.message : String(cause));
  }
}

async function json(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function text(response: Response): Promise<string> {
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function mintSession({ fetch: get, engine, now }: ResolveDeps): Promise<TokenSession> {
  return step(async () => {
    const visitorData = parseVisitorData(
      await json(await get(VISITOR_URL, { method: 'POST', headers: webHeaders(), body: visitorRequestBody() })),
    );
    if (!visitorData) throw new Error('no visitor id');
    const challenge = parseChallenge(await json(await get(ATT_URL, { method: 'POST', headers: webHeaders(), body: attRequestBody() })));
    if (!challenge) throw new Error('no BotGuard challenge');
    const interpreter = await text(await get(challenge.interpreterUrl, { headers: { 'User-Agent': BROWSER_USER_AGENT } }));
    const botguard = await engine('botguard', { interpreter, program: challenge.program, globalName: challenge.globalName });
    if (typeof botguard !== 'string') throw new Error('no BotGuard answer');
    const request = generateItRequest(botguard);
    const integrity = parseIntegrityToken(await json(await get(request.url, { method: 'POST', headers: request.headers, body: request.body })));
    if (!integrity) throw new Error('no integrity token');
    const poToken = await engine('mint', { integrityToken: integrity.token, identifier: visitorData });
    if (typeof poToken !== 'string' || poToken === '') throw new Error('no PO token');
    return { visitorData, poToken, expiresAt: tokenExpiresAt(now(), integrity.ttlSeconds) };
  });
}

/** The cached session, or a new one (one mint at a time). */
async function session(deps: ResolveDeps): Promise<TokenSession> {
  const cached = usableSession(tokenSession, deps.now());
  if (cached) return cached;
  tokenRequest ??= mintSession(deps).finally(() => {
    tokenRequest = null;
  });
  tokenSession = await tokenRequest;
  return tokenSession;
}

/** The current player loaded in the engine, and its signature timestamp. */
async function player({ fetch: get, engine }: ResolveDeps): Promise<{ signatureTimestamp: number }> {
  return step(async () => {
    const id = playerIdFromIframeApi(await text(await get(IFRAME_API_URL, { headers: { 'User-Agent': BROWSER_USER_AGENT } })));
    if (!id) throw new Error('no player id');
    if (loadedPlayer?.id === id && (await engine('player', { id })) === true) return loadedPlayer;
    const source = await text(await get(playerScriptUrl(id), { headers: { 'User-Agent': BROWSER_USER_AGENT } }));
    const timestamp = signatureTimestamp(source);
    const name = findNsigFunction(source);
    const script = name ? exportNsigScript(source, name) : null;
    if (timestamp == null || !script) throw new Error('player script not understood');
    if ((await engine('player', { id, script })) !== true) throw new Error('player not loaded');
    loadedPlayer = { id, signatureTimestamp: timestamp };
    return loadedPlayer;
  });
}

async function fetchSegments(format: YoutubeFormat, get: typeof fetch): Promise<MediaSegment[]> {
  const { start, end } = format.indexRange;
  const response = await get(rangeUrl(format.url, start, end), { headers: GOOGLEVIDEO_HEADERS });
  if (!response.ok) throw new Error(response.status === 403 ? 'forbidden' : YOUTUBE_MESSAGES.failed);
  const bytes = new Uint8Array(await response.arrayBuffer());
  try {
    return parseSidx(bytes, start);
  } catch {
    throw new Error(YOUTUBE_MESSAGES.formats);
  }
}

async function resolveOnce(videoId: string, deps: ResolveDeps): Promise<ResolvedVideo> {
  const [{ visitorData, poToken }, { signatureTimestamp: sts }] = await Promise.all([session(deps), player(deps)]);
  let body: unknown;
  try {
    const response = await deps.fetch(PLAYER_URL, {
      method: 'POST',
      headers: playerHeaders(visitorData),
      body: playerRequestBody(videoId, { visitorData, signatureTimestamp: sts }),
    });
    body = response.ok ? await response.json() : null;
  } catch {
    throw new Error(YOUTUBE_MESSAGES.failed);
  }
  const picked = pickStreams(body);
  if (!picked.ok) throw new Error(picked.message);
  const { title, duration } = picked.streams;
  const formats = [picked.streams.video, picked.streams.audio];
  const ns = formats.map((format) => nParam(format.url));
  const deciphered = await step(async () => {
    const wanted = ns.filter((n): n is string => n != null);
    const values = wanted.length ? await deps.engine('n', { values: wanted }) : [];
    if (!Array.isArray(values) || values.length !== wanted.length || values.some((value) => typeof value !== 'string')) {
      throw new Error('n not deciphered');
    }
    return values as string[];
  });
  let next = 0;
  const [video, audio] = formats.map((format, index) => ({
    ...format,
    url: streamUrl(format.url, ns[index] == null ? null : deciphered[next++], poToken),
  }));
  const segments = await Promise.all([fetchSegments(video, deps.fetch), fetchSegments(audio, deps.fetch)]);
  return { title, duration, video: { format: video, segments: segments[0] }, audio: { format: audio, segments: segments[1] } };
}

export async function resolveYoutube(videoId: string, overrides: Partial<ResolveDeps> = {}): Promise<ResolvedVideo> {
  const deps = { ...defaults(), ...overrides };
  const known = new Set<string>(Object.values(YOUTUBE_MESSAGES));
  for (let attempt = 0; ; attempt++) {
    try {
      return await resolveOnce(videoId, deps);
    } catch (cause) {
      // A token YouTube stopped accepting earlier than announced: mint a new one, once.
      if (attempt === 0 && cause instanceof Error && cause.message === 'forbidden') {
        tokenSession = null;
        continue;
      }
      deps.log(cause);
      if (cause instanceof EngineStepError) throw new Error(YOUTUBE_MESSAGES.token);
      throw cause instanceof Error && known.has(cause.message) ? cause : new Error(YOUTUBE_MESSAGES.failed);
    }
  }
}
