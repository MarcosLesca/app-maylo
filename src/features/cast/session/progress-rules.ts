/**
 * Pure rules of "seguir viendo" (watch_progress, S2/D3). No imports, so it is
 * tested in Node; the Supabase calls live in progress-api.ts.
 */

const MIN_RESUME_S = 30;
const END_MARGIN_S = 60;
const DONE_RATIO = 0.95;
const SAVE_EVERY_MS = 10_000;

/**
 * Key of a video: the top page (no fragment, www, trailing slash nor host case)
 * plus the title (trimmed, collapsed, lower case); null for a non-http(s) page.
 */
export function progressKey(pageUrl: string, title: string): string | null {
  const match = /^(https?):\/\/([^/?#]+)([^#]*)/i.exec(pageUrl.trim());
  if (!match) return null;
  const host = match[2].toLowerCase().replace(/^www\./, '');
  const rest = match[3].replace(/\/+(?=\?|$)/, '');
  const name = title.trim().replace(/\s+/g, ' ').toLowerCase();
  return `${match[1].toLowerCase()}://${host}${rest}|${name}`;
}

export type SavedProgress = { position_s: number; duration_s: number | null };

/**
 * The position to offer ("¿Seguir desde …?") or null: more than 30 s in and more
 * than 60 s before the end (only the lower bound when the duration is unknown).
 */
export function resumeOffer(saved: SavedProgress | null): number | null {
  if (!saved || !(saved.position_s > MIN_RESUME_S)) return null;
  if (saved.duration_s != null && !(saved.position_s < saved.duration_s - END_MARGIN_S)) return null;
  return saved.position_s;
}

/** Save the position, delete the row (≥ 95 % or ended), or skip (position unknown). */
export function progressAction(input: {
  position: number | null;
  duration: number | null;
  ended: boolean;
}): 'save' | 'delete' | 'skip' {
  if (input.ended) return 'delete';
  if (input.position == null) return 'skip';
  if (input.duration != null && input.duration > 0 && input.position >= input.duration * DONE_RATIO) return 'delete';
  return 'save';
}

/** True every 10 s while playing. */
export function shouldSaveProgress(lastSavedAt: number, now: number): boolean {
  return now - lastSavedAt >= SAVE_EVERY_MS;
}
