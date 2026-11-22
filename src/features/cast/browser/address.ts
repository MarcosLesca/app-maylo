/**
 * Address-bar logic for the cast browser. Pure and free of the URL global
 * (React Native's URL is incomplete), so it runs the same in Node tests.
 */

export const SEARCH_URL = 'https://www.google.com/search?q=';

const WITH_SCHEME = /^(https?:\/\/|about:)/i;
// host[:port][/path…] where host is localhost, an IPv4 address or a dotted name ending in letters.
const BARE_ADDRESS =
  /^(localhost|\d{1,3}(\.\d{1,3}){3}|([a-z0-9-]+\.)+[a-z]{2,}|([a-z0-9-]+\.)+xn--[a-z0-9-]+)(:\d{1,5})?([/?#]\S*)?$/i;

/** The URL to open for what was typed: the URL itself, https:// + a bare address, or a web search. */
export function resolveAddress(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  if (WITH_SCHEME.test(text)) return text;
  if (BARE_ADDRESS.test(text)) return `https://${text}`;
  return `${SEARCH_URL}${encodeURIComponent(text)}`;
}

/** What the address pill shows: no scheme, no www., no lone trailing slash. */
export function displayAddress(url: string): string {
  const rest = url.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  return rest.replace(/^([^/?#]+)\/$/, '$1');
}
