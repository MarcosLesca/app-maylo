/**
 * Pure rules of the shared cast queue (cast_queue, S1/D2). No imports, so it is
 * tested in Node; the Supabase calls live in queue-api.ts.
 */

/** Shown when a queued video cannot be played (e.g. its link or cookie expired meanwhile). */
export const QUEUE_FAILURE_MESSAGE = 'No se pudo reproducir. Abrí la página para enviarlo de nuevo.';

const MAX_TITLE = 200;

/** A detected video as the cast sheet has it (see candidates.ts). */
export type QueueSource = { url: string; pageUrl: string; title: string; userAgent: string; cookie?: string };

/**
 * The row inserted into cast_queue; `created_by` comes from auth.uid(). The cookie
 * is kept (both members agreed) so the queued cast sends it like a normal one.
 */
export type QueueInsert = {
  video_url: string;
  referer: string;
  user_agent: string;
  cookie: string | null;
  page_url: string;
  title: string;
};

const isHttp = (url: string) => /^https?:\/\//i.test(url.trim());

/** What to queue for a detected video on the page `pageUrl`, or null when it cannot be queued. */
export function queueInsert(source: QueueSource, pageUrl: string, pageTitle: string): QueueInsert | null {
  if (!isHttp(source.url) || !isHttp(pageUrl)) return null;
  const clean = (text: string) => text.trim().replace(/\s+/g, ' ');
  const title = clean(source.title) || clean(pageTitle) || 'Video';
  return {
    video_url: source.url.trim(),
    referer: isHttp(source.pageUrl) ? source.pageUrl.trim() : pageUrl.trim(),
    user_agent: source.userAgent,
    cookie: source.cookie ? source.cookie : null,
    page_url: pageUrl.trim(),
    title: title.slice(0, MAX_TITLE),
  };
}

/** The fields of a queued row the cast needs. */
export type QueuedVideo = {
  video_url: string;
  referer: string;
  user_agent: string | null;
  cookie: string | null;
  title: string;
};

/** The candidate castVideo gets for a queued row: same headers as a cast from the page. */
export function queueCandidate(row: QueuedVideo): QueueSource & { cookie: string } {
  return {
    url: row.video_url,
    pageUrl: row.referer,
    title: row.title,
    userAgent: row.user_agent ?? '',
    cookie: row.cookie ?? '',
  };
}

/** The item that plays next: oldest created_at, ties by id; null when the queue is empty. */
export function oldestQueueItem<T extends { id: string; created_at: string }>(items: readonly T[]): T | null {
  let best: T | null = null;
  for (const item of items) {
    if (
      !best ||
      item.created_at < best.created_at ||
      (item.created_at === best.created_at && item.id < best.id)
    ) {
      best = item;
    }
  }
  return best;
}

/**
 * The delete-claim rule: both phones may try to advance, each deletes the item
 * by id and only the one whose delete returned that row casts it.
 */
export function claimedItem<T extends { id: string }>(id: string, deleted: readonly T[] | null | undefined): T | null {
  return deleted?.find((row) => row.id === id) ?? null;
}

export type NextEpisode = { url: string; label: string };

export type AfterEnd = { kind: 'advance' } | { kind: 'offer-next'; url: string } | { kind: 'idle' };

/** When a cast ends: the queue goes first, then the page's next episode (D4), else nothing. */
export function afterPlaybackEnds(input: { queueLength: number; nextEpisode: NextEpisode | null }): AfterEnd {
  if (input.queueLength > 0) return { kind: 'advance' };
  if (input.nextEpisode) return { kind: 'offer-next', url: input.nextEpisode.url };
  return { kind: 'idle' };
}

/** "Lo agregó <nombre>", or '' when the member is unknown. */
export function queuedByText(name: string): string {
  const clean = name.trim();
  return clean ? `Lo agregó ${clean}` : '';
}
