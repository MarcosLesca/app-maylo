/**
 * Which YouTube video a page shows (S1). Pure, no imports, so it is tested in Node.
 * Watch pages (`/watch?v=`), shorts (`/shorts/<id>`) on youtube.com and its
 * subdomains (www, m, music), and `youtu.be/<id>` links.
 */

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

function isYoutubeHost(host: string): boolean {
  return host === 'youtube.com' || host.endsWith('.youtube.com');
}

/** The 11-character video id of a YouTube video page, or null. */
export function youtubeVideoId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  const host = parsed.hostname.toLowerCase();
  const parts = parsed.pathname.split('/').filter((part) => part !== '');
  let id: string | null = null;
  if (host === 'youtu.be' || host === 'www.youtu.be') {
    if (parts.length === 1) id = parts[0];
  } else if (isYoutubeHost(host)) {
    if (parts.length === 1 && parts[0] === 'watch') id = parsed.searchParams.get('v');
    else if (parts.length === 2 && parts[0] === 'shorts') id = parts[1];
  }
  return id != null && VIDEO_ID.test(id) ? id : null;
}

/** The canonical watch page of a video id (what the cast candidate and the queue carry). */
export function youtubeWatchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

/** The video title from a YouTube page title: without "(3) " unread counts or the " - YouTube" suffix. */
export function youtubeTitle(pageTitle: string): string {
  const title = pageTitle.trim().replace(/^\(\d+\)\s*/, '').replace(/\s*-\s*YouTube$/i, '').trim();
  return title === 'YouTube' ? '' : title;
}
