/** Pure helpers for the browser's shared favorites (stored in Supabase, see favorites-api.ts). */

export type FavoriteInput = { url: string; title: string };

const MAX_TITLE = 120;

function parts(url: string): { scheme: string; host: string; rest: string } | null {
  const match = /^(https?):\/\/([^/?#]+)([^#]*)/i.exec(url.trim());
  if (!match) return null;
  return { scheme: match[1].toLowerCase(), host: match[2].toLowerCase(), rest: match[3] };
}

const shortHost = (host: string) => host.replace(/^www\./, '');

/** What to save for the current page, or null when it cannot be a favorite. */
export function toFavoriteInput(url: string, title: string): FavoriteInput | null {
  const p = parts(url);
  if (!p) return null;
  const clean = title.trim().replace(/\s+/g, ' ');
  return { url: url.trim(), title: (clean || shortHost(p.host)).slice(0, MAX_TITLE) };
}

/** Comparison key: same page regardless of fragment, www, trailing slash or host case. */
export function favoriteKey(url: string): string {
  const p = parts(url);
  if (!p) return url;
  const rest = p.rest.replace(/\/+(?=\?|$)/, '');
  return `${p.scheme}://${shortHost(p.host)}${rest}`;
}

export function isFavorite(saved: { url: string }[], url: string): boolean {
  const key = favoriteKey(url);
  return saved.some((favorite) => favoriteKey(favorite.url) === key);
}

export function favoriteLabel(favorite: FavoriteInput): { title: string; host: string } {
  return { title: favorite.title, host: shortHost(parts(favorite.url)?.host ?? '') };
}
