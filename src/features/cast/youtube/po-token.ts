/**
 * The network side of the PO token (S2b, L7), NewPipe-style: the phone asks
 * InnerTube `att/get` for a BotGuard challenge, the engine WebView runs it,
 * the phone trades the BotGuard answer for an integrity token at
 * jnn-pa.googleapis.com (GenerateIT), and the WebView mints the token for the
 * visitor id. The token is cached with its visitor id for its lifetime.
 *
 * Endpoints, request key, API key and the answer layout follow BgUtils
 * (LuanRT/BgUtils, MIT License, Copyright (c) 2024 LuanRT; see
 * THIRD_PARTY_NOTICES.md). Pure, no imports, so it is tested in Node.
 */

export const ATT_URL = 'https://www.youtube.com/youtubei/v1/att/get?prettyPrint=false';

const GENERATE_IT_URL = 'https://jnn-pa.googleapis.com/$rpc/google.internal.waa.v1.Waa/GenerateIT';
const GOOG_API_KEY = 'AIzaSyDyT5W0Jh49F30Pqqtyfdf7pDLFKLJoAnw';
/** YouTube's BotGuard request key. */
const REQUEST_KEY = 'O43z0dpjhgX20SCx4KAo';

/** Longest a token is kept, whatever GenerateIT says. */
const MAX_TOKEN_MS = 12 * 3600 * 1000;
/** Renewed this long before it expires, so a cast never starts with a dying token. */
export const TOKEN_MARGIN_MS = 30 * 60 * 1000;
const DEFAULT_TTL_SECONDS = 12 * 3600;

const INTERPRETER_HOST = /^\/\/www\.google\.com\//;
const GLOBAL_NAME = /^[A-Za-z_$][\w$]*$/;

/** att/get as the web client: the challenge is not tied to any video (ENGAGEMENT_TYPE_UNBOUND). */
export function attRequestBody(): string {
  return JSON.stringify({
    context: { client: { clientName: 'WEB', clientVersion: '2.20250101.00.00', hl: 'es', gl: 'AR' } },
    engagementType: 'ENGAGEMENT_TYPE_UNBOUND',
  });
}

export type Challenge = { interpreterUrl: string; program: string; globalName: string };

const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value != null ? (value as Record<string, unknown>)[key] : undefined;

/** The BotGuard challenge of an att/get answer, or null. The interpreter must come from www.google.com. */
export function parseChallenge(response: unknown): Challenge | null {
  const challenge = field(response, 'bgChallenge');
  const url = field(field(challenge, 'interpreterUrl'), 'privateDoNotAccessOrElseTrustedResourceUrlWrappedValue');
  const program = field(challenge, 'program');
  const globalName = field(challenge, 'globalName');
  if (typeof url !== 'string' || !INTERPRETER_HOST.test(url)) return null;
  if (typeof program !== 'string' || program === '') return null;
  if (typeof globalName !== 'string' || !GLOBAL_NAME.test(globalName)) return null;
  return { interpreterUrl: `https:${url}`, program, globalName };
}

/** The GenerateIT request for a BotGuard answer. */
export function generateItRequest(botguardResponse: string): { url: string; headers: Record<string, string>; body: string } {
  return {
    url: GENERATE_IT_URL,
    headers: {
      'Content-Type': 'application/json+protobuf',
      'X-Goog-Api-Key': GOOG_API_KEY,
      'X-User-Agent': 'grpc-web-javascript/0.1',
    },
    body: JSON.stringify([REQUEST_KEY, botguardResponse]),
  };
}

/** `[integrityToken, ttlSeconds, refreshThreshold, fallbackToken]`; null without an integrity token. */
export function parseIntegrityToken(response: unknown): { token: string; ttlSeconds: number } | null {
  if (!Array.isArray(response) || typeof response[0] !== 'string' || response[0] === '') return null;
  const ttl = response[1];
  return { token: response[0], ttlSeconds: typeof ttl === 'number' && ttl > 0 ? ttl : DEFAULT_TTL_SECONDS };
}

/** When a token minted at `now` with this lifetime stops being used. */
export function tokenExpiresAt(now: number, ttlSeconds: number): number {
  return now + Math.max(0, Math.min(ttlSeconds * 1000, MAX_TOKEN_MS) - TOKEN_MARGIN_MS);
}

/** The visitor id, its PO token and when to renew them. */
export type TokenSession = { visitorData: string; poToken: string; expiresAt: number };

export function usableSession<T extends TokenSession>(session: T | null, now: number): T | null {
  return session && now < session.expiresAt ? session : null;
}
