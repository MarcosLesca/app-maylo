import { useSyncExternalStore } from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { downloadStore } from './apk-installer';
import { downloadLabel, progressRatio } from './download-progress';

/** Shown while a new APK downloads inside the app. */
export function UpdateProgress() {
  const theme = useTheme();
  const download = useSyncExternalStore(downloadStore.subscribe, downloadStore.get);
  if (!download) return null;

  const ratio = progressRatio(download.written, download.expected);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => undefined}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: theme.background }]} accessibilityLiveRegion="polite">
          <View style={[styles.stripe, { backgroundColor: theme.accent }]} />
          <Text style={[styles.title, { color: theme.text }]}>Descargando MayLo {download.version}</Text>
          <View style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
            {ratio === null ? (
              <ActivityIndicator size="small" color={theme.accent} style={styles.spinner} />
            ) : (
              <View style={[styles.fill, { width: `${ratio * 100}%`, backgroundColor: theme.accent }]} />
            )}
          </View>
          <Text style={{ color: theme.textSecondary }}>{downloadLabel(download.written, download.expected)}</Text>
          <Text style={[styles.note, { color: theme.textSecondary }]}>
            Al terminar se abre el instalador de Android: tocá Instalar.
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: Spacing.four },
  card: {
    borderRadius: 20,
    padding: Spacing.four,
    paddingTop: Spacing.four + 6,
    gap: Spacing.two,
    width: '100%',
    maxWidth: 400,
    alignSelf: 'center',
    overflow: 'hidden',
  },
  stripe: { position: 'absolute', top: 0, left: 0, right: 0, height: 6 },
  title: { fontSize: 19, fontWeight: '700' },
  track: { height: 10, borderRadius: 5, overflow: 'hidden', justifyContent: 'center', marginTop: Spacing.two },
  fill: { height: '100%', borderRadius: 5 },
  spinner: { transform: [{ scale: 0.6 }] },
  note: { fontSize: 13, marginTop: Spacing.one },
});
