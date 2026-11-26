import type { CastTarget } from '../browser/cast-target';
import { proxiedUrls } from '../proxy';
import { sendCommand } from '../receiver/receiver-client';
import { STREAM_HEADERS } from './client';
import { youtubeLoad } from './master';
import { YOUTUBE_MESSAGES } from './messages';
import { resolveYoutube } from './resolve';

/**
 * Casts a YouTube video (S2v, S4): resolved on the phone at cast time (also for
 * queued items, which keep only the watch URL). One proxy session serves the
 * chosen video and audio media playlists (the proxy rewrites their segments),
 * and the filtered master goes to the TV browser receiver inline in the load
 * command. DLNA renderers cannot play separate audio and video.
 */
export async function castYoutube(target: CastTarget, videoId: string, title: string): Promise<void> {
  if (target.kind === 'dlna') throw new Error(YOUTUBE_MESSAGES.dlna);
  const resolved = await resolveYoutube(videoId);
  let urls: string[];
  try {
    urls = await proxiedUrls([resolved.streams.video.uri, resolved.streams.audio.uri], STREAM_HEADERS, '/x.m3u8');
  } catch (cause) {
    // An APK without extra targets refuses the third argument (or has no proxy at all).
    const message = cause instanceof Error ? cause.message : '';
    if (/argument|versión de la app/i.test(message)) throw new Error(YOUTUBE_MESSAGES.update);
    throw cause;
  }
  const load = youtubeLoad(resolved.streams, urls);
  await sendCommand({ type: 'load', url: load.url, title: title || resolved.title || 'YouTube', playlists: load.playlists });
}
