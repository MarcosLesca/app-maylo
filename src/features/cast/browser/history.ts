/**
 * Pure helpers of the shared browser history ("Lo último que vimos", S6/D5),
 * stored in Supabase (see history-api.ts). No imports, tested in Node.
 */

export type HistoryEntry = { url: string; title: string };
export type HistoryRow = HistoryEntry & { id: string; last_watched_at: string };

const MAX_TITLE = 120;
export const RECENT_LIMIT = 8;

function parts(url: string): { scheme: string; host: string; rest: string } | null {
  const match = /^(https?):\/\/([^/?#]+)([^#]*)/i.exec(url.trim());
  if (!match) return null;
  return { scheme: match[1].toLowerCase(), host: match[2].toLowerCase(), rest: match[3] };
}

/** What to upsert for a cast from the page `url`, or null when it is not an http(s) page. */
export function toHistoryEntry(url: string, title: string): HistoryEntry | null {
  const p = parts(url);
  if (!p) return null;
  const clean = title.trim().replace(/\s+/g, ' ');
  return { url: url.trim().split('#')[0], title: (clean || p.host.replace(/^www\./, '')).slice(0, MAX_TITLE) };
}

/** Same page regardless of fragment, www, trailing slash or host case. */
export function historyKey(url: string): string {
  const p = parts(url);
  if (!p) return url;
  return `${p.scheme}://${p.host.replace(/^www\./, '')}${p.rest.replace(/\/+(?=\?|$)/, '')}`;
}

/** The `limit` most recently watched pages, newest first, each page once. */
export function recentHistory<T extends HistoryRow>(rows: readonly T[], limit = RECENT_LIMIT): T[] {
  const sorted = [...rows].sort((a, b) => (a.last_watched_at < b.last_watched_at ? 1 : a.last_watched_at > b.last_watched_at ? -1 : 0));
  const seen = new Set<string>();
  const recent: T[] = [];
  for (const row of sorted) {
    const key = historyKey(row.url);
    if (seen.has(key)) continue;
    seen.add(key);
    recent.push(row);
    if (recent.length >= limit) break;
  }
  return recent;
}
