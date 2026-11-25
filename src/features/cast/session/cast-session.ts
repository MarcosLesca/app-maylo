import { useSyncExternalStore } from 'react';

import { recordHistory } from '../browser/history-api';
import { toHistoryEntry } from '../browser/history';
import { videoKindLabel } from '../browser/candidates';
import { controlFor, type CastTarget, type Playback, type TargetControl } from '../browser/cast-target';
import { castVideo } from '../browser/cast-video';
import { stopProxy } from '../proxy';
import { holdReceiver } from '../receiver/receiver-client';
import { clampSeek } from '../time';
import { deleteProgress, saveProgress } from './progress-api';
import { progressAction, progressKey, shouldSaveProgress } from './progress-rules';
import { claimNextQueued, getQueue, refreshQueue, type QueueItem } from './queue-api';
import { afterPlaybackEnds, queueCandidate, type NextEpisode } from './queue-rules';
import { classifyReport, endedNow } from './session-rules';

/**
 * Cast session controller (D1): module state that lives as long as the app
 * process. It owns the active target and the current item, polls the TV while a
 * cast is active (also with the remote sheet closed), saves "seguir viendo"
 * positions (D3), records the shared history (D5) and, when a cast ends, claims
 * the next queued video (D2) or offers the page's next episode (D4).
 *
 * API for other code (e.g. the native MediaSession bridge):
 *   castSession.subscribe(listener) -> unsubscribe   // called on every state change
 *   castSession.getState(): CastSessionState          // { active, title, sender?, playing,
 *                                                     //   position, duration, volume?, ended, ... }
 *   castSession.play() / pause() / seekBy(seconds) / changeVolume(delta) / stop()
 * Actions are no-ops without an active session and never throw (failures land in
 * `error`). `stop()` stops the TV, revokes the proxy and ends the session.
 */

/** What the phone cast: the page it came from and how to show it. */
export type CastItem = {
  /** The title sent to the TV (the receiver reports it back). */
  title: string;
  /** Top page URL: progress key, history and "Abrí la página". */
  pageUrl: string;
  /** Top page title for the history; the title when missing. */
  pageTitle?: string;
  /** "Video HLS" etc. */
  kind?: string;
  /** Who added it (queued videos). */
  sender?: string;
  /** The page's next-episode link (D4), offered when the cast ends with an empty queue. */
  nextEpisode?: NextEpisode | null;
  /** Seek here once playback starts (the user chose "Seguir"). */
  resumeFrom?: number | null;
  /** Came from the shared queue: a failure shows "No se pudo reproducir…". */
  queued?: boolean;
};

export type CastSessionState = {
  active: boolean;
  targetId: string | null;
  targetName: string;
  title: string;
  kind: string;
  sender?: string;
  playing: boolean;
  position: number | null;
  duration: number | null;
  volume?: number | null;
  muted?: boolean;
  ended: boolean;
  failed: boolean;
  /** A queued video that could not be played: its page, to send it again from there. */
  queueFailure: { title: string; pageUrl: string } | null;
  /** The next episode to open, offered after the end with an empty queue. */
  nextEpisode: NextEpisode | null;
  /** Last action failure (plain Spanish), cleared by the next action. */
  error: string | null;
  /** Bumped by castSession.stop() (e.g. from the notification), so an open remote can close. */
  stops: number;
};

const IDLE: CastSessionState = {
  active: false,
  targetId: null,
  targetName: '',
  title: '',
  kind: '',
  playing: false,
  position: null,
  duration: null,
  ended: false,
  failed: false,
  queueFailure: null,
  nextEpisode: null,
  error: null,
  stops: 0,
};

const POLL_MS = 1000;
const POLL_PAUSED_MS = 3000;
/** Polls reused by the remote within this window instead of asking the TV again. */
const SHARED_POLL_MS = 800;
/** About two minutes without answers ends the session (the TV is gone). */
const MAX_FAILURES = 120;
/** After a resume seek, positions may still be the old ones for a moment. */
const RESUME_SETTLE_MS = 5000;

type Session = {
  token: number;
  target: CastTarget;
  control: TargetControl;
  item: CastItem;
  /** Polls before this time may still show the previous video (the receiver's long poll). */
  settleUntil: number;
  wasEnded: boolean;
  /** The TV reported this item's title at least once (receiver; always true for DLNA). */
  confirmed: boolean;
  resumed: boolean;
  noSaveUntil: number;
  lastSavedAt: number;
  progressDeleted: boolean;
  failures: number;
  timer: ReturnType<typeof setTimeout> | null;
  inFlight: Promise<Playback> | null;
  last: { at: number; info: Playback } | null;
  releaseReceiver: (() => void) | null;
  advancing: boolean;
};

let state: CastSessionState = IDLE;
let session: Session | null = null;
let nextToken = 1;
const listeners = new Set<() => void>();

function setState(patch: Partial<CastSessionState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

const errorText = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

function itemPatch(target: CastTarget, item: CastItem): Partial<CastSessionState> {
  return {
    active: true,
    targetId: target.id,
    targetName: target.name,
    title: item.title,
    kind: item.kind ?? '',
    sender: item.sender,
    playing: false,
    position: null,
    duration: null,
    ended: false,
    failed: false,
    queueFailure: null,
    nextEpisode: null,
    error: null,
  };
}

/** Holds the receiver server; a start failure is the remote's to report, not an unhandled rejection. */
function holdReceiverQuietly(): () => void {
  const hold = holdReceiver();
  hold.address.catch(() => undefined);
  return hold.release;
}

function record(item: CastItem) {
  const entry = toHistoryEntry(item.pageUrl, item.pageTitle || item.title);
  if (entry) recordHistory(entry).catch(() => undefined);
}

function freshSession(target: CastTarget, item: CastItem, releaseReceiver: (() => void) | null): Session {
  const control = controlFor(target);
  return {
    token: nextToken++,
    target,
    control,
    item,
    settleUntil: Date.now() + control.settleMs,
    wasEnded: false,
    confirmed: target.kind !== 'receiver',
    resumed: !item.resumeFrom,
    noSaveUntil: 0,
    lastSavedAt: Date.now(),
    progressDeleted: false,
    failures: 0,
    timer: null,
    inFlight: null,
    last: null,
    releaseReceiver,
    advancing: false,
  };
}

/**
 * Starts (or replaces) the session after the phone cast `item` to `target`.
 * The cast itself is done by the caller (castVideo); this only follows it.
 */
export function startCastSession(target: CastTarget, item: CastItem): void {
  const previous = session;
  // Keep the receiver running while it plays, also after leaving the browser screen.
  const release =
    target.kind === 'receiver'
      ? previous?.target.kind === 'receiver' && previous.releaseReceiver
        ? previous.releaseReceiver
        : holdReceiverQuietly()
      : null;
  if (previous) {
    if (previous.timer) clearTimeout(previous.timer);
    if (previous.releaseReceiver && previous.releaseReceiver !== release) previous.releaseReceiver();
  }
  session = freshSession(target, item, release);
  setState(itemPatch(target, item));
  record(item);
  refreshQueue().catch(() => undefined);
  readVolumeOnce(session);
  schedule(session, 0);
}

/** Ends the session without touching the TV (the remote already stopped it, or it moved on). */
export function endCastSession(options: { saveProgress?: boolean } = {}): void {
  const current = session;
  if (!current) return;
  if (options.saveProgress) persistProgress(current, state, true);
  if (current.timer) clearTimeout(current.timer);
  current.releaseReceiver?.();
  session = null;
  setState({ ...IDLE, stops: state.stops });
}

export const isCastSessionActive = () => session != null;

/** The target of the active session (to reopen its remote), or null. */
export const castSessionTarget = (): CastTarget | null => session?.target ?? null;

/** Clears the next-episode offer / queue failure once the user acted on it. */
export function dismissCastOffer(): void {
  setState({ nextEpisode: null, queueFailure: null });
}

function readVolumeOnce(current: Session) {
  const read = current.control.readVolume;
  if (!current.control.hasVolume || !read) return;
  read()
    .then(({ volume, muted }) => {
      if (session !== current) return;
      setState({ ...(volume != null ? { volume } : {}), ...(muted != null ? { muted } : {}) });
    })
    .catch(() => undefined);
}

function schedule(current: Session, delay: number) {
  if (current.timer) clearTimeout(current.timer);
  current.timer = setTimeout(() => tick(current), delay);
}

function pollOnce(current: Session): Promise<Playback> {
  if (current.inFlight) return current.inFlight;
  if (current.last && Date.now() - current.last.at < SHARED_POLL_MS) return Promise.resolve(current.last.info);
  const request = current.control.poll();
  current.inFlight = request;
  request
    .then((info) => {
      current.last = { at: Date.now(), info };
    })
    .catch(() => undefined)
    .finally(() => {
      current.inFlight = null;
    });
  return request;
}

/**
 * One poll of `target` for the remote: shared with the session when it follows
 * the same TV (one request per second, not two), else a plain poll of `control`.
 */
export function pollTarget(target: CastTarget, control: TargetControl): Promise<Playback> {
  const current = session;
  if (current && current.target.id === target.id) return pollOnce(current);
  return control.poll();
}

async function tick(current: Session) {
  if (session !== current) return;
  try {
    const info = await pollOnce(current);
    if (session !== current) return;
    current.failures = 0;
    await onPoll(current, info);
  } catch {
    if (session !== current) return;
    current.failures += 1;
    if (current.failures >= MAX_FAILURES) {
      endCastSession({ saveProgress: true });
      return;
    }
  }
  if (session !== current) return;
  const fast = state.playing || current.control.pollWhilePaused;
  schedule(current, fast ? POLL_MS : POLL_PAUSED_MS);
}

function persistProgress(current: Session, view: CastSessionState, force: boolean) {
  const key = progressKey(current.item.pageUrl, current.item.title);
  if (!key) return;
  const action = progressAction({ position: view.position, duration: view.duration, ended: view.ended });
  if (action === 'delete') {
    if (current.progressDeleted) return;
    current.progressDeleted = true;
    deleteProgress(key).catch(() => undefined);
    return;
  }
  if (action !== 'save' || view.position == null) return;
  const now = Date.now();
  if (!current.resumed || now < current.noSaveUntil) return; // Do not overwrite the saved spot before the resume seek.
  if (!force && !shouldSaveProgress(current.lastSavedAt, now)) return;
  current.lastSavedAt = now;
  saveProgress({
    key,
    pageUrl: current.item.pageUrl,
    title: current.item.title,
    position: view.position,
    duration: view.duration,
  }).catch(() => undefined);
}

async function onPoll(current: Session, info: Playback) {
  if (Date.now() < current.settleUntil) return;
  if (current.target.kind === 'receiver') {
    const report = classifyReport({ title: current.item.title, reportedTitle: info.title, confirmed: current.confirmed });
    if (report === 'stale') return; // Still the previous video: the TV has not run our load yet.
    if (report === 'superseded') {
      // The other phone loaded something else on the TV: its session follows it now.
      endCastSession({ saveProgress: true });
      return;
    }
    if (info.title?.trim()) current.confirmed = true;
  }
  const playing = !info.ended && !info.failed && info.paused !== true && info.position != null;
  const failed = info.failed === true;
  setState({
    position: info.position,
    duration: info.duration,
    playing,
    ended: info.ended,
    failed,
    ...(info.volume != null ? { volume: info.volume } : {}),
    ...(info.muted != null ? { muted: info.muted } : {}),
    ...(info.from && current.target.kind === 'receiver' ? { sender: info.from } : {}),
    ...(failed && current.item.queued && !state.queueFailure
      ? { queueFailure: { title: current.item.title, pageUrl: current.item.pageUrl } }
      : {}),
  });

  if (!current.resumed && playing && current.item.resumeFrom) {
    current.resumed = true;
    current.noSaveUntil = Date.now() + RESUME_SETTLE_MS;
    const to = clampSeek(current.item.resumeFrom, info.duration);
    current.control.seek(to).catch(() => undefined);
  }

  if (playing || info.ended) persistProgress(current, state, false);

  const justEnded = endedNow(current.wasEnded, info.ended);
  current.wasEnded = info.ended;
  if (justEnded) await onEnded(current);
}

async function onEnded(current: Session) {
  if (current.advancing) return;
  current.advancing = true;
  try {
    const queue = await refreshQueue().catch(() => getQueue().items);
    const decision = afterPlaybackEnds({ queueLength: queue.length, nextEpisode: current.item.nextEpisode ?? null });
    if (session !== current) return;
    if (decision.kind === 'offer-next') {
      setState({ nextEpisode: current.item.nextEpisode ?? null });
      return;
    }
    if (decision.kind !== 'advance') return;
    const next = await claimNextQueued().catch(() => null);
    // Null: the other phone claimed it first and casts it.
    if (next && session === current) await castQueued(current, next);
  } finally {
    current.advancing = false;
  }
}

async function castQueued(current: Session, row: QueueItem) {
  const item: CastItem = {
    title: row.title,
    pageUrl: row.page_url,
    kind: videoKindLabel(row.video_url),
    sender: getQueue().names[row.created_by],
    queued: true,
  };
  try {
    await castVideo(current.target, queueCandidate(row));
  } catch {
    if (session === current) setState({ queueFailure: { title: row.title, pageUrl: row.page_url } });
    return;
  }
  if (session !== current) return;
  // Same target, new video: a fresh control (DLNA "played" flag) and fresh progress bookkeeping.
  const next = freshSession(current.target, item, current.releaseReceiver);
  current.releaseReceiver = null;
  if (current.timer) clearTimeout(current.timer);
  session = next;
  setState(itemPatch(next.target, item));
  record(item);
  readVolumeOnce(next);
  schedule(next, 0);
}

async function act(action: (current: Session) => Promise<void>) {
  const current = session;
  if (!current) return;
  setState({ error: null });
  try {
    await action(current);
    current.settleUntil = Date.now() + current.control.settleMs;
  } catch (cause) {
    if (session === current) setState({ error: errorText(cause) });
  }
}

export const castSession = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getState: (): CastSessionState => state,
  play: () =>
    act(async (current) => {
      await current.control.play();
      setState({ playing: true });
    }),
  pause: () =>
    act(async (current) => {
      await current.control.pause();
      setState({ playing: false });
    }),
  /** Relative jump, clamped inside the video (e.g. ±10 s). */
  seekBy: (seconds: number) =>
    act(async (current) => {
      const to = clampSeek((state.position ?? 0) + seconds, state.duration);
      await current.control.seek(to);
      setState({ position: to });
    }),
  /** Volume step (0-100 scale); no-op when the TV does not report its volume. */
  changeVolume: (delta: number) =>
    act(async (current) => {
      if (!current.control.hasVolume || state.volume == null) return;
      const level = Math.min(100, Math.max(0, state.volume + delta));
      if (level === state.volume) return;
      await current.control.setVolume(level);
      setState({ volume: level });
    }),
  /** Stops the TV, revokes the proxy and ends the session. */
  stop: async () => {
    const current = session;
    if (!current) return;
    await current.control.stop().catch(() => undefined);
    await stopProxy().catch(() => undefined);
    if (session !== current) return;
    endCastSession({ saveProgress: true });
    setState({ stops: state.stops + 1 });
  },
};

/** The session state for a component (re-renders on every change). */
export function useCastSession(): CastSessionState {
  return useSyncExternalStore(castSession.subscribe, castSession.getState);
}
