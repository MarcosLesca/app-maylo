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
