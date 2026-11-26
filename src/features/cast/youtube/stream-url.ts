/**
 * googlevideo stream URLs as the TV fetches them (S2b, L7): the `n` parameter
 * replaced by its deciphered value and the visitor-bound PO token added as
 * `pot`. String-based (no URL/URLSearchParams), so it behaves the same in
 * Hermes and Node. Pure, no imports, so it is tested in Node.
 */

function splitQuery(url: string): { base: string; pairs: string[] } {
  const question = url.indexOf('?');
  if (question < 0) return { base: url, pairs: [] };
  return { base: url.slice(0, question), pairs: url.slice(question + 1).split('&').filter((pair) => pair !== '') };
}

const keyOf = (pair: string) => pair.split('=')[0];

function decode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

/** The (decoded) `n` value of a stream URL, or null. */
export function nParam(url: string): string | null {
  const pair = splitQuery(url).pairs.find((item) => keyOf(item) === 'n');
  return pair == null ? null : decode(pair.slice(2));
}

/** `url` with `n` set to `n` (when given) and `pot` set to `poToken`, other parameters in place. */
export function streamUrl(url: string, n: string | null, poToken: string): string {
  const { base, pairs } = splitQuery(url);
  const next = pairs
    .filter((pair) => keyOf(pair) !== 'pot')
    .map((pair) => (n != null && keyOf(pair) === 'n' ? `n=${encodeURIComponent(n)}` : pair));
  next.push(`pot=${encodeURIComponent(poToken)}`);
  return `${base}?${next.join('&')}`;
}

/** googlevideo takes a byte range as a query parameter too (inclusive). */
export function rangeUrl(url: string, start: number, end: number): string {
  return `${url}${url.includes('?') ? '&' : '?'}range=${start}-${end}`;
}

/** Without a valid PO token googlevideo serves only this many bytes of a stream (L5). */
const NO_TOKEN_CAP = 1024 * 1024;

/**
 * The last KiB of a stream, to prove at resolve time that YouTube accepts the PO
 * token: init and sidx sit inside the first MiB, so they load even without one.
 * Null when the whole file fits inside that first MiB.
 */
export function probeRange(segments: readonly { start: number; end: number }[]): { start: number; end: number } | null {
  const last = segments[segments.length - 1];
  if (!last || last.end < NO_TOKEN_CAP) return null;
  return { start: Math.max(last.start, last.end - 1023), end: last.end };
}

/**
 * React Native's fetch shares Android's WebView cookie store, so requests to
 * youtube.com would carry the in-app browser's YouTube cookies; YouTube then binds
 * the streams to that visitor instead of the one the PO token was minted for.
 */
export function withoutCookies(init?: RequestInit): RequestInit {
  return { ...init, credentials: 'omit' };
}
