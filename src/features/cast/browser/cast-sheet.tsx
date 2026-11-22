import * as IntentLauncher from 'expo-intent-launcher';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { Button } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { castSupported, discoverRenderers, pause, play, stop, type Renderer } from '@/features/cast/dlna-client';
import { useTheme } from '@/hooks/use-theme';

import { castErrorMessage, foundLabel, videoKindLabel, type VideoCandidate } from './candidates';
import { castVideo } from './cast-video';

type Props = {
  visible: boolean;
  candidates: VideoCandidate[];
  /** Title of the top page, used when the frame that found the video has none. */
  pageTitle: string;
  onClose: () => void;
};

type Playing = { renderer: Renderer; title: string; paused: boolean };

/** "Ver en la tele": the detected video, the TVs on the Wi-Fi, and screen mirroring as plan B. */
export function CastSheet({ visible, candidates, pageTitle, onClose }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [renderers, setRenderers] = useState<Renderer[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<Playing | null>(null);
  const searchId = useRef(0);

  const video = candidates[Math.min(selectedIndex, candidates.length - 1)] ?? null;
  const hasVideo = video != null;
  const title = video?.title || pageTitle || 'Video de la página';

  const search = async () => {
    const id = ++searchId.current;
    setSearching(true);
    setError(null);
    try {
      const found = await discoverRenderers();
      if (id === searchId.current) setRenderers(found);
    } catch (cause) {
      if (id === searchId.current) setError(castErrorMessage(cause));
    } finally {
      if (id === searchId.current) {
        setSearching(false);
        setSearched(true);
      }
    }
  };

  // Search every time the sheet opens (even before a video shows up), unless a TV is already playing.
  const onShow = () => {
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

  const castTo = (renderer: Renderer) =>
    video &&
    run(renderer.controlUrl, async () => {
      await castVideo(renderer, { ...video, title });
      setPlaying({ renderer, title, paused: false });
    });

  const togglePause = () =>
    playing &&
    run('pause', async () => {
      await (playing.paused ? play(playing.renderer) : pause(playing.renderer));
      setPlaying({ ...playing, paused: !playing.paused });
    });

  const stopPlaying = () =>
    playing &&
    run('stop', async () => {
      await stop(playing.renderer);
      setPlaying(null);
    });

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

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} onShow={onShow} statusBarTranslucent>
      <Pressable accessibilityLabel="Cerrar" style={styles.scrim} onPress={onClose} />
      <View
        accessibilityViewIsModal
        accessibilityLabel="Ver en la tele"
        style={[styles.sheet, { backgroundColor: theme.background, paddingBottom: Spacing.four + insets.bottom }]}>
        <View style={[styles.grab, { backgroundColor: theme.backgroundSelected }]} />
        <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
          Ver en la tele
        </Text>

        {video ? (
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
                {videoKindLabel(video.url)} · {foundLabel(candidates.length)}
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
          <View style={[styles.playing, { backgroundColor: theme.accentSoft }]}>
            <View style={styles.tvRow}>
              <Icon name="tv" color={theme.accentText} size={26} />
              <View style={styles.body}>
                <Text style={[styles.tvName, { color: theme.text }]}>{playing.renderer.name}</Text>
                <Text style={[styles.small, { color: theme.accentText }]}>
                  {playing.paused ? 'En pausa en la tele' : 'Reproduciendo en la tele'}
                </Text>
              </View>
            </View>
            <View style={styles.actions}>
              <Button
                label={playing.paused ? 'Seguir' : 'Pausa'}
                variant="secondary"
                style={styles.flex}
                disabled={busy != null}
                loading={busy === 'pause'}
                onPress={togglePause}
              />
              <Button
                label="Detener"
                style={styles.flex}
                disabled={busy != null}
                loading={busy === 'stop'}
                onPress={stopPlaying}
              />
            </View>
          </View>
        ) : hasVideo ? (
          <>
            {renderers.map((renderer) => (
              <Pressable
                key={renderer.controlUrl}
                accessibilityRole="button"
                accessibilityLabel={`Ver en ${renderer.name}`}
                disabled={busy != null}
                onPress={() => castTo(renderer)}
                style={({ pressed }) => [
                  styles.tvRow,
                  styles.tv,
                  { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.8 : 1 },
                ]}>
                <Icon name="tv" color={theme.accentText} size={26} />
                <View style={styles.body}>
                  <Text style={[styles.tvName, { color: theme.text }]}>{renderer.name}</Text>
                  {busy === renderer.controlUrl ? (
                    <Text style={[styles.small, { color: theme.textSecondary }]}>Mandando el video…</Text>
                  ) : null}
                </View>
                {busy === renderer.controlUrl ? <ActivityIndicator color={theme.accent} /> : null}
              </Pressable>
            ))}
            {searching ? (
              <View accessibilityRole="progressbar" accessibilityLiveRegion="polite" style={styles.searching}>
                <ActivityIndicator size="small" color={theme.accent} />
                <Text style={[styles.muted, { color: theme.textSecondary }]}>
                  Buscando otras teles en tu Wi-Fi…
                </Text>
              </View>
            ) : searched && renderers.length === 0 ? (
              <View style={styles.empty}>
                <Text style={[styles.muted, { color: theme.textSecondary }]}>
                  No encontramos ninguna tele. Revisá que esté prendida, en el mismo Wi-Fi y con “Compartir contenido”
                  activado.
                </Text>
                <Button label="Buscar de nuevo" variant="secondary" onPress={search} />
              </View>
            ) : null}
          </>
        ) : null}

        {error ? (
          <Text accessibilityLiveRegion="polite" style={[styles.muted, { color: theme.danger }]}>
            {error}
          </Text>
        ) : null}

        {Platform.OS === 'android' ? (
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
  playing: { borderRadius: 12, padding: Spacing.three, gap: Spacing.three },
  actions: { flexDirection: 'row', gap: Spacing.two },
  flex: { flex: 1 },
  diagnosis: { alignSelf: 'center', paddingTop: Spacing.one },
});
