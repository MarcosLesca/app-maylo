import * as IntentLauncher from 'expo-intent-launcher';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { showDialog } from '@/components/dialog';
import { Icon } from '@/components/icon';
import { Button, Field } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { parseIpv4, suggestsBrowserReceiver } from '@/features/cast/dlna';
import {
  castSupported,
  discoverRenderers,
  INVALID_IP_MESSAGE,
  type DiscoveryReport,
  type Renderer,
} from '@/features/cast/dlna-client';
import { castSessionTarget, startCastSession, useCastSession } from '@/features/cast/session/cast-session';
import { getProgress } from '@/features/cast/session/progress-api';
import { progressKey, resumeOffer } from '@/features/cast/session/progress-rules';
import { addToQueue } from '@/features/cast/session/queue-api';
import { queueInsert } from '@/features/cast/session/queue-rules';
import { resumePromptText } from '@/features/cast/time';
import { YOUTUBE_MESSAGES } from '@/features/cast/youtube/messages';
import { youtubeVideoId } from '@/features/cast/youtube/video-id';
import { useTheme } from '@/hooks/use-theme';

import { castErrorMessage, foundLabel, videoKindLabel, type VideoCandidate } from './candidates';
import { dlnaTarget, receiverTarget, type CastTarget } from './cast-target';
import { castVideo } from './cast-video';
import type { NextEpisodeLink } from './next-episode';
import type { NowPlaying } from './now-playing';
import { CastRemote } from './remote';
import { useReceiverStatus } from './use-receiver';

type Props = {
  visible: boolean;
  candidates: VideoCandidate[];
  /** Title of the top page, used when the frame that found the video has none. */
  pageTitle: string;
  /** URL of the top page: "seguir viendo" key, history and the queue's "Abrí la página". */
  pageUrl: string;
  /** The page's next-episode link (D4), offered when this cast ends with an empty queue. */
  nextEpisode?: NextEpisodeLink | null;
  /** Opens a page in the in-app browser (from the remote). */
  onOpenPage?: (url: string) => void;
  /**
   * Open straight in the remote bound to the TV browser receiver (S8), even when this
   * phone did not cast; a new object each time the user asks for it.
   */
  remote?: NowPlaying | null;
  onClose: () => void;
};

type Playing = { target: CastTarget; title: string; kind: string; from?: string };

/** Short plain-Spanish reason when a search found no TV; the details live in "Prueba de conexión". */
function emptyMessage(report: DiscoveryReport | null): string {
  const target = report?.mode === 'unicast' ? `la tele en ${report.target}` : 'ninguna tele';
  if (!report || report.responses + report.notifies === 0) {
    return report?.mode === 'unicast'
      ? `No respondió ${target}. Revisá la IP y que la TV tenga “Compartir contenido” activado.`
      : 'No encontramos ninguna tele. Revisá que esté prendida, en el mismo Wi-Fi y con “Compartir contenido” activado.';
  }
  return 'Respondieron aparatos del Wi-Fi, pero ninguno acepta videos. Activá “Compartir contenido” en la tele.';
}

/** Messages discoverRenderers writes for the user; anything else gets the generic text. */
function searchErrorMessage(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : '';
  if (message === INVALID_IP_MESSAGE || message.startsWith('Esta versión de la app')) return message;
  return castErrorMessage(cause);
}

/** "Ver en la tele": the detected video, the TVs on the Wi-Fi, and screen mirroring as plan B. */
export function CastSheet({
  visible,
  candidates,
  pageTitle,
  pageUrl,
  nextEpisode = null,
  remote = null,
  onOpenPage,
  onClose,
}: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [renderers, setRenderers] = useState<Renderer[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const session = useCastSession();
  // Back on the browser while this phone still casts (the session outlives the screen): its remote.
  const [playing, setPlaying] = useState<Playing | null>(() => {
    const target = castSessionTarget();
    const current = session.active ? session : null;
    return target && current ? { target, title: current.title, kind: current.kind, from: current.sender } : null;
  });
  const [queueing, setQueueing] = useState(false);
  const [queued, setQueued] = useState<string | null>(null);
  const [report, setReport] = useState<DiscoveryReport | null>(null);
  const [askIp, setAskIp] = useState(false);
  const [ip, setIp] = useState('');
  const searchId = useRef(0);
  // A new remote request switches to the receiver's remote during this render, before
  // onShow, so the sheet neither flashes the TV list nor starts a search. A remote this
  // phone already has for the receiver (it cast the video) is kept.
  const [remoteRequest, setRemoteRequest] = useState<NowPlaying | null>(null);
  if (remote !== remoteRequest) {
    setRemoteRequest(remote);
    if (remote && playing?.target.kind !== 'receiver') {
      setPlaying({ target: receiverTarget(remote.address), title: remote.title || 'Video en la tele', kind: '', from: remote.from });
    }
  }
  // The TV browser receiver shows up in the list while its page reports state (S5).
  const receiver = useReceiverStatus(visible && castSupported && !playing);
  const receiverAddress = receiver?.connected ? receiver.address : null;
  const targets: CastTarget[] = [
    ...renderers.map(dlnaTarget),
    ...(receiverAddress != null ? [receiverTarget(receiverAddress)] : []),
  ];
  // DIAL-only TV (VIDAA): it plays through its own browser instead (S6).
  const suggestBrowser = searched && !searching && receiverAddress == null && suggestsBrowserReceiver(report);

  const video = candidates[Math.min(selectedIndex, candidates.length - 1)] ?? null;
  const hasVideo = video != null;
  const title = video?.title || pageTitle || 'Video de la página';
  const isYoutube = video != null && youtubeVideoId(video.url) != null;
  const kindLabel = video ? (isYoutube ? 'YouTube' : videoKindLabel(video.url)) : '';

  // `host`: unicast search to the IP the user typed (S3), parsed like any other reply.
  const search = async (host?: string) => {
    const id = ++searchId.current;
    setSearching(true);
    setError(null);
    try {
      const result = await discoverRenderers({ host });
      if (id === searchId.current) {
        setRenderers(result.renderers);
        setReport(result.report);
      }
    } catch (cause) {
      if (id === searchId.current) setError(searchErrorMessage(cause));
    } finally {
      if (id === searchId.current) {
        setSearching(false);
        setSearched(true);
      }
    }
  };

  const searchIp = () => {
    const target = parseIpv4(ip);
    if (!target) {
      setError(INVALID_IP_MESSAGE);
      return;
    }
    search(target);
  };

  // Search every time the sheet opens (even before a video shows up), unless a TV is already playing.
  const onShow = () => {
    setQueued(null);
    if (castSupported && !playing) search();
  };

  // One SOAP sequence at a time: interleaving Stop with SetAVTransportURI confuses the TV.
  const run = async (label: string, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(label);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(castErrorMessage(cause));
    } finally {
      setBusy(null);
    }
  };

  const castFrom = (target: CastTarget, resumeFrom: number | null) =>
    video &&
    run(target.id, async () => {
      await castVideo(target, { ...video, title });
      const kind = kindLabel;
      startCastSession(target, {
        title,
        pageUrl,
        pageTitle,
        kind,
        resumeFrom,
        nextEpisode: nextEpisode ? { url: nextEpisode.url, label: nextEpisode.label } : null,
      });
      setPlaying({ target, title, kind });
    });

  // A saved position (> 30 s, not near the end) asks first: "¿Seguir desde 23:10?" (D3).
  const castTo = async (target: CastTarget) => {
    if (!video || busy) return;
    // S4: separate audio and video only play on the TV browser receiver.
    if (isYoutube && target.kind === 'dlna') {
      setError(YOUTUBE_MESSAGES.dlna);
      return;
    }
    const key = progressKey(pageUrl, title);
    const saved = key ? await getProgress(key).catch(() => null) : null;
    const offer = resumeOffer(saved);
    if (offer == null) {
      castFrom(target, null);
      return;
    }
    showDialog(resumePromptText(offer), undefined, [
      { text: 'Desde el principio', onPress: () => castFrom(target, null) },
      { text: 'Seguir', onPress: () => castFrom(target, offer) },
    ]);
  };

  // Cookies included (both members agreed): the queued cast sends the same headers (D2).
  const enqueue = async () => {
    if (!video || queueing) return;
    const row = queueInsert({ ...video, title }, pageUrl, pageTitle);
    if (!row) {
      setError('Este video no se puede agregar a la cola.');
      return;
    }
    setQueueing(true);
    setError(null);
    setQueued(null);
    try {
      await addToQueue(row);
      setQueued(row.title);
    } catch {
      setError('No se pudo agregar a la cola. Probá de nuevo.');
    } finally {
      setQueueing(false);
    }
  };

  const pickAnother = () => {
    setPlaying(null);
    search();
  };

  const mirror = async () => {
    try {
      await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.CAST_SETTINGS);
    } catch {
      setError('No se pudo abrir “Duplicar la pantalla”. Buscalo en los ajustes rápidos del teléfono.');
    }
  };

  const openTestPanel = () => {
    onClose();
    router.push('/cast-test');
  };

  const openReceiver = () => {
    onClose();
    router.push('/cast-receiver');
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} onShow={onShow} statusBarTranslucent>
      <Pressable accessibilityLabel="Cerrar" style={styles.scrim} onPress={onClose} />
      <View
        accessibilityViewIsModal
        accessibilityLabel={playing ? 'Control remoto' : 'Ver en la tele'}
        style={[styles.sheet, { backgroundColor: theme.background, paddingBottom: Spacing.four + insets.bottom }]}>
        <View style={[styles.grab, { backgroundColor: theme.backgroundSelected }]} />
        {playing ? null : (
          <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
            Ver en la tele
          </Text>
        )}

        {playing ? null : video ? (
          <Pressable
            accessibilityRole={candidates.length > 1 ? 'button' : undefined}
            accessibilityHint={candidates.length > 1 ? 'Cambia al siguiente video encontrado' : undefined}
            disabled={candidates.length < 2 || playing != null}
            onPress={() => setSelectedIndex((index) => (index + 1) % candidates.length)}
            style={[styles.video, { backgroundColor: theme.backgroundElement }]}>
            <View style={[styles.thumb, { backgroundColor: theme.text }]}>
              <Icon name="screen" color={theme.background} size={18} />
            </View>
            <View style={styles.body}>
              <Text numberOfLines={2} style={[styles.videoTitle, { color: theme.text }]}>
                {title}
              </Text>
              <Text style={[styles.small, { color: theme.textSecondary }]}>
                {kindLabel} · {foundLabel(candidates.length)}
              </Text>
            </View>
          </Pressable>
        ) : (
          <Text style={[styles.muted, { color: theme.textSecondary }]}>
            Todavía no encontramos un video en esta página. Dale play al video y volvé a tocar el botón de la tele.
          </Text>
        )}

        {!castSupported ? (
          <Text style={[styles.muted, { color: theme.textSecondary }]}>
            Esta versión de la app no puede transmitir. Instalá la última versión para usarla.
          </Text>
        ) : playing ? (
          <CastRemote
            key={playing.target.id}
            visible={visible}
            target={playing.target}
            title={playing.title}
            kind={playing.kind}
            from={playing.from}
            onStopped={() => setPlaying(null)}
            onPickAnother={pickAnother}
            onOpenPage={onOpenPage}
          />
        ) : hasVideo ? (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityHint="La tele lo pasa sola cuando termina lo que está viendo"
              accessibilityState={{ busy: queueing }}
              disabled={queueing}
              onPress={enqueue}
              style={({ pressed }) => [
                styles.tvRow,
                styles.tv,
                { borderWidth: 1, borderColor: theme.backgroundSelected, opacity: pressed ? 0.8 : 1 },
              ]}>
              <Icon name="plus" color={theme.accentText} size={26} />
              <View style={styles.body}>
                <Text style={[styles.tvName, { color: theme.text }]}>Agregar a la cola</Text>
                {queued ? (
                  <Text accessibilityLiveRegion="polite" style={[styles.small, { color: theme.successText }]}>
                    Agregado: {queued}
                  </Text>
                ) : null}
              </View>
              {queueing ? <ActivityIndicator color={theme.accent} /> : null}
            </Pressable>
            {targets.map((target) => (
              <Pressable
                key={target.id}
                accessibilityRole="button"
                accessibilityLabel={`Ver en ${target.name}`}
                disabled={busy != null}
                onPress={() => castTo(target)}
                style={({ pressed }) => [
                  styles.tvRow,
                  styles.tv,
                  { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.8 : 1 },
                ]}>
                <Icon name={target.kind === 'receiver' ? 'browser' : 'tv'} color={theme.accentText} size={26} />
                <View style={styles.body}>
                  <Text style={[styles.tvName, { color: theme.text }]}>{target.name}</Text>
                  {busy === target.id ? (
                    <Text style={[styles.small, { color: theme.textSecondary }]}>Mandando el video…</Text>
                  ) : null}
                </View>
                {busy === target.id ? <ActivityIndicator color={theme.accent} /> : null}
              </Pressable>
            ))}
            {searching ? (
              <View accessibilityRole="progressbar" accessibilityLiveRegion="polite" style={styles.searching}>
                <ActivityIndicator size="small" color={theme.accent} />
                <Text style={[styles.muted, { color: theme.textSecondary }]}>
                  Buscando otras teles en tu Wi-Fi…
                </Text>
              </View>
            ) : searched && targets.length === 0 ? (
              <View style={styles.empty}>
                <Text style={[styles.muted, { color: theme.textSecondary }]}>
                  {suggestBrowser
                    ? 'Tu tele está en el Wi-Fi pero no acepta videos por DLNA. Usá el navegador de la tele (abajo).'
                    : emptyMessage(report)}
                </Text>
                <Button label="Buscar de nuevo" variant="secondary" onPress={() => search()} />
              </View>
            ) : null}
            {searched && !searching ? (
              askIp ? (
                <View style={styles.ipRow}>
                  <Field
                    value={ip}
                    onChangeText={setIp}
                    placeholder="IP de la tele, ej. 192.168.1.50"
                    keyboardType="decimal-pad"
                    autoCapitalize="none"
                    autoCorrect={false}
                    accessibilityLabel="IP de la tele"
                    onSubmitEditing={searchIp}
                    style={styles.body}
                  />
                  <Button label="Buscar" variant="secondary" disabled={!ip.trim()} onPress={searchIp} />
                </View>
              ) : (
                <Pressable accessibilityRole="button" onPress={() => setAskIp(true)} hitSlop={8}>
                  <Text style={[styles.small, { color: theme.accentText }]}>¿No aparece tu tele? Ingresá su IP</Text>
                </Pressable>
              )
            ) : null}
          </>
        ) : null}

        {castSupported && !playing ? (
          <Pressable
            accessibilityRole="button"
            accessibilityHint="Muestra la dirección para abrir en el navegador de la tele"
            onPress={openReceiver}
            style={({ pressed }) => [
              styles.tvRow,
              styles.tv,
              suggestBrowser
                ? { backgroundColor: theme.accentSoft, opacity: pressed ? 0.8 : 1 }
                : { borderWidth: 1, borderColor: theme.backgroundSelected, opacity: pressed ? 0.8 : 1 },
            ]}>
            <Icon name="browser" color={theme.accentText} size={26} />
            <View style={styles.body}>
              <Text style={[styles.tvName, { color: theme.text }]}>Usar el navegador de la tele</Text>
              <Text style={[styles.small, { color: theme.textSecondary }]}>
                {receiverAddress != null
                  ? `Conectado (${receiverAddress})`
                  : suggestBrowser
                    ? 'Recomendado para tu tele: abrí una dirección en su navegador'
                    : 'Para teles que no aparecen: abrí una dirección en su navegador'}
              </Text>
            </View>
          </Pressable>
        ) : null}

        {error ? (
          <Text accessibilityLiveRegion="polite" style={[styles.muted, { color: theme.danger }]}>
            {error}
          </Text>
        ) : null}

        {Platform.OS === 'android' && !playing ? (
          <Pressable
            accessibilityRole="button"
            onPress={mirror}
            style={({ pressed }) => [
              styles.tvRow,
              styles.tv,
              { borderWidth: 1, borderColor: theme.backgroundSelected, opacity: pressed ? 0.8 : 1 },
            ]}>
            <Icon name="phone" color={theme.textSecondary} size={26} />
            <View style={styles.body}>
              <Text style={[styles.tvName, { color: theme.text }]}>Duplicar la pantalla</Text>
              <Text style={[styles.small, { color: theme.textSecondary }]}>
                Si el video no anda: muestra todo el teléfono en la tele
              </Text>
            </View>
          </Pressable>
        ) : null}

        <Pressable accessibilityRole="link" onPress={openTestPanel} hitSlop={8} style={styles.diagnosis}>
          <Text style={[styles.small, { color: theme.accentText }]}>Prueba de conexión</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(31,26,23,0.45)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: Spacing.two,
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
  },
  grab: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: Spacing.two },
  title: { fontSize: 18, fontWeight: '700' },
  video: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 12, padding: 12 },
  thumb: { width: 64, height: 40, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 2 },
  videoTitle: { fontSize: 15, fontWeight: '700' },
  small: { fontSize: 13 },
  muted: { fontSize: 14, lineHeight: 20 },
  tvRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  tv: { borderRadius: 12, paddingVertical: 14, paddingHorizontal: Spacing.three, minHeight: 56 },
  tvName: { fontSize: 16, fontWeight: '600' },
  searching: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.one },
  empty: { gap: Spacing.two },
  ipRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  diagnosis: { alignSelf: 'center', paddingTop: Spacing.one },
});
