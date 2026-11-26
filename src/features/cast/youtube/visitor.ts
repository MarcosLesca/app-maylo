/**
 * The visitor handshake of the VISIONOS `player` request (S2v, L14): asked
 * without a visitor id, YouTube answers LOGIN_REQUIRED ("confirm you are not a
 * bot") with a fresh `responseContext.visitorData`, and the same request with
 * that visitor works. The visitor is cached for later videos; a cached one
 * YouTube rejects is replaced by the fresh one of that answer. At most one
 * retry per video, so an age-restricted video (LOGIN_REQUIRED for any visitor)
 * ends with the login message. Pure, no imports, so it is tested in Node.
 */

/** The visitor id (`responseContext.visitorData`, URL-decoded) of a player answer, or null. */
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

/** Where the visitor of a player request came from (`none`: sent without one). */
export type SentVisitor = { visitorData: string | null; from: 'none' | 'cache' | 'handshake' };

/** `retry`: ask again with `visitorData` (and forget the cached one); `done`: `remember` is the visitor to cache, or null to keep the cache as is. */
export type PlayerStep = { next: 'retry'; visitorData: string } | { next: 'done'; remember: string | null };

function status(response: unknown): unknown {
  if (typeof response !== 'object' || response == null) return null;
  const playability = (response as { playabilityStatus?: unknown }).playabilityStatus;
  return typeof playability === 'object' && playability != null ? (playability as { status?: unknown }).status : null;
}

export function nextPlayerCall(response: unknown, sent: SentVisitor): PlayerStep {
  const current = status(response);
  if (current === 'LOGIN_REQUIRED' && sent.from !== 'handshake') {
    const fresh = parseVisitorData(response);
    if (fresh) return { next: 'retry', visitorData: fresh };
  }
  return { next: 'done', remember: current === 'OK' && sent.visitorData ? sent.visitorData : null };
}
