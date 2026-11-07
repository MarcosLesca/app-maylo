import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { Button } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { bytesToBase64, viewerHtml } from '@/features/payments/receipt-viewer';
import { getReceiptUrl, VIEWABLE_BUCKETS, type ViewableBucket } from '@/features/payments/receipts';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/use-query';

const VIEWER_BACKGROUND = '#2B2622';

async function loadViewer(path: string, mime: string, bucket: ViewableBucket): Promise<string> {
  const url = await getReceiptUrl(path, bucket);
  if (mime !== 'application/pdf') return viewerHtml({ kind: 'image', url }, VIEWER_BACKGROUND);

  // Download here and hand the bytes to pdf.js: no CORS, no third-party viewer.
  const response = await fetch(url);
  if (!response.ok) throw new Error(`No se pudo descargar el PDF (${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  return viewerHtml({ kind: 'pdf', base64: bytesToBase64(bytes) }, VIEWER_BACKGROUND);
}

/** In-app viewer for receipts and chat photos: images and PDFs with pinch zoom, no browser needed. */
export default function ReceiptScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ path: string; mime: string; bucket?: string }>();
  const { path, mime } = params;
  // Only known private buckets; anything else falls back to receipts.
  const bucket: ViewableBucket = VIEWABLE_BUCKETS.find((b) => b === params.bucket) ?? 'receipts';
  const title = bucket === 'chat-images' ? 'Foto' : 'Comprobante';
  const [html, setHtml] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    loadViewer(path, mime, bucket)
      .then((result) => {
        if (!cancelled) setHtml(result);
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [path, mime, bucket, attempt]);

  const retry = () => {
    setError(null);
    setHtml(null);
    setReady(false);
    setAttempt((n) => n + 1);
  };

  const onMessage = (event: WebViewMessageEvent) => {
    const message = event.nativeEvent.data;
    if (message === 'ready') setReady(true);
    else if (message.startsWith('error:')) setError(message.slice(6));
  };

  if (error) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <Stack.Screen options={{ title }} />
        <Text style={[styles.errorTitle, { color: theme.text }]}>No se pudo abrir {title.toLowerCase() === 'foto' ? 'la foto' : 'el comprobante'}</Text>
        <Text style={[styles.errorText, { color: theme.textSecondary }]}>{error}</Text>
        <Button label="Reintentar" onPress={retry} />
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: VIEWER_BACKGROUND }]}>
      <Stack.Screen options={{ title }} />
      {html ? (
        <WebView
          source={{ html, baseUrl: 'https://localhost/' }}
          originWhitelist={['*']}
          onMessage={onMessage}
          setSupportMultipleWindows={false}
          mixedContentMode="never"
          style={styles.web}
        />
      ) : null}
      {!ready ? (
        <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
          <ActivityIndicator size="large" color={theme.accent} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  web: { flex: 1, backgroundColor: 'transparent' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four, gap: Spacing.three },
  errorTitle: { fontSize: 18, fontWeight: '700', textAlign: 'center' },
  errorText: { fontSize: 14, textAlign: 'center' },
});
