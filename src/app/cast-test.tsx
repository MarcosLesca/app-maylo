import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/screen';
import { Button, Field, Muted, SectionTitle } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import {
  castSupported,
  castUrl,
  discoverRenderers,
  pause,
  play,
  stop,
  transportState,
  type Renderer,
} from '@/features/cast/dlna-client';
import { hostOf } from '@/features/cast/dlna';
import { useTheme } from '@/hooks/use-theme';

/** Diagnosis panel (route /cast-test), reachable from the cast browser sheet. */

/** Public test streams: they prove the TV plays MP4 and HLS before casting real pages. */
const SAMPLES = [
  { label: 'MP4 de prueba', url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4' },
  { label: 'HLS (.m3u8) de prueba', url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8' },
];

export default function CastTestScreen() {
  const theme = useTheme();
  const [renderers, setRenderers] = useState<Renderer[]>([]);
  const [selected, setSelected] = useState<Renderer | null>(null);
  const [url, setUrl] = useState(SAMPLES[0].url);
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const note = (line: string) => setLog((lines) => [`${new Date().toLocaleTimeString()}  ${line}`, ...lines].slice(0, 30));

  // One SOAP sequence at a time: interleaving Stop with SetAVTransportURI confuses the TV.
  const locked = busy != null;
  const run = async (label: string, action: () => Promise<string | void>) => {
    if (busy) return;
    setBusy(label);
    try {
      const result = await action();
      note(result ? `${label}: ${result}` : `${label}: ok`);
    } catch (error) {
      note(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(null);
    }
  };

  const search = () =>
    run('Buscar', async () => {
      const found = await discoverRenderers();
      setRenderers(found);
      setSelected((current) =>
        found.length === 1 ? found[0] : (found.find((r) => r.controlUrl === current?.controlUrl) ?? null),
      );
      return found.length ? `${found.length} TV encontrada(s)` : 'ninguna TV respondió';
    });

  if (!castSupported) {
    return (
      <Screen>
        <Muted>Esta versión de la app no puede transmitir. Instalá la última versión para usarla.</Muted>
      </Screen>
    );
  }

  return (
    <Screen>
      <SectionTitle>Televisor</SectionTitle>
      <Muted>El teléfono y la TV tienen que estar en el mismo Wi-Fi, con “Compartir contenido” activado en la TV.</Muted>
      <Button label="Buscar televisores" onPress={search} disabled={locked} loading={busy === 'Buscar'} />
      {renderers.map((renderer) => {
        const active = selected?.controlUrl === renderer.controlUrl;
        return (
          <Pressable
            key={renderer.controlUrl}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            onPress={() => setSelected(renderer)}
            style={[styles.device, { backgroundColor: active ? theme.backgroundSelected : theme.backgroundElement }]}>
            <Text style={[styles.deviceName, { color: theme.text }]}>{renderer.name}</Text>
            <Text style={{ color: theme.textSecondary }}>{hostOf(renderer.controlUrl)}</Text>
          </Pressable>
        );
      })}

      <SectionTitle>Video</SectionTitle>
      <View style={styles.row}>
        {SAMPLES.map((sample) => (
          <Button key={sample.url} label={sample.label} variant="secondary" style={styles.flex} onPress={() => setUrl(sample.url)} />
        ))}
      </View>
      <Field value={url} onChangeText={setUrl} placeholder="URL del video (.mp4 o .m3u8)" autoCapitalize="none" autoCorrect={false} />
      <Button
        label="Transmitir"
        disabled={locked || !selected || !url.trim()}
        loading={busy === 'Transmitir'}
        onPress={() => selected && run('Transmitir', () => castUrl(selected, url.trim(), 'MayLo'))}
      />
      <View style={styles.row}>
        <Button label="Play" variant="secondary" style={styles.flex} disabled={locked || !selected} onPress={() => selected && run('Play', () => play(selected))} />
        <Button label="Pausa" variant="secondary" style={styles.flex} disabled={locked || !selected} onPress={() => selected && run('Pausa', () => pause(selected))} />
        <Button label="Stop" variant="secondary" style={styles.flex} disabled={locked || !selected} onPress={() => selected && run('Stop', () => stop(selected))} />
      </View>
      <Button label="Estado" variant="secondary" disabled={locked || !selected} onPress={() => selected && run('Estado', () => transportState(selected))} />

      <SectionTitle>Registro</SectionTitle>
      {log.length === 0 ? <Muted>Sin eventos todavía.</Muted> : null}
      {log.map((line, index) => (
        <Text key={index} selectable style={[styles.log, { color: theme.textSecondary }]}>
          {line}
        </Text>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.two },
  flex: { flex: 1 },
  device: { padding: Spacing.three, borderRadius: 12, gap: 2 },
  deviceName: { fontWeight: '600', fontSize: 16 },
  log: { fontFamily: 'monospace', fontSize: 12 },
});
