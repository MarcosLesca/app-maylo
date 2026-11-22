import { router } from 'expo-router';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { BackHandler, findNodeHandle, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';

import { Icon } from '@/components/icon';
import { Button } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { displayAddress, resolveAddress } from '@/features/cast/browser/address';
import {
  addCandidate,
  addPlayerFrame,
  parseDetectorMessage,
  parsePlayerFrameMessage,
  playerFrameToOpen,
  samePage,
  type PlayerFrame,
  type VideoCandidate,
} from '@/features/cast/browser/candidates';
import { CastSheet } from '@/features/cast/browser/cast-sheet';
import { DETECTOR_SCRIPT } from '@/features/cast/browser/detector-script';
import { stopProxy } from '@/features/cast/proxy';
import { useTheme } from '@/hooks/use-theme';
import TvCast from '../../modules/tv-cast';

/** In-app browser: open any page, detect the video it plays and send it to the TV. */
export default function CastBrowserScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  // WebView's default generic types its props as `never`; `object` keeps the ref usable.
  const webView = useRef<WebView<object>>(null);
  // Host view around the WebView: its native tag lets TvCast find the android WebView.
  const pageHost = useRef<ComponentRef<typeof View>>(null);
  const frameScriptAdded = useRef(false);
  const topUrl = useRef('');

  const [source, setSource] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [pageTitle, setPageTitle] = useState('');
  const [canGoBack, setCanGoBack] = useState(false);
  const [editing, setEditing] = useState(true);
  const [draft, setDraft] = useState('');
  const [progress, setProgress] = useState(1);
  const [candidates, setCandidates] = useState<VideoCandidate[]>([]);
  const [frames, setFrames] = useState<PlayerFrame[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Leaving the browser ends the cast session, so the TV can no longer fetch through the phone.
  useEffect(
    () => () => {
      void stopProxy();
    },
    [],
  );

  const goBack = () => {
    if (canGoBack) webView.current?.goBack();
    else router.back();
  };

  // The hardware back button walks the page history first, like a browser.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!canGoBack) return false;
      webView.current?.goBack();
      return true;
    });
    return () => subscription.remove();
  }, [canGoBack]);

  const startEditing = () => {
    setDraft(url);
    setEditing(true);
  };

  const submit = () => {
    const next = resolveAddress(draft);
    if (!next) return;
    setEditing(false);
    setUrl(next);
    if (next === source) webView.current?.reload();
    else setSource(next);
  };

  const onNavigation = (event: WebViewNavigation) => {
    setUrl(event.url);
    setPageTitle(event.title ?? '');
    setCanGoBack(event.canGoBack);
  };

  // The WebView's injectedJavaScript props reach only the main frame on Android, so the
  // detector is also registered natively for every frame (iframe players). The native view
  // surely exists once it reports a load; retried on later loads until it is accepted.
  const addFrameDetector = () => {
    if (frameScriptAdded.current || !TvCast?.addDocumentStartScriptAsync) return;
    const tag = findNodeHandle(pageHost.current);
    if (tag == null) return;
    frameScriptAdded.current = true;
    TvCast.addDocumentStartScriptAsync(tag, DETECTOR_SCRIPT)
      .then((added) => {
        frameScriptAdded.current = added;
      })
      .catch(() => {
        frameScriptAdded.current = false;
      });
  };

  // A new top page drops the videos and player frames found on the previous one.
  const onLoadStart = (event: { nativeEvent: WebViewNavigation }) => {
    addFrameDetector();
    const next = event.nativeEvent.url;
    if (!samePage(topUrl.current, next)) {
      setCandidates([]);
      setFrames([]);
    }
    topUrl.current = next;
  };

  const onMessage = (event: WebViewMessageEvent) => {
    const { data } = event.nativeEvent;
    const candidate = parseDetectorMessage(data);
    if (candidate) {
      setCandidates((list) => addCandidate(list, candidate));
      return;
    }
    const frame = parsePlayerFrameMessage(data);
    if (frame) setFrames((list) => addPlayerFrame(list, frame));
  };

  // No video seen, but the page shows a big iframe: open it as the page so the detector sees it.
  const playerFrame = candidates.length === 0 ? playerFrameToOpen(frames, url) : null;
  const openPlayerFrame = () => {
    if (playerFrame) webView.current?.injectJavaScript(`window.location.href = ${JSON.stringify(playerFrame.url)}; true;`);
  };

  const secure = /^https:\/\//i.test(url);

  return (
    <View style={[styles.screen, { backgroundColor: theme.background, paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Volver" onPress={goBack} style={styles.iconButton}>
          <Icon name="chevronLeft" color={theme.text} size={22} />
        </Pressable>
        {editing ? (
          <TextInput
            accessibilityLabel="Dirección"
            autoFocus
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={submit}
            onBlur={() => source && setEditing(false)}
            placeholder="Buscá o escribí una dirección"
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            selectTextOnFocus
            returnKeyType="go"
            style={[styles.address, styles.addressInput, { backgroundColor: theme.backgroundElement, color: theme.text }]}
          />
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Dirección: ${url}`}
            accessibilityHint="Tocá para escribir otra dirección o buscar"
            onPress={startEditing}
            style={[styles.address, { backgroundColor: theme.backgroundElement }]}>
            {secure ? <Icon name="lock" color={theme.textSecondary} size={14} /> : null}
            <Text numberOfLines={1} style={[styles.addressText, { color: theme.text }]}>
              {displayAddress(url)}
            </Text>
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Transmitir a la TV"
          onPress={() => setSheetOpen(true)}
          style={[styles.iconButton, { backgroundColor: theme.accentSoft }]}>
          <Icon name="tv" color={theme.accentText} size={22} />
        </Pressable>
      </View>
      <View style={[styles.progressTrack, { opacity: progress < 1 ? 1 : 0 }]}>
        <View
          accessibilityRole="progressbar"
          accessibilityLabel="Cargando la página"
          style={[styles.progress, { backgroundColor: theme.accent, width: `${Math.round(progress * 100)}%` }]}
        />
      </View>

      <View style={styles.page}>
        {source ? (
          <View ref={pageHost} collapsable={false} style={styles.webView}>
            <WebView
              ref={webView}
              source={{ uri: source }}
              injectedJavaScriptBeforeContentLoaded={DETECTOR_SCRIPT}
              injectedJavaScriptBeforeContentLoadedForMainFrameOnly={false}
              injectedJavaScript={DETECTOR_SCRIPT}
              injectedJavaScriptForMainFrameOnly={false}
              onMessage={onMessage}
              onLoadStart={onLoadStart}
              onLoadProgress={(event) => setProgress(event.nativeEvent.progress)}
              onLoadEnd={() => setProgress(1)}
              onNavigationStateChange={onNavigation}
              renderError={(_domain, _code, description) => (
                <View style={[styles.state, { backgroundColor: theme.background }]}>
                  <Text style={[styles.stateTitle, { color: theme.text }]}>No se pudo abrir la página</Text>
                  <Text style={[styles.stateText, { color: theme.textSecondary }]}>
                    Revisá la dirección y tu conexión a internet.{description ? ` (${description})` : ''}
                  </Text>
                  <Button label="Reintentar" onPress={() => webView.current?.reload()} />
                </View>
              )}
              domStorageEnabled
              allowsFullscreenVideo
              allowsInlineMediaPlayback
              setSupportMultipleWindows={false}
              style={styles.webView}
            />
          </View>
        ) : (
          <View style={[styles.state, { backgroundColor: theme.background }]}>
            <Icon name="tv" color={theme.accent} size={40} />
            <Text style={[styles.stateTitle, { color: theme.text }]}>Abrí la página del video</Text>
            <Text style={[styles.stateText, { color: theme.textSecondary }]}>
              Escribí la dirección o lo que buscás. Cuando aparezca “Ver en la tele”, tocalo para verlo en tu TV.
            </Text>
          </View>
        )}

        {candidates.length > 0 ? (
          <View pointerEvents="box-none" style={[styles.pillDock, { bottom: Spacing.three + insets.bottom }]}>
            <Pressable
              accessibilityRole="button"
              onPress={() => setSheetOpen(true)}
              style={({ pressed }) => [styles.pill, { backgroundColor: theme.accent, opacity: pressed ? 0.8 : 1 }]}>
              <Icon name="screen" color={theme.onAccent} size={18} strokeWidth={2.4} />
              <Text style={[styles.pillText, { color: theme.onAccent }]}>Ver en la tele</Text>
            </Pressable>
          </View>
        ) : playerFrame ? (
          <View pointerEvents="box-none" style={[styles.pillDock, { bottom: Spacing.three + insets.bottom }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityHint="Abre el video de la página para poder verlo en la tele"
              onPress={openPlayerFrame}
              style={({ pressed }) => [styles.pill, { backgroundColor: theme.accent, opacity: pressed ? 0.8 : 1 }]}>
              <Icon name="play" color={theme.onAccent} size={18} strokeWidth={2.4} />
              <Text style={[styles.pillText, { color: theme.onAccent }]}>Abrir el reproductor</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      <CastSheet
        visible={sheetOpen}
        candidates={candidates}
        pageTitle={pageTitle}
        onClose={() => setSheetOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingTop: Spacing.one,
    paddingBottom: Spacing.two,
    paddingHorizontal: Spacing.two,
  },
  iconButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  address: {
    flex: 1,
    minWidth: 0,
    height: 40,
    borderRadius: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  addressInput: { fontSize: 15, paddingVertical: 0 },
  addressText: { flex: 1, fontSize: 15 },
  progressTrack: { height: 2 },
  progress: { height: 2 },
  page: { flex: 1 },
  webView: { flex: 1 },
  state: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    padding: Spacing.four,
  },
  stateTitle: { fontSize: 18, fontWeight: '700', textAlign: 'center' },
  stateText: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  pillDock: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 40,
    paddingVertical: Spacing.two,
    paddingHorizontal: 14,
    borderRadius: 20,
  },
  pillText: { fontSize: 14, fontWeight: '700' },
});
