/**
 * Every YouTube client constant in one place (S2v), so when YouTube stops
 * answering this client the fix is an OTA update of this file. The `player`
 * request goes as the VISIONOS client (odd/tasks/youtube-cast.md L14): its
 * answer carries `streamingData.hlsManifestUrl`, an HLS master on
 * manifest.googlevideo.com whose playlists and segments load without PO token,
 * `n`, signature or cookies. The visitor id comes from the player answer itself
 * (visitor.ts). Pure, no imports, so it is tested in Node.
 */

export const PLAYER_URL = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';

export const VISIONOS_CLIENT = {
  clientName: 'VISIONOS',
  /** Numeric id of clientName, sent as X-YouTube-Client-Name. */
  clientId: '101',
  clientVersion: '1.02',
  deviceMake: 'Apple',
  deviceModel: 'RealityDevice17,1',
  osName: 'visionOS',
  osVersion: '26.5.23O471',
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
} as const;

const LOCALE = { hl: 'es', gl: 'AR' } as const;

/** Body of the `player` request for `videoId`; the first call of a session goes without a visitor. */
export function playerRequestBody(videoId: string, visitorData: string | null): string {
  const { clientName, clientVersion, deviceMake, deviceModel, osName, osVersion } = VISIONOS_CLIENT;
  return JSON.stringify({
    videoId,
    contentCheckOk: true,
    racyCheckOk: true,
    context: {
      client: {
        clientName,
        clientVersion,
        deviceMake,
        deviceModel,
        osName,
        osVersion,
        ...LOCALE,
        ...(visitorData ? { visitorData } : {}),
      },
    },
  });
}

/** Headers of the `player` request. */
export function playerHeaders(visitorData: string | null): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'User-Agent': VISIONOS_CLIENT.userAgent,
    'X-YouTube-Client-Name': VISIONOS_CLIENT.clientId,
    'X-YouTube-Client-Version': VISIONOS_CLIENT.clientVersion,
    Origin: 'https://www.youtube.com',
    ...(visitorData ? { 'X-Goog-Visitor-Id': visitorData } : {}),
  };
}

/** Headers for manifest.googlevideo.com and the segments (the phone proxy sends them for the TV). */
export const STREAM_HEADERS: Record<string, string> = { 'User-Agent': VISIONOS_CLIENT.userAgent };

/**
 * React Native's fetch shares Android's WebView cookie store (L11), so requests
 * to youtube.com would carry the in-app browser's YouTube cookies; every YouTube
 * request leaves them out.
 */
export function withoutCookies(init?: RequestInit): RequestInit {
  return { ...init, credentials: 'omit' };
}
