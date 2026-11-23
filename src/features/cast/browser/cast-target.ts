import {
  getMute,
  getVolume,
  pause,
  play,
  positionInfo,
  seek,
  setMute,
  setVolume,
  stop,
  type Renderer,
} from '../dlna-client';
import { readState, sendCommand } from '../receiver/receiver-client';
import { receiverLabel } from '../receiver/receiver-state';

/**
 * Where a video can play: a DLNA TV found on the Wi-Fi, or the TV's own browser
 * with the receiver page open (S5). Both share the sheet and the remote.
 */
export type CastTarget =
  | { kind: 'dlna'; id: string; name: string; renderer: Renderer }
  | { kind: 'receiver'; id: string; name: string; address: string };

export const dlnaTarget = (renderer: Renderer): CastTarget => ({
  kind: 'dlna',
  id: renderer.controlUrl,
  name: renderer.name,
  renderer,
});

export const receiverTarget = (address: string): CastTarget => ({
  kind: 'receiver',
  id: 'tv-browser-receiver',
  name: receiverLabel(address),
  address,
});

/** One poll of the remote. Fields left undefined are not reported by that kind of TV. */
export type Playback = {
  position: number | null;
  duration: number | null;
  paused?: boolean;
  volume?: number | null;
  muted?: boolean;
  /** The TV could not play the video. */
  failed?: boolean;
};

/** The remote's view of a target: every call rejects when the TV fails. */
export type TargetControl = {
  hasVolume: boolean;
  /** Keep polling while paused (the receiver is local and cheap; DLNA TVs are not). */
  pollWhilePaused: boolean;
  /**
   * After a command, polls taken within this window may still show the old play
   * state (the TV page runs commands on its next long-poll answer).
   */
  settleMs: number;
  poll(): Promise<Playback>;
  /** DLNA only: volume and mute read once; the receiver reports them on every poll. */
  readVolume?: () => Promise<{ volume: number | null; muted: boolean | null }>;
  play(): Promise<void>;
  pause(): Promise<void>;
  stop(): Promise<void>;
  seek(seconds: number): Promise<void>;
  setVolume(level: number): Promise<void>;
  setMute(muted: boolean): Promise<void>;
};

function dlnaControl(renderer: Renderer): TargetControl {
  return {
    hasVolume: renderer.renderingControlUrl != null,
    pollWhilePaused: false,
    settleMs: 0,
    poll: () => positionInfo(renderer),
    readVolume: async () => {
      const [volume, muted] = await Promise.all([
        getVolume(renderer).catch(() => null),
        getMute(renderer).catch(() => null),
      ]);
      return { volume, muted };
    },
    play: () => play(renderer),
    pause: () => pause(renderer),
    stop: () => stop(renderer),
    seek: (seconds) => seek(renderer, seconds),
    setVolume: (level) => setVolume(renderer, level),
    setMute: (muted) => setMute(renderer, muted),
  };
}

const receiverControl: TargetControl = {
  hasVolume: true,
  pollWhilePaused: true,
  settleMs: 2000,
  poll: async () => {
    const report = await readState();
    // Same wording as a DLNA timeout, so the remote shows its usual "no contesta" text.
    if (!report.connected) throw new Error('la TV no respondió');
    const playback = report.playback;
    if (!playback) return { position: null, duration: null };
    return {
      position: playback.position,
      duration: playback.duration,
      paused: playback.status !== 'playing' && playback.status !== 'loading',
      volume: playback.volume,
      muted: playback.muted,
      failed: playback.status === 'error',
    };
  },
  play: () => sendCommand({ type: 'play' }),
  pause: () => sendCommand({ type: 'pause' }),
  stop: () => sendCommand({ type: 'stop' }),
  seek: (seconds) => sendCommand({ type: 'seek', seconds }),
  setVolume: (level) => sendCommand({ type: 'volume', level }),
  setMute: (muted) => sendCommand({ type: 'mute', muted }),
};

export function controlFor(target: CastTarget): TargetControl {
  return target.kind === 'dlna' ? dlnaControl(target.renderer) : receiverControl;
}
