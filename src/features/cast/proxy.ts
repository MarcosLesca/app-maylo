import TvCast from '../../../modules/tv-cast';
import { mimeTypeFor } from './dlna';
import { extraTargetsValid, proxyUrl, sessionProxyUrls } from './hls';

const OLD_APP = 'Esta versión de la app no puede pasar videos por el teléfono. Instalá la última versión.';

const SUFFIX_BY_MIME: Record<string, string> = {
  'application/vnd.apple.mpegurl': '/x.m3u8',
  'video/webm': '/x.webm',
  'video/x-matroska': '/x.mkv',
  'video/mp4': '/x.mp4',
};

/**
 * URL on the phone (`http://<Wi-Fi IP>:<port>/s/<token>/...`) that serves
 * `target` to the TV with the page's headers (Referer, User-Agent, Cookie).
 * Starts the proxy on demand; each call is a new unguessable session bound to
 * `target` (and the URIs of its playlists) that revokes the previous one.
 */
export async function proxiedUrl(target: string, headers: Record<string, string>): Promise<string> {
  if (!TvCast?.startProxyAsync) throw new Error(OLD_APP);
  const { baseUrl, sessionId } = await TvCast.startProxyAsync(headers, target);
  return proxyUrl(`${baseUrl}/s/${sessionId}`, target, SUFFIX_BY_MIME[mimeTypeFor(target)] ?? '/x.mp4');
}

/**
 * One proxy session for several exact targets (S5, S2v: a YouTube video media
 * playlist and its audio one, with suffix `/x.m3u8`), each served at its own URL
 * ending in `suffix`. The session still serves only these targets and the URIs
 * of the playlists it rewrites; it revokes the previous one. Needs an APK whose
 * startProxyAsync takes the extra targets (older ones reject the call).
 */
export async function proxiedUrls(
  targets: readonly string[],
  headers: Record<string, string>,
  suffix = '/x.mp4',
): Promise<string[]> {
  if (!TvCast?.startProxyAsync) throw new Error(OLD_APP);
  const [target, ...extra] = targets;
  if (target == null || !extraTargetsValid(extra)) throw new Error('A proxy session needs 1 to 5 http(s) targets.');
  const { baseUrl, sessionId } = await TvCast.startProxyAsync(headers, target, extra);
  return sessionProxyUrls(baseUrl, sessionId, targets, suffix);
}

/** Stops the server and forgets every session; a no-op on old APKs. */
export async function stopProxy(): Promise<void> {
  await TvCast?.stopProxyAsync?.();
}
