import { router } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/screen';
import { Button, Muted } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useReceiverHold, useReceiverStatus } from '@/features/cast/browser/use-receiver';
import { RECEIVER_OLD_APP } from '@/features/cast/receiver/receiver-client';
import { connectionText } from '@/features/cast/receiver/receiver-state';
import { useTheme } from '@/hooks/use-theme';

/** Re-ask the native side for the address this often while no TV is connected (Wi-Fi may change). */
const REFRESH_MS = 5000;

/** Plain Spanish for a failed receiver start. */
function startErrorMessage(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : '';
  const code = typeof cause === 'object' && cause != null && 'code' in cause ? String(cause.code) : '';
  if (message === RECEIVER_OLD_APP) return RECEIVER_OLD_APP;
  if (code === 'ERR_NO_WIFI') return 'Conectá el teléfono al mismo Wi-Fi que la tele y volvé a esta pantalla.';
  if (code === 'ERR_NO_PORT') return 'No se pudo abrir el receptor en el teléfono. Cerrá otras apps y probá de nuevo.';
  return 'No se pudo abrir el receptor en el teléfono. Probá de nuevo.';
}

/**
 * "Conectar la tele" (route /cast-receiver): the address to open in the TV's
 * browser and whether the TV page is connected. The receiver runs while this
 * screen or the cast browser is open (useReceiverHold).
 */
export default function CastReceiverScreen() {
  const theme = useTheme();
  const { address, error, refresh } = useReceiverHold();
  const report = useReceiverStatus(address != null);
  const connected = report?.connected === true;

  // While waiting, ask again for the URL now and then: startReceiverAsync rebinds on a new Wi-Fi IP.
  useEffect(() => {
    if (connected || address == null) return;
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [connected, address, refresh]);

  if (error && !address) {
    return (
      <Screen>
        <Text accessibilityLiveRegion="polite" style={[styles.status, { color: theme.danger }]}>
          {startErrorMessage(error)}
        </Text>
        {startErrorMessage(error) === RECEIVER_OLD_APP ? null : (
          <Button label="Probar de nuevo" variant="secondary" onPress={refresh} />
        )}
      </Screen>
    );
  }

  return (
    <Screen>
      <Text style={[styles.lead, { color: theme.text }]}>
        En la tele abrí el navegador, entrá a esta dirección y guardala en favoritos
      </Text>

      <View style={[styles.addressBox, { backgroundColor: theme.backgroundElement }]}>
        {address ? (
          <Text selectable accessibilityLabel={`Dirección: ${address.url}`} style={[styles.address, { color: theme.text }]}>
            {address.url}
          </Text>
        ) : (
          <ActivityIndicator color={theme.accent} />
        )}
      </View>

      <View style={styles.steps}>
        <Step number={1} text="Prendé la tele y abrí su navegador de internet." />
        <Step number={2} text="Escribí la dirección de arriba, tal cual." />
        <Step number={3} text="Guardala en favoritos: la próxima vez la abrís desde ahí." />
      </View>

      <View
        accessibilityLiveRegion="polite"
        style={[styles.statusRow, { backgroundColor: connected ? theme.successSoft : theme.backgroundElement }]}>
        {connected ? (
          <View style={[styles.dot, { backgroundColor: theme.success }]} />
        ) : (
          <ActivityIndicator size="small" color={theme.accent} />
        )}
        <Text style={[styles.status, { color: connected ? theme.successText : theme.textSecondary }]}>
          {connectionText(report)}
        </Text>
      </View>

      {connected ? (
        <Button label="Listo, volver al video" onPress={() => router.back()} />
      ) : (
        <Muted>El teléfono y la tele tienen que estar en el mismo Wi-Fi. Dejá esta pantalla abierta mientras tanto.</Muted>
      )}
    </Screen>
  );
}

function Step({ number, text }: { number: number; text: string }) {
  const theme = useTheme();
  return (
    <View style={styles.step}>
      <View style={[styles.stepNumber, { backgroundColor: theme.accentSoft }]}>
        <Text style={[styles.stepNumberText, { color: theme.accentText }]}>{number}</Text>
      </View>
      <Text style={[styles.stepText, { color: theme.text }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  lead: { fontSize: 16, fontWeight: '600', lineHeight: 22 },
  addressBox: {
    borderRadius: 12,
    paddingVertical: Spacing.four,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 96,
  },
  address: { fontSize: 26, fontWeight: '700', textAlign: 'center', fontVariant: ['tabular-nums'] },
  steps: { gap: Spacing.two, marginTop: Spacing.two },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepNumber: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  stepNumberText: { fontSize: 14, fontWeight: '700' },
  stepText: { flex: 1, fontSize: 15, lineHeight: 20 },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: 12,
    padding: Spacing.three,
    marginTop: Spacing.two,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  status: { fontSize: 15, fontWeight: '600', flex: 1 },
});
