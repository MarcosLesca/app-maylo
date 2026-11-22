import { castUrl, type Renderer } from '../dlna-client';
import { proxiedUrl } from '../proxy';
import { castHeaders, type VideoCandidate } from './candidates';

/**
 * Start playing the detected video on the TV. The TV cannot send the page's
 * Referer, User-Agent or cookies, so it fetches the video through the phone's
 * proxy, which adds them (and rewrites HLS playlists to keep going through it).
 */
export async function castVideo(renderer: Renderer, candidate: VideoCandidate): Promise<void> {
  const url = await proxiedUrl(candidate.url, castHeaders(candidate));
  await castUrl(renderer, url, candidate.title || 'MayLo');
}
