/**
 * Every YouTube client constant in one place (S2), so when YouTube stops
 * answering this client the fix is an OTA update of this file. The `player`
 * request goes as TVHTML5_SIMPLY (odd/tasks/youtube-cast.md L7): it returns
 * `adaptiveFormats` with plain `url`s whose `n` must be deciphered (engine)
 * and that need a visitor-bound PO token (`pot`) past the first MiB.
 * The visitor id comes from InnerTube `visitor_id` (as a web browser).
 * Pure, no imports, so it is tested in Node.
 */

const INNERTUBE = 'https://www.youtube.com/youtubei/v1';

export const PLAYER_URL = `${INNERTUBE}/player?prettyPrint=false`;
export const VISITOR_URL = `${INNERTUBE}/visitor_id?prettyPrint=false`;

/** A desktop browser, for the web-client calls (visitor id, BotGuard challenge, player script). */
export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export const WEB_CLIENT = { clientName: 'WEB', clientVersion: '2.20250101.00.00' } as const;

export const TV_CLIENT = {
  clientName: 'TVHTML5_SIMPLY',
  /** Numeric id of clientName, sent as X-YouTube-Client-Name. */
  clientId: '75',
  clientVersion: '1.0',
  userAgent: 'Mozilla/5.0 (ChromiumStylePlatform) Cobalt/Version',
} as const;

const LOCALE = { hl: 'es', gl: 'AR' } as const;

/** InnerTube context of the web client (visitor id and att/get). */
export function webContext() {
  return { client: { ...WEB_CLIENT, ...LOCALE } };
}

export const webHeaders = (): Record<string, string> => ({
  'Content-Type': 'application/json',
  'User-Agent': BROWSER_USER_AGENT,
  Origin: 'https://www.youtube.com',
});

export function visitorRequestBody(): string {
  return JSON.stringify({ context: webContext() });
}

/** The visitor id (`visitorData`, URL-decoded) of a visitor_id answer, or null. */
export function parseVisitorData(response: unknown): string | null {
  if (typeof response !== 'object' || response == null) return null;
  const context = (response as { responseContext?: unknown }).responseContext;
  const value = typeof context === 'object' && context != null ? (context as { visitorData?: unknown }).visitorData : null;
  if (typeof value !== 'string' || value === '') return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export type PlayerSession = { visitorData: string; signatureTimestamp: number };

/** Body of the `player` request for `videoId`. */
export function playerRequestBody(videoId: string, { visitorData, signatureTimestamp }: PlayerSession): string {
  const { clientName, clientVersion } = TV_CLIENT;
  return JSON.stringify({
    videoId,
    contentCheckOk: true,
    racyCheckOk: true,
    context: { client: { clientName, clientVersion, ...LOCALE, visitorData } },
    playbackContext: { contentPlaybackContext: { html5Preference: 'HTML5_PREF_WANTS', signatureTimestamp } },
  });
}

/** Headers of the `player` request. */
export function playerHeaders(visitorData: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'User-Agent': TV_CLIENT.userAgent,
    'X-YouTube-Client-Name': TV_CLIENT.clientId,
    'X-YouTube-Client-Version': TV_CLIENT.clientVersion,
    'X-Goog-Visitor-Id': visitorData,
    Origin: 'https://www.youtube.com',
  };
}

/** Headers for googlevideo (the phone proxy sends them for the TV): the same client that got the URLs. */
export const GOOGLEVIDEO_HEADERS: Record<string, string> = { 'User-Agent': TV_CLIENT.userAgent };
