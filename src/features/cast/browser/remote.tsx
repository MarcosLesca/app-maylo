import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon, type IconName } from '@/components/icon';
import { stopProxy } from '@/features/cast/proxy';
import { dismissCastOffer, endCastSession, pollTarget, useCastSession } from '@/features/cast/session/cast-session';
import { removeFromQueue, useCastQueue } from '@/features/cast/session/queue-api';
import { QUEUE_FAILURE_MESSAGE, queuedByText } from '@/features/cast/session/queue-rules';
import { clampSeek } from '@/features/cast/time';
import { ReactionBar } from '@/features/reactions';
import { useTheme } from '@/hooks/use-theme';

import { castErrorMessage } from './candidates';
import { controlFor, type CastTarget } from './cast-target';
import { remoteSubtitle } from './now-playing';
import { receiverFailureText } from './remote-failure';
import { RemoteProgress } from './remote-progress';

type Props = {
  /** False while the sheet is closed: polling stops. */
  visible: boolean;
  /** A DLNA TV or the TV browser receiver; same UI for both. */
  target: CastTarget;
  title: string;
  /** "Video MP4" / "Video HLS"; '' when another phone cast it. */
  kind: string;
  /** Who sent the video to the TV browser receiver ('' when unknown); the receiver's reports update it. */
  from?: string;
  /** Called after the TV stopped (Detener). */
  onStopped: () => void;
  /** Back to the TV list; the current TV is stopped first. */
  onPickAnother: () => void;
  /** Opens a page in the in-app browser ("Abrir la página", "Siguiente episodio"). */
  onOpenPage?: (url: string) => void;
};

type Command = 'pause' | 'seek' | 'volume' | 'mute' | 'stop' | 'other';

const POLL_MS = 1000;
const SKIP_S = 10;
/** Queue rows shown in the sheet (it does not scroll). */
const QUEUE_SHOWN = 3;
/** Consecutive failed polls before the remote says it lost the TV. */
const POLL_FAILURES = 3;

/** Plain Spanish for a failed remote command; timeouts and Wi-Fi errors keep the shared wording. */
function remoteErrorMessage(cause: unknown, command: Command): string {
  const message = cause instanceof Error ? cause.message : '';
  if (/no respondió|network request failed/i.test(message)) return castErrorMessage(cause);
  if (/no deja cambiar el volumen/i.test(message)) return message;
  switch (command) {
    case 'pause':
      return 'La tele no hizo caso a la pausa. Probá de nuevo.';
    case 'seek':
      return 'La tele no dejó mover el video a ese punto. Probá de nuevo.';
    case 'volume':
    case 'mute':
      return 'La tele no dejó cambiar el volumen. Probá con el control de la tele.';
    case 'stop':
      return 'La tele no se detuvo. Probá de nuevo o usá el control de la tele.';
    default:
      return 'Algo salió mal con la tele. Probá de nuevo.';
  }
}

/** The sheet after casting: progress, ±10 s, pause, volume and stop. */
export function CastRemote({ visible, target, title, kind, from = '', onStopped, onPickAnother, onOpenPage }: Props) {
  const theme = useTheme();
  // The session controller follows this phone's cast (queue advance, progress, next episode).
  const session = useCastSession();
  const mine = session.active && session.targetId === target.id;
  const queue = useCastQueue();
  const [removing, setRemoving] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const [paused, setPaused] = useState(false);
  const [position, setPosition] = useState<number | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [volume, setVolumeLevel] = useState<number | null>(null);
  const [muted, setMuted] = useState(false);
  const [busy, setBusy] = useState<Command | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lostTv, setLostTv] = useState(false);
  const [failed, setFailed] = useState(false);
  // With the receiver's last hls.js error appended when it reports one (S6).
  const [failureText, setFailureText] = useState(receiverFailureText);
  // What the receiver reports it shows (S8): another phone may have loaded a new video meanwhile.
  const [shown, setShown] = useState({ title, from });
  // Refs, not state: the lock must hold between two taps in the same frame.
  const commandRunning = useRef(false);
  const pollInFlight = useRef<Promise<void> | null>(null);
  // Until this time a poll may still show the state from before the last command.
  const settleUntil = useRef(0);
  const control = useMemo(() => controlFor(target), [target]);
  const hasVolume = control.hasVolume;

  /** One poll at a time, skipped while a command runs; rejects when the TV fails. */
  const poll = useCallback(async () => {
    if (commandRunning.current || pollInFlight.current) return;
    const request = pollTarget(target, control).then((info) => {
      if (commandRunning.current) return; // A command is moving the video; its result wins.
      setDuration(info.duration);
      setLostTv(false);
      if (Date.now() < settleUntil.current) return;
      setPosition(info.position);
      if (info.paused != null) setPaused(info.paused);
      if (info.volume !== undefined && info.volume !== null) setVolumeLevel(info.volume);
      if (info.muted != null) setMuted(info.muted);
      if (info.failed != null) setFailed(info.failed);
      setFailureText(receiverFailureText(info.errorDetail));
      setEnded(info.ended);
      const reportedTitle = info.title?.trim();
      if (reportedTitle) {
        const reportedFrom = info.from ?? '';
        setShown((current) =>
          current.title === reportedTitle && current.from === reportedFrom
            ? current
            : { title: reportedTitle, from: reportedFrom },
        );
      }
    });
    pollInFlight.current = request
      .catch(() => undefined)
      .finally(() => {
        pollInFlight.current = null;
      });
    await request;
  }, [control, target]);

  // Stopped from outside the sheet (the notification): close the remote like Detener does.
  const stops = useRef(session.stops);
  useEffect(() => {
    if (session.stops === stops.current) return;
    stops.current = session.stops;
    onStopped();
  }, [session.stops, onStopped]);

  // Position: once when shown, then every second while playing (also while paused on the
  // receiver, whose state lives on the phone); nothing while hidden.
  const keepPolling = !paused || control.pollWhilePaused;

  // The receiver runs the load sent by the sheet on its next long-poll answer: until then
  // its reported state is the previous one.
  useEffect(() => {
    settleUntil.current = Date.now() + control.settleMs;
  }, [control]);
  useEffect(() => {
    if (!visible) return;
    let active = true;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        await poll();
        failures = 0;
      } catch {
        failures += 1;
        if (active && failures >= POLL_FAILURES) setLostTv(true);
      }
      if (active && keepPolling) timer = setTimeout(tick, POLL_MS);
    };
    tick();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [visible, keepPolling, poll]);

  // Volume and mute: read once per DLNA TV, only when it exposes RenderingControl.
  useEffect(() => {
    const readVolume = control.readVolume;
    if (!hasVolume || !readVolume) return;
    let active = true;
    readVolume().then(({ volume: level, muted: isMuted }) => {
      if (!active) return;
      if (level != null) setVolumeLevel(level);
      if (isMuted != null) setMuted(isMuted);
    });
    return () => {
      active = false;
    };
  }, [control, hasVolume]);

  // One command at a time, never overlapping a position poll.
  const run = async (command: Command, action: () => Promise<void>) => {
    if (commandRunning.current) return;
    commandRunning.current = true;
    setBusy(command);
    setError(null);
    try {
      await pollInFlight.current;
      await action();
      settleUntil.current = Date.now() + control.settleMs;
    } catch (cause) {
      setError(remoteErrorMessage(cause, command));
    } finally {
      commandRunning.current = false;
      setBusy(null);
    }
  };

  const seekTo = (seconds: number) =>
    run('seek', async () => {
      const to = clampSeek(seconds, duration);
      await control.seek(to);
      setPosition(to);
    });

  const skip = (delta: number) => seekTo((position ?? 0) + delta);

  const togglePause = () =>
    run('pause', async () => {
      await (paused ? control.play() : control.pause());
      setPaused(!paused);
    });

  const changeVolume = (delta: number) =>
    volume != null &&
    run('volume', async () => {
      const level = Math.min(100, Math.max(0, volume + delta));
      if (level === volume) return;
      await control.setVolume(level);
      setVolumeLevel(level);
    });

  const toggleMute = () =>
    run('mute', async () => {
      await control.setMute(!muted);
      setMuted(!muted);
    });

  const stopPlaying = () =>
    run('stop', async () => {
      try {
        await control.stop();
      } finally {
        // Revoke the proxy session even if the TV did not answer, so its token stops working.
        await stopProxy().catch(() => undefined);
        if (mine) endCastSession({ saveProgress: true });
      }
      onStopped();
    });

  const pickAnother = () =>
    run('other', async () => {
      await control.stop().catch(() => undefined); // Leaving it playing on the old TV is never wanted.
      await stopProxy().catch(() => undefined);
      if (mine) endCastSession({ saveProgress: true });
      onPickAnother();
    });

  const openPage = (url: string) => {
    dismissCastOffer();
    onOpenPage?.(url);
  };

  const removeQueued = async (id: string) => {
    if (removing) return;
    setRemoving(id);
    setError(null);
    try {
      await removeFromQueue(id);
    } catch {
      setError('No se pudo quitar de la cola. Probá de nuevo.');
    } finally {
      setRemoving(null);
    }
  };

  // A queued video advanced on a DLNA TV: the session knows its title; the receiver reports its own.
  const shownTitle = mine && target.kind === 'dlna' ? session.title : shown.title;
  const shownFrom = mine && session.sender ? session.sender : shown.from;
  const shownKind = mine && session.kind ? session.kind : kind;
  const queueFailure = mine ? session.queueFailure : null;
  const nextEpisode = mine ? session.nextEpisode : null;

  const disabled = busy != null;
  const canSeek = !disabled && duration != null;

  return (
    <View style={styles.remote}>
      <View style={[styles.state, { backgroundColor: theme.successSoft }]}>
        <View style={[styles.dot, { backgroundColor: theme.success }]} />
        <Text accessibilityRole="header" style={[styles.stateText, { color: theme.successText }]}>
          {ended ? `Terminó en ${target.name}` : paused ? `En pausa en ${target.name}` : `Reproduciendo en ${target.name}`}
        </Text>
      </View>

      <View style={[styles.video, { backgroundColor: theme.backgroundElement }]}>
        <View style={[styles.thumb, { backgroundColor: theme.text }]}>
          <Icon name="screen" color={theme.background} size={18} />
        </View>
        <View style={styles.body}>
          <Text numberOfLines={2} style={[styles.videoTitle, { color: theme.text }]}>
            {shownTitle}
          </Text>
          {remoteSubtitle(shownKind, shownFrom) ? (
            <Text style={[styles.small, { color: theme.textSecondary }]}>{remoteSubtitle(shownKind, shownFrom)}</Text>
          ) : null}
        </View>
      </View>

      <RemoteProgress position={position} duration={duration} disabled={disabled} onSeek={seekTo} onSkip={skip} />

      <View style={styles.controls}>
        <RoundButton
          size={60}
          icon="rewind"
          badge="10"
          accessibilityLabel="Retroceder 10 segundos"
          disabled={!canSeek}
          loading={false}
          onPress={() => skip(-SKIP_S)}
        />
        <RoundButton
          size={80}
          main
          icon={paused ? 'play' : 'pause'}
          accessibilityLabel={paused ? 'Seguir reproduciendo' : 'Pausar'}
          disabled={disabled}
          loading={busy === 'pause'}
          onPress={togglePause}
        />
        <RoundButton
          size={60}
          icon="forward"
          badge="10"
          accessibilityLabel="Adelantar 10 segundos"
          disabled={!canSeek}
          loading={false}
          onPress={() => skip(SKIP_S)}
        />
      </View>
      <View style={styles.labels} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Text style={[styles.label, styles.labelSkip, { color: theme.textSecondary }]}>−10 s</Text>
        <Text style={[styles.label, styles.labelMain, { color: theme.textSecondary }]}>
          {paused ? 'Seguir' : 'Pausa'}
        </Text>
        <Text style={[styles.label, styles.labelSkip, { color: theme.textSecondary }]}>+10 s</Text>
      </View>

      {hasVolume ? (
        <View style={[styles.volume, { backgroundColor: theme.backgroundElement }]}>
          <SquareButton
            icon="volumeMute"
            accessibilityRole="switch"
            accessibilityLabel="Silenciar"
            accessibilityState={{ checked: muted, disabled }}
            active={muted}
            disabled={disabled}
            onPress={toggleMute}
          />
          <View style={styles.level}>
            <Text style={[styles.small, { color: theme.textSecondary }]}>
              {volume == null ? 'Volumen' : `Volumen ${volume}`}
              {muted ? ' · silenciado' : ''}
            </Text>
            <View style={[styles.levelBar, { backgroundColor: theme.backgroundSelected }]}>
              <View
                style={[
                  styles.levelFill,
                  { width: `${volume ?? 0}%`, backgroundColor: muted ? theme.textSecondary : theme.accent },
                ]}
              />
            </View>
          </View>
          <SquareButton
            icon="minus"
            accessibilityLabel="Bajar volumen"
            accessibilityState={{ disabled: disabled || volume == null || volume <= 0 }}
            disabled={disabled || volume == null || volume <= 0}
            onPress={() => changeVolume(-1)}
          />
          <SquareButton
            icon="plus"
            accessibilityLabel="Subir volumen"
            accessibilityState={{ disabled: disabled || volume == null || volume >= 100 }}
            disabled={disabled || volume == null || volume >= 100}
            onPress={() => changeVolume(1)}
          />
        </View>
      ) : null}

      {queueFailure ? (
        <View style={styles.offer}>
          <Text accessibilityLiveRegion="polite" style={[styles.muted, styles.body, { color: theme.danger }]}>
            {QUEUE_FAILURE_MESSAGE}
          </Text>
          <PairButton
            label="Abrir la página"
            disabled={false}
            loading={false}
            onPress={() => openPage(queueFailure.pageUrl)}
          />
        </View>
      ) : null}

      {nextEpisode && !queueFailure ? (
        <PairButton
          icon="forward"
          label="Siguiente episodio"
          disabled={false}
          loading={false}
          onPress={() => openPage(nextEpisode.url)}
        />
      ) : null}

      {(error || lostTv || failed) && !(failed && queueFailure && !error && !lostTv) ? (
        <Text accessibilityLiveRegion="polite" style={[styles.muted, { color: theme.danger }]}>
          {error ??
            (lostTv
              ? 'No sabemos en qué parte va el video: la tele no contesta. Revisá que siga prendida y en el mismo Wi-Fi.'
              : failureText)}
        </Text>
      ) : null}

      <View style={styles.pair}>
        <PairButton icon="stop" label="Detener" disabled={disabled} loading={busy === 'stop'} onPress={stopPlaying} />
        <PairButton label="Elegir otra tele" disabled={disabled} loading={busy === 'other'} onPress={pickAnother} />
      </View>

      <ReactionBar />

      {queue.items.length > 0 ? (
        <View style={styles.queue}>
          <Text accessibilityRole="header" style={[styles.queueTitle, { color: theme.text }]}>
            En cola
          </Text>
          {queue.items.slice(0, QUEUE_SHOWN).map((item) => {
            const by = queuedByText(queue.names[item.created_by] ?? '');
            return (
              <View key={item.id} style={[styles.queueRow, { backgroundColor: theme.backgroundElement }]}>
                <View style={styles.body}>
                  <Text numberOfLines={1} style={[styles.queueItemTitle, { color: theme.text }]}>
                    {item.title}
                  </Text>
                  {by ? <Text style={[styles.small, { color: theme.textSecondary }]}>{by}</Text> : null}
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Quitar “${item.title}” de la cola`}
                  accessibilityState={{ busy: removing === item.id }}
                  disabled={removing != null}
                  onPress={() => removeQueued(item.id)}
                  style={({ pressed }) => [styles.queueRemove, { opacity: pressed || removing === item.id ? 0.6 : 1 }]}>
                  {removing === item.id ? (
                    <ActivityIndicator color={theme.textSecondary} />
                  ) : (
                    <Icon name="close" color={theme.textSecondary} size={18} />
                  )}
                </Pressable>
              </View>
            );
          })}
          {queue.items.length > QUEUE_SHOWN ? (
            <Text style={[styles.small, { color: theme.textSecondary }]}>
              {`y ${queue.items.length - QUEUE_SHOWN} más`}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

type RoundButtonProps = {
  size: number;
  main?: boolean;
  icon: IconName;
  badge?: string;
  accessibilityLabel: string;
  disabled: boolean;
  loading: boolean;
  onPress: () => void;
};

function RoundButton({ size, main, icon, badge, accessibilityLabel, disabled, loading, onPress }: RoundButtonProps) {
  const theme = useTheme();
  const color = main ? theme.onAccent : theme.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, busy: loading }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.round,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: main ? theme.accent : theme.backgroundSelected,
          opacity: disabled && !loading ? 0.5 : pressed ? 0.8 : 1,
        },
      ]}>
      {loading ? (
        <ActivityIndicator color={color} />
      ) : (
        <Icon name={icon} color={color} size={30} strokeWidth={main ? 3 : 2} />
      )}
      {badge && !loading ? <Text style={[styles.badge, { color }]}>{badge}</Text> : null}
    </Pressable>
  );
}

type SquareButtonProps = {
  icon: IconName;
  accessibilityLabel: string;
  accessibilityRole?: 'button' | 'switch';
  accessibilityState: { checked?: boolean; disabled?: boolean };
  active?: boolean;
  disabled: boolean;
  onPress: () => void;
};

function SquareButton({
  icon,
  accessibilityLabel,
  accessibilityRole = 'button',
  accessibilityState,
  active,
  disabled,
  onPress,
}: SquareButtonProps) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={accessibilityState}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.square,
        {
          backgroundColor: active ? theme.accentSoft : theme.backgroundSelected,
          opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
        },
      ]}>
      <Icon name={icon} color={active ? theme.accentText : theme.text} size={22} />
    </Pressable>
  );
}

type PairButtonProps = { icon?: IconName; label: string; disabled: boolean; loading: boolean; onPress: () => void };

function PairButton({ icon, label, disabled, loading, onPress }: PairButtonProps) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, busy: loading }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.pairButton,
        { backgroundColor: theme.backgroundSelected, opacity: disabled && !loading ? 0.5 : pressed ? 0.8 : 1 },
      ]}>
      {loading ? (
        <ActivityIndicator color={theme.text} />
      ) : (
        <>
          {icon ? <Icon name={icon} color={theme.text} size={18} /> : null}
          <Text style={[styles.pairLabel, { color: theme.text }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  remote: { gap: 8 },
  state: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    borderRadius: 10,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  stateText: { fontSize: 13, fontWeight: '700' },
  video: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 12, padding: 12 },
  thumb: { width: 64, height: 40, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 2 },
  videoTitle: { fontSize: 15, fontWeight: '700' },
  small: { fontSize: 13 },
  muted: { fontSize: 14, lineHeight: 20 },
  controls: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 24 },
  round: { alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', fontSize: 10, fontWeight: '700', top: '50%', marginTop: -5 },
  labels: { flexDirection: 'row', justifyContent: 'center', gap: 24 },
  label: { fontSize: 13, textAlign: 'center' },
  labelSkip: { width: 60 },
  labelMain: { width: 80 },
  volume: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, padding: 8 },
  square: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  level: { flex: 1, gap: 4 },
  levelBar: { height: 6, borderRadius: 3, overflow: 'hidden' },
  levelFill: { height: '100%' },
  pair: { flexDirection: 'row', gap: 8 },
  pairButton: {
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 44,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pairLabel: { fontSize: 15, fontWeight: '600' },
  offer: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  queue: { gap: 6, marginTop: 4 },
  queueTitle: { fontSize: 15, fontWeight: '700' },
  queueRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 10, paddingLeft: 12, minHeight: 52 },
  queueItemTitle: { fontSize: 14, fontWeight: '600' },
  queueRemove: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
