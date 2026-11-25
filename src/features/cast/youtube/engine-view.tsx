import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { attachEngine, handleEngineMessage } from './engine';
import { ENGINE_HTML } from './engine-script';

/**
 * The hidden engine WebView (S2b): a blank page on the youtube.com origin where
 * BotGuard mints the PO token and the player script deciphers `n`. Mounted by
 * the root layout (so queued YouTube casts resolve with the browser closed); invisible and not touchable. It attaches once its page has
 * loaded and detaches when unmounted or when its renderer dies (then reloads).
 */
const ENGINE_BASE = 'https://www.youtube.com';

/** The inline engine page (loaded with the youtube.com base URL), not a page it navigated to. */
function isEnginePage(url: string | undefined): boolean {
  if (!url) return false;
  return url === ENGINE_BASE || url === `${ENGINE_BASE}/` || url.startsWith('about:') || url.startsWith('data:');
}

export function YoutubeEngineView() {
  const webView = useRef<WebView<object>>(null);
  const detach = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      detach.current?.();
      detach.current = null;
    },
    [],
  );

  const onLoadEnd = (event: { nativeEvent: { url: string } }) => {
    detach.current?.();
    detach.current = null;
    // Only our own inline page may answer engine calls, never a page it was navigated to.
    if (!isEnginePage(event.nativeEvent.url)) return;
    detach.current = attachEngine((script) => webView.current?.injectJavaScript(script));
  };

  const onMessage = (event: WebViewMessageEvent) => {
    if (!isEnginePage(event.nativeEvent.url)) return;
    handleEngineMessage(event.nativeEvent.data);
  };

  // A dead renderer loses the BotGuard minter and the player: detach, then load the page again.
  const restart = () => {
    detach.current?.();
    detach.current = null;
    webView.current?.reload();
  };

  return (
    <View pointerEvents="none" importantForAccessibility="no-hide-descendants" style={styles.hidden}>
      <WebView
        ref={webView}
        source={{ html: ENGINE_HTML, baseUrl: 'https://www.youtube.com' }}
        originWhitelist={['*']}
        // The remote BotGuard and player scripts must not move this WebView elsewhere.
        onShouldStartLoadWithRequest={(request) => isEnginePage(request.url)}
        onLoadEnd={onLoadEnd}
        onMessage={onMessage}
        onRenderProcessGone={restart}
        onContentProcessDidTerminate={restart}
        javaScriptEnabled
        domStorageEnabled
        style={styles.webView}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: { position: 'absolute', left: 0, top: 0, width: 1, height: 1, opacity: 0, overflow: 'hidden' },
  webView: { width: 1, height: 1 },
});
