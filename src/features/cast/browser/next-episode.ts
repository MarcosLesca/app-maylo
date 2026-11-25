/**
 * "Siguiente episodio" (S2/D4): the top page's first link whose text, aria-label
 * or rel=next says it leads to the next episode. The detector (detector-script.ts)
 * runs the same rule inside the page (ES5, with NEXT_EPISODE_PATTERN inlined) and
 * posts a 'maylo-next' message; this module parses it. Pure, no imports.
 */

export const NEXT_MESSAGE_TYPE = 'maylo-next';

/**
 * Next-episode wording (es/en) once the text is lower case, whitespace collapsed
 * and leading/trailing symbols (arrows, », >) stripped. Keep in sync with the
 * literal in detector-script.ts (a test checks it).
 */
export const NEXT_EPISODE_PATTERN =
  /^(?:siguiente(?: (?:episodio|cap[ií]tulo))?|pr[oó]ximo (?:episodio|cap[ií]tulo)|next(?: episode)?)$/;

/** Lower case, collapsed, without the arrows and punctuation around the words. */
export function linkWords(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^[^a-z0-9áéíóúüñ]+|[^a-z0-9áéíóúüñ]+$/g, '');
}

export type LinkInfo = { text: string; rel: string; ariaLabel: string; href: string; pageUrl: string };

/** True for an http(s) link to another page whose rel, text or aria-label means "next episode". */
export function isNextEpisodeLink(link: LinkInfo): boolean {
  if (!/^https?:\/\//i.test(link.href)) return false;
  if (link.href.split('#')[0] === link.pageUrl.split('#')[0]) return false;
  if (/(^|\s)next(\s|$)/i.test(link.rel)) return true;
  return NEXT_EPISODE_PATTERN.test(linkWords(link.text)) || NEXT_EPISODE_PATTERN.test(linkWords(link.ariaLabel));
}

export type NextEpisodeLink = { url: string; label: string; pageUrl: string };

/** A next-episode link from a WebView message, or null for anything else. */
export function parseNextEpisodeMessage(data: string): NextEpisodeLink | null {
  let message: unknown;
  try {
    message = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof message !== 'object' || message == null) return null;
  const fields = message as Record<string, unknown>;
  if (fields.type !== NEXT_MESSAGE_TYPE || typeof fields.url !== 'string') return null;
  if (!/^https?:\/\//i.test(fields.url)) return null;
  const label = typeof fields.label === 'string' ? fields.label.trim().replace(/\s+/g, ' ').slice(0, 80) : '';
  return { url: fields.url, label, pageUrl: typeof fields.pageUrl === 'string' ? fields.pageUrl : '' };
}
