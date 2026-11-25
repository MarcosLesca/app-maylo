/**
 * Background control (S5, D8): maps the native media session's actions (notification,
 * lock screen, headset, volume buttons) to the cast controls, and the cast state to the
 * payload the native session shows. Pure: the native module is injected.
 */

/** What the cast controller exposes; calls may return a promise, whose rejection is swallowed here. */
export type MediaControls = {
  play(): unknown;
  pause(): unknown;
  seekBy(seconds: number): unknown;
  changeVolume(delta: number): unknown;
  stop(): unknown;
};

/** The cast state shown in the notification, in seconds like `Playback`. */
export type MediaState = {
  title?: string;
  /** Who sent the video, e.g. "Enviado por May". */
  subtitle?: string;
  playing?: boolean;
  position?: number | null;
  duration?: number | null;
};

/** The payload `startMediaSession` / `updateMediaSession` take (milliseconds). */
export type NativeMediaState = {
  title?: string;
  subtitle?: string;
  playing?: boolean;
  positionMs?: number;
  durationMs?: number;
};

/** The `onMediaAction` event the native session sends. */
export type MediaAction =
  | { action: 'play' | 'pause' | 'stop' }
  | { action: 'seekBy'; seconds: number }
  | { action: 'volume'; direction: 1 | -1 };

/** The native session as the bridge needs it; null when the APK lacks it (or not Android). */
export type NativeMediaSession = {
  start(state: NativeMediaState): Promise<unknown>;
  update(state: NativeMediaState): Promise<unknown>;
  stop(): Promise<unknown>;
  addListener(listener: (event: unknown) => void): { remove(): void };
};

export type MediaSessionBridge = {
  /** Merges `state` into the shown one; the first call starts the session (and the foreground service). */
  update(state: MediaState): void;
  /** Stops listening and ends the session; idempotent. */
  dispose(): void;
};

/** Volume change per hardware button press, the same step as the remote's volume buttons. */
export const VOLUME_STEP = 1;

const swallow = (result: unknown) => {
  if (result != null && typeof (result as PromiseLike<unknown>).then === 'function') {
    Promise.resolve(result).catch(() => undefined);
  }
};

/** Calls the control for `event`; false (nothing called) when the event is malformed or unknown. */
export function dispatchMediaAction(event: unknown, controls: MediaControls): boolean {
  if (event == null || typeof event !== 'object') return false;
  const { action, seconds, direction } = event as { action?: unknown; seconds?: unknown; direction?: unknown };
  switch (action) {
    case 'play':
      swallow(controls.play());
      return true;
    case 'pause':
      swallow(controls.pause());
      return true;
    case 'stop':
      swallow(controls.stop());
      return true;
    case 'seekBy':
      if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds === 0) return false;
      swallow(controls.seekBy(seconds));
      return true;
    case 'volume':
      if (direction !== 1 && direction !== -1) return false;
      swallow(controls.changeVolume(direction * VOLUME_STEP));
      return true;
    default:
      return false;
  }
}

/** Seconds become whole milliseconds; unknown values are left out (the native side keeps the last ones). */
export function toNativeState(state: MediaState): NativeMediaState {
  const payload: NativeMediaState = {};
  if (typeof state.title === 'string') payload.title = state.title;
  if (typeof state.subtitle === 'string') payload.subtitle = state.subtitle;
  if (typeof state.playing === 'boolean') payload.playing = state.playing;
  if (typeof state.position === 'number' && Number.isFinite(state.position)) {
    payload.positionMs = Math.max(0, Math.round(state.position * 1000));
  }
  if (typeof state.duration === 'number' && Number.isFinite(state.duration) && state.duration > 0) {
    payload.durationMs = Math.round(state.duration * 1000);
  }
  return payload;
}

const noop: MediaSessionBridge = { update: () => undefined, dispose: () => undefined };

export function createMediaSessionBridge(
  native: NativeMediaSession | null,
  controls: MediaControls,
): MediaSessionBridge {
  if (native == null) return noop;
  let shown: NativeMediaState = {};
  let started = false;
  let starting = false;
  let dirty = false;
  let disposed = false;
  const subscription = native.addListener((event) => {
    if (!disposed) dispatchMediaAction(event, controls);
  });

  const start = () => {
    starting = true;
    dirty = false;
    native.start(shown).then(
      () => {
        starting = false;
        if (disposed) return;
        started = true;
        if (dirty) native.update(shown).catch(() => undefined);
      },
      () => {
        starting = false; // e.g. foreground service not allowed now: the next update retries.
      },
    );
  };

  return {
    update(state) {
      if (disposed) return;
      shown = { ...shown, ...toNativeState(state) };
      if (started) native.update(shown).catch(() => undefined);
      else if (starting) dirty = true;
      else start();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      subscription.remove();
      native.stop().catch(() => undefined);
    },
  };
}
