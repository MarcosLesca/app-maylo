/**
 * Pop-up and redirect guard of the cast browser (S4). Pure and free of the URL
 * global so it runs the same in Node tests.
 *
 * A top-frame navigation to a different site passes only when the user tapped
 * the page within TAP_WINDOW_MS (the detector script reports trusted taps as
 * 'maylo-tap' messages) or the app itself asked for that URL (allowUrl).
 */

export const TAP_WINDOW_MS = 1000;
export const TAP_MESSAGE_TYPE = 'maylo-tap';

// Second-level labels that, under a two-letter country TLD, are part of the public suffix (com.ar, co.uk…).
const SECOND_LEVEL = new Set(['ac', 'co', 'com', 'edu', 'gob', 'gov', 'gv', 'int', 'ltd', 'me', 'mil', 'ne', 'net', 'nic', 'nom', 'or', 'org', 'plc', 'tur']);
const URL_HOST = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?(\[[^\]]*\]|[^:/?#]*)/i;
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
// Schemes that never leave the page's own content.
const LOCAL_SCHEMES = new Set(['about', 'blob', 'data', 'javascript']);

/** Lowercased host of a `scheme://host…` URL, or '' when it has none. */
export function hostOf(url: string): string {
  const match = URL_HOST.exec(url.trim());
  if (!match) return '';
  return match[1].toLowerCase().replace(/\.$/, '').replace(/^\[(.*)\]$/, '$1');
}

/** Registrable domain (heuristic): last two labels, or three under a ccTLD second level like com.ar. */
export function siteOf(host: string): string {
  const name = host.toLowerCase();
  if (/^[\d.]+$/.test(name) || name.includes(':')) return name;
  const labels = name.split('.');
  if (labels.length <= 2) return name;
  const tld = labels[labels.length - 1];
  const second = labels[labels.length - 2];
  const keep = tld.length === 2 && SECOND_LEVEL.has(second) ? 3 : 2;
  return labels.slice(-keep).join('.');
}

export function sameSite(a: string, b: string): boolean {
  const hostA = hostOf(a);
  return hostA !== '' && siteOf(hostA) === siteOf(hostOf(b));
}

export type NavigationRequest = {
  url: string;
  /** URL of the page shown now; '' before the first page. */
  currentUrl: string;
  /** Date.now() of the last user tap (page or app button); 0 when none. */
  lastTapAt: number;
  now: number;
  /** False for subframe navigations (when the platform reports it). */
  isTopFrame?: boolean;
  /** A URL the app itself is opening (player frame, "Abrir igual"). */
  allowUrl?: string | null;
};

export type NavigationDecision = { action: 'allow' } | { action: 'external' } | { action: 'block'; host: string };

/** What to do with a navigation the page started (the address bar loads never reach this). */
export function decideNavigation(request: NavigationRequest): NavigationDecision {
  const { url } = request;
  if (request.isTopFrame === false) return { action: 'allow' };
  if (request.allowUrl && url === request.allowUrl) return { action: 'allow' };
  const scheme = (SCHEME.exec(url)?.[1] ?? '').toLowerCase();
  if (LOCAL_SCHEMES.has(scheme)) return { action: 'allow' };
  const tapped = request.lastTapAt > 0 && request.now - request.lastTapAt <= TAP_WINDOW_MS;
  if (scheme !== 'http' && scheme !== 'https') {
    return tapped ? { action: 'external' } : { action: 'block', host: hostOf(url) || scheme };
  }
  if (!request.currentUrl || sameSite(url, request.currentUrl) || tapped) return { action: 'allow' };
  return { action: 'block', host: hostOf(url) };
}

/** A tap reported by the detector script, or null for any other message. */
export function parseTapMessage(data: string): { at: number } | null {
  try {
    const message = JSON.parse(data) as { type?: unknown; at?: unknown };
    if (message?.type !== TAP_MESSAGE_TYPE || typeof message.at !== 'number') return null;
    return { at: message.at };
  } catch {
    return null;
  }
}

export type BlockedKind = 'redirect' | 'popup';

export function blockedBannerText(kind: BlockedKind, host: string): string {
  return kind === 'redirect' ? `Se bloqueó una redirección a ${host}` : `Se bloqueó una ventana emergente a ${host}`;
}
