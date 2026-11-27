import type { CastTarget } from '../browser/cast-target';
import { proxiedUrls } from '../proxy';
import { sendCommand } from '../receiver/receiver-client';
import { STREAM_HEADERS } from './client';
import { youtubeLoad, type HlsAudio } from './master';
import { YOUTUBE_MESSAGES } from './messages';
import { resolveYoutube } from './resolve';

/**
 * Casts a YouTube video (S2v, S4): resolved on the phone at cast time (also for
 * queued items, which keep only the watch URL). One proxy session serves the
 * chosen video and audio media playlists (the proxy rewrites their segments),
 * and the filtered master goes to the TV browser receiver inline in the load
 * command. DLNA renderers cannot play separate audio and video.
 *
 * A dubbed video plays its original audio; with `chooseAudio` (the cast sheet)
 * the user picks the language first when there are several. It answers the
 * chosen track's id (or URI), or null to cancel the cast (then this answers false).
 */
export type ChooseAudio = (tracks: HlsAudio[]) => Promise<string | null>;

export async function castYoutube(
  target: CastTarget,
  videoId: string,
  title: string,
  chooseAudio?: ChooseAudio,
): Promise<boolean> {
  if (target.kind === 'dlna') throw new Error(YOUTUBE_MESSAGES.dlna);
  const resolved = await resolveYoutube(videoId);
  let streams = resolved.streams;
  if (chooseAudio && resolved.audioTracks.length > 1) {
    const audioId = await chooseAudio(resolved.audioTracks);
    if (audioId == null) return false;
    streams = resolved.withAudio(audioId);
  }
  let urls: string[];
  try {
    urls = await proxiedUrls([streams.video.uri, streams.audio.uri], STREAM_HEADERS, '/x.m3u8');
  } catch (cause) {
    // An APK without extra targets refuses the third argument (or has no proxy at all).
    const message = cause instanceof Error ? cause.message : '';
    if (/argument|versión de la app/i.test(message)) throw new Error(YOUTUBE_MESSAGES.update);
    throw cause;
  }
  const load = youtubeLoad(streams, urls);
  await sendCommand({ type: 'load', url: load.url, title: title || resolved.title || 'YouTube', playlists: load.playlists });
  return true;
}
