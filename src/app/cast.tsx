import { router } from 'expo-router';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { BackHandler, findNodeHandle, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';
import type { ShouldStartLoadRequest, WebViewOpenWindowEvent } from 'react-native-webview/lib/WebViewTypes';

import { Icon } from '@/components/icon';
import { Button } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { blockerLabel } from '@/features/cast/browser/adblock';
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
import {
  blockedBannerText,
  decideNavigation,
  hostOf,
  parseTapMessage,
  type BlockedKind,
} from '@/features/cast/browser/navigation-guard';
import { stopProxy } from '@/features/cast/proxy';
import { useTheme } from '@/hooks/use-theme';
import TvCast from '../../modules/tv-cast';
import WebGuard from '../../modules/web-guard';

// Ad blocking on/off lasts for the app session (the shield button), not only this screen visit.
let sessionBlocking = true;

type BlockedBanner = { kind: BlockedKind; host: string; url: string };

/** In-app browser: open any page, detect the video it plays and send it to the TV. */
export default function CastBrowserScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  // WebView's default generic types its props as `never`; `object` keeps the ref usable.
  const webView = useRef<WebView<object>>(null);
  // Host view around the WebView: its native tag lets TvCast find the android WebView.
  const pageHost = useRef<ComponentRef<typeof View>>(null);
  const frameScriptAdded = useRef(false);
  const guardAttached = useRef(false);
  const topUrl = useRef('');
  // Date.now() of the last user tap in the page (detector 'maylo-tap') or on an app button.
  const lastTapAt = useRef(0);
  // A URL the app itself navigates to (player frame, "Abrir igual"); the redirect guard lets it pass once.
  const allowUrl = useRef<string | null>(null);

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
  const [blocking, setBlocking] = useState(sessionBlocking);
  const [blockedCount, setBlockedCount] = useState(0);
  const [banner, setBanner] = useState<BlockedBanner | null>(null);

  // Blocked-request counts of the guarded WebView (native, throttled; 0 on a new top page).
  useEffect(() => {
    if (!WebGuard) return;
    WebGuard.setEnabled(sessionBlocking);
    const subscription = WebGuard.addListener('onBlockedCount', (event) => {
      if (event.viewTag === findNodeHandle(pageHost.current)) setBlockedCount(event.count);
    });
    return () => subscription.remove();
  }, []);

  const toggleBlocking = () => {
    const next = !blocking;
    sessionBlocking = next;
    WebGuard?.setEnabled(next);
    setBlocking(next);
  };

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
    lastTapAt.current = Date.now();
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

  // Native ad blocking for every frame: as early as the host view is laid out, retried on loads.
  const attachGuard = () => {
    if (guardAttached.current || !WebGuard) return;
    const tag = findNodeHandle(pageHost.current);
    if (tag == null) return;
    guardAttached.current = true;
    WebGuard.attachAsync(tag)
      .then((attached) => {
        guardAttached.current = attached;
      })
      .catch(() => {
        guardAttached.current = false;
      });
  };

  // A new top page drops the videos, player frames, blocked count and banner of the previous one.
  const onLoadStart = (event: { nativeEvent: WebViewNavigation }) => {
    attachGuard();
    addFrameDetector();
    const next = event.nativeEvent.url;
    if (!samePage(topUrl.current, next)) {
      setCandidates([]);
      setFrames([]);
      setBlockedCount(0);
      setBanner(null);
    }
    topUrl.current = next;
  };

  // Page-started navigations: a different site only right after a tap; app links only after a tap.
  const onShouldStartLoad = (request: ShouldStartLoadRequest) => {
    const decision = decideNavigation({
      url: request.url,
      currentUrl: topUrl.current,
      lastTapAt: lastTapAt.current,
      now: Date.now(),
      isTopFrame: request.isTopFrame,
      allowUrl: allowUrl.current,
    });
    if (request.url === allowUrl.current) allowUrl.current = null;
    if (decision.action === 'allow') return true;
    if (decision.action === 'external') Linking.openURL(request.url).catch(() => {});
    else setBanner({ kind: 'redirect', host: decision.host, url: request.url });
    return false;
  };

  // window.open / target=_blank: the native side never shows the new window; offer it instead.
  const onOpenWindow = (event: WebViewOpenWindowEvent) => {
    const target = event.nativeEvent.targetUrl;
    const host = hostOf(target);
    if (host) setBanner({ kind: 'popup', host, url: target });
  };

  // The app navigates the page itself: this tap counts, and the guard lets the URL pass once.
  const navigatePage = (target: string) => {
    lastTapAt.current = Date.now();
    allowUrl.current = target;
    webView.current?.injectJavaScript(`window.location.href = ${JSON.stringify(target)}; true;`);
  };

  const openBlocked = () => {
    if (!banner) return;
    setBanner(null);
    if (/^https?:\/\//i.test(banner.url)) navigatePage(banner.url);
    else Linking.openURL(banner.url).catch(() => {});
  };

  const onMessage = (event: WebViewMessageEvent) => {
    const { data } = event.nativeEvent;
    if (parseTapMessage(data)) {
      // Arrival time, not the page clock: both sides of the 1 s window use the app's clock.
      lastTapAt.current = Date.now();
      return;
    }
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
    if (playerFrame) navigatePage(playerFrame.url);
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
        {WebGuard ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={blockerLabel(blockedCount, blocking)}
            onPress={toggleBlocking}
            style={styles.iconButton}>
            <Icon
              name={blocking ? 'shield' : 'shieldOff'}
              color={blocking ? theme.accentText : theme.textSecondary}
              size={22}
            />
            {blocking && blockedCount > 0 ? (
              <View style={[styles.badge, { backgroundColor: theme.accent }]}>
                <Text style={[styles.badgeText, { color: theme.onAccent }]}>
                  {blockedCount > 99 ? '99+' : blockedCount}
                </Text>
              </View>
            ) : null}
          </Pressable>
        ) : null}
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
          <View ref={pageHost} collapsable={false} onLayout={attachGuard} style={styles.webView}>
            <WebView
              ref={webView}
              source={{ uri: source }}
              // Every scheme reaches onShouldStartLoad, so app links (intent:, market:) also need a tap.
              originWhitelist={['*']}
              onShouldStartLoadWithRequest={onShouldStartLoad}
              onOpenWindow={onOpenWindow}
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
              // With multiple windows on, window.open/target=_blank go to onOpenWindow instead of
              // navigating this page; the new window is never shown.
              setSupportMultipleWindows
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

        {banner ? (
          <View
            accessibilityLiveRegion="polite"
            style={[styles.banner, { backgroundColor: theme.backgroundElement }]}>
            <Text numberOfLines={2} style={[styles.bannerText, { color: theme.text }]}>
              {blockedBannerText(banner.kind, banner.host)}
            </Text>
            <Pressable accessibilityRole="button" onPress={openBlocked} style={styles.bannerAction}>
              <Text style={[styles.bannerActionText, { color: theme.accentText }]}>Abrir igual</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cerrar aviso"
              onPress={() => setBanner(null)}
              style={styles.iconButton}>
              <Icon name="close" color={theme.textSecondary} size={18} />
            </Pressable>
          </View>
        ) : null}

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
  badge: {
    position: 'absolute',
    top: Spacing.one,
    right: Spacing.half,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: Spacing.one,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 10, fontWeight: '700' },
  banner: {
    position: 'absolute',
    top: Spacing.two,
    left: Spacing.two,
    right: Spacing.two,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    borderRadius: 12,
    paddingLeft: Spacing.three,
  },
  bannerText: { flex: 1, fontSize: 13 },
  bannerAction: { minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.two },
  bannerActionText: { fontSize: 14, fontWeight: '700' },
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
