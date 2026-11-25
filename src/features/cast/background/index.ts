import TvCast from '../../../../modules/tv-cast';

import {
  createMediaSessionBridge,
  type MediaControls,
  type MediaSessionBridge,
  type NativeMediaSession,
} from './media-actions';

export type { MediaControls, MediaSessionBridge, MediaState } from './media-actions';

/** The native session, or null on iOS, web and APKs built before it existed. */
function nativeMediaSession(): NativeMediaSession | null {
  const module = TvCast;
  if (module?.startMediaSession == null || module.updateMediaSession == null || module.stopMediaSession == null) {
    return null;
  }
  const { startMediaSession, updateMediaSession, stopMediaSession } = module;
  return {
    start: (state) => startMediaSession.call(module, state),
    update: (state) => updateMediaSession.call(module, state),
    stop: () => stopMediaSession.call(module),
    addListener: (listener) => module.addListener('onMediaAction', listener),
  };
}

/**
 * Background control (S5): while connected, the media notification, lock screen and the
 * phone's volume buttons drive `controls`. The first `update` starts the foreground service;
 * `dispose` stops it. A no-op where the native session is missing.
 */
export function connectMediaSession(controls: MediaControls): MediaSessionBridge {
  return createMediaSessionBridge(nativeMediaSession(), controls);
}
