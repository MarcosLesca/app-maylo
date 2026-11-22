import { castUrl, type Renderer } from '../dlna-client';
import { castHeaders, type VideoCandidate } from './candidates';

/**
 * Where the TV should fetch the video from. T1 hands it the page's URL as is;
 * T3 swaps this for `proxiedUrl` from ../proxy (same signature), which serves
 * the video to the TV with these headers.
 */
const tvUrlFor = async (target: string, _headers: Record<string, string>): Promise<string> => target;

/** Start playing the detected video on the TV. */
export async function castVideo(renderer: Renderer, candidate: VideoCandidate): Promise<void> {
  const url = await tvUrlFor(candidate.url, castHeaders(candidate));
  await castUrl(renderer, url, candidate.title || 'MayLo');
}
