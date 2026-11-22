import TvCast from '../../../modules/tv-cast';
import { mimeTypeFor } from './dlna';
import { proxyUrl } from './hls';

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
 * Starts the proxy on demand; each call is a new unguessable session.
 */
export async function proxiedUrl(target: string, headers: Record<string, string>): Promise<string> {
  if (!TvCast?.startProxyAsync) throw new Error(OLD_APP);
  const { baseUrl, sessionId } = await TvCast.startProxyAsync(headers);
  return proxyUrl(`${baseUrl}/s/${sessionId}`, target, SUFFIX_BY_MIME[mimeTypeFor(target)] ?? '/x.mp4');
}

/** Stops the server and forgets every session; a no-op on old APKs. */
export async function stopProxy(): Promise<void> {
  await TvCast?.stopProxyAsync?.();
}
