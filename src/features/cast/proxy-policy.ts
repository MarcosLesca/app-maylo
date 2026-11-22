/**
 * Pure decisions of the cast proxy (S5) that keep it from being an open relay
 * or leaking the page's cookie. The native server
 * (modules/tv-cast/android/.../ProxyPolicy.kt) mirrors this line for line;
 * these tests pin it.
 */

/** Most targets one cast session remembers (initial target + playlist URIs). */
export const MAX_ALLOWED_TARGETS = 20_000;

/** Lowercase host of an http(s) URL, or null. */
function httpHost(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/**
 * The page's cookie may go to `target` only when it is on the same host as
 * `referer` (the frame the cookie was read from), and never from an https
 * page to a plain-http target.
 */
export function cookieAllowed(target: string, referer: string): boolean {
  const targetHost = httpHost(target);
  const refererHost = httpHost(referer);
  if (targetHost == null || refererHost == null || targetHost !== refererHost) return false;
  return !(referer.toLowerCase().startsWith('https:') && target.toLowerCase().startsWith('http:'));
}

/**
 * Exact absolute target URLs one session may fetch: the one it was started
 * with plus every URI its rewritten playlists emitted. Past `max`, the least
 * recently used one is forgotten (live playlists stay because the TV polls them).
 */
export class AllowedTargets {
  private readonly targets = new Map<string, true>();
  private readonly max: number;

  constructor(initial: string, max: number = MAX_ALLOWED_TARGETS) {
    this.max = max;
    this.add(initial);
  }

  get size(): number {
    return this.targets.size;
  }

  add(target: string): void {
    this.targets.delete(target);
    this.targets.set(target, true);
    if (this.targets.size > this.max) this.targets.delete(this.targets.keys().next().value!);
  }

  /** True when the session issued `target`; a hit counts as a use. */
  has(target: string): boolean {
    if (!this.targets.has(target)) return false;
    this.targets.delete(target);
    this.targets.set(target, true);
    return true;
  }
}
