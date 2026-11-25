import type { CastTarget } from '../browser/cast-target';
import { proxiedUrls } from '../proxy';
import { sendCommand } from '../receiver/receiver-client';
import { GOOGLEVIDEO_HEADERS } from './client';
import { YOUTUBE_MESSAGES } from './formats';
import { youtubeLoad } from './playlist';
import { resolveYoutube } from './resolve';

/**
 * Casts a YouTube video (S3, S4): resolved on the phone at cast time (also for
 * queued items, which keep only the watch URL), both streams served by one
 * proxy session, and the playlists handed to the TV browser receiver in the
 * load command. DLNA renderers cannot play separate audio and video.
 */
export async function castYoutube(target: CastTarget, videoId: string, title: string): Promise<void> {
  if (target.kind === 'dlna') throw new Error(YOUTUBE_MESSAGES.dlna);
  const resolved = await resolveYoutube(videoId);
  let urls: string[];
  try {
    urls = await proxiedUrls([resolved.video.format.url, resolved.audio.format.url], GOOGLEVIDEO_HEADERS);
  } catch (cause) {
    // An APK without extra targets refuses the third argument (or has no proxy at all).
    const message = cause instanceof Error ? cause.message : '';
    if (/argument|versión de la app/i.test(message)) throw new Error(YOUTUBE_MESSAGES.update);
    throw cause;
  }
  const load = youtubeLoad({
    video: { url: urls[0], format: resolved.video.format, segments: resolved.video.segments },
    audio: { url: urls[1], format: resolved.audio.format, segments: resolved.audio.segments },
  });
  await sendCommand({ type: 'load', url: load.url, title: title || resolved.title || 'YouTube', playlists: load.playlists });
}
