import { castUrl } from '../dlna-client';
import { proxiedUrl } from '../proxy';
import { sendCommand } from '../receiver/receiver-client';
import { castYoutube, type ChooseAudio } from '../youtube/cast';
import { youtubeVideoId } from '../youtube/video-id';
import { castHeaders, type VideoCandidate } from './candidates';
import type { CastTarget } from './cast-target';

/**
 * Start playing the detected video on the TV. The TV cannot send the page's
 * Referer, User-Agent or cookies, so it fetches the video through the phone's
 * proxy, which adds them (and rewrites HLS playlists to keep going through it).
 * A DLNA TV gets the URL by SOAP; the TV browser receiver gets a `load` command.
 * A YouTube watch URL is resolved at cast time (youtube/cast.ts); `chooseAudio`
 * lets the user pick its language. Answers false when the user cancelled.
 */
export async function castVideo(
  target: CastTarget,
  candidate: VideoCandidate,
  options: { chooseAudio?: ChooseAudio } = {},
): Promise<boolean> {
  const youtubeId = youtubeVideoId(candidate.url);
  if (youtubeId) return castYoutube(target, youtubeId, candidate.title, options.chooseAudio);
  const url = await proxiedUrl(candidate.url, castHeaders(candidate));
  const title = candidate.title || 'MayLo';
  if (target.kind === 'dlna') await castUrl(target.renderer, url, title);
  else await sendCommand({ type: 'load', url, title });
  return true;
}
