/**
 * Links the cast session (D1) to the native media session (S5, D8): while a cast is
 * active the notification, lock screen and volume buttons control it. Pure: the
 * session and the bridge factory are injected, so it runs under node:test.
 */

/** The part of the cast session state the notification shows. */
export type LinkedState = {
  active: boolean;
  title: string;
  targetName: string;
  sender?: string;
  playing: boolean;
  position: number | null;
  duration: number | null;
};

export type LinkedMediaState = {
  title: string;
  subtitle: string;
  playing: boolean;
  position: number | null;
  duration: number | null;
};

type Session = {
  getState(): LinkedState;
  subscribe(listener: () => void): () => unknown;
};

type Bridge = { update(state: LinkedMediaState): void; dispose(): void };

/** Title and "Enviado por <name>" (or the TV) for the notification. */
export function mediaStateOf(state: LinkedState): LinkedMediaState {
  const subtitle = state.sender
    ? `Enviado por ${state.sender}`
    : state.targetName
      ? `En ${state.targetName}`
      : 'En la tele';
  return {
    title: state.title,
    subtitle,
    playing: state.playing,
    position: state.position,
    duration: state.duration,
  };
}

/**
 * Connects a bridge when the session becomes active (the cast starts from a tap, so the
 * app is in the foreground, as Android requires for the service), updates it on every
 * change and disposes it when the session ends. Returns the unlink function.
 */
export function linkMediaSession(session: Session, connect: () => Bridge): () => void {
  let bridge: Bridge | null = null;
  const sync = () => {
    const state = session.getState();
    if (!state.active) {
      bridge?.dispose();
      bridge = null;
      return;
    }
    bridge ??= connect();
    bridge.update(mediaStateOf(state));
  };
  const unsubscribe = session.subscribe(sync);
  sync();
  return () => {
    unsubscribe();
    bridge?.dispose();
    bridge = null;
  };
}
