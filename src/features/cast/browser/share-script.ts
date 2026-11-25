/**
 * Web Share polyfill of the cast browser. Android's WebView has no navigator.share,
 * so sites such as YouTube hide or disable their "Compartir" button. Where the page
 * lacks it and the app bridge exists, this script adds navigator.share and
 * navigator.canShare: a share posts a 'maylo-share' message (title, text and an
 * absolute http(s) url) that the app opens in the phone's share sheet. Files cannot
 * be shared. It runs at document start, before the page checks for the API, and is
 * a no-op when the WebView already has a native navigator.share.
 */
export const SHARE_SCRIPT = String.raw`(function () {
  var nav = window.navigator;
  var bridge = window.ReactNativeWebView;
  if (!nav || typeof nav.share === 'function' || !bridge) return;

  function text(value) {
    return value == null ? '' : String(value);
  }

  function absolute(url) {
    try { return new URL(String(url), window.location.href).href; } catch (e) { return ''; }
  }

  function canShare(data) {
    if (!data || typeof data !== 'object') return false;
    if (data.files && data.files.length) return false;
    return data.url != null || data.text != null || data.title != null;
  }

  function share(data) {
    if (!canShare(data)) {
      return Promise.reject(new TypeError('Nothing to share'));
    }
    try {
      bridge.postMessage(JSON.stringify({
        type: 'maylo-share',
        title: text(data.title),
        text: text(data.text),
        url: data.url == null ? '' : absolute(data.url)
      }));
    } catch (e) {
      return Promise.reject(e);
    }
    return Promise.resolve();
  }

  try {
    nav.share = share;
    nav.canShare = canShare;
  } catch (e) {}
})();
true;`;

export const SHARE_MESSAGE_TYPE = 'maylo-share';

export type ShareRequest = { title: string; text: string; url: string };

/** A share the page asked for, or null. Only http(s) links are kept; something must remain to share. */
export function parseShareMessage(data: string): ShareRequest | null {
  try {
    const message = JSON.parse(data) as { type?: unknown; title?: unknown; text?: unknown; url?: unknown };
    if (message?.type !== SHARE_MESSAGE_TYPE) return null;
    const title = typeof message.title === 'string' ? message.title : '';
    const text = typeof message.text === 'string' ? message.text : '';
    const url = typeof message.url === 'string' && /^https?:\/\//i.test(message.url) ? message.url : '';
    if (!text && !url) return null;
    return { title, text, url };
  } catch {
    return null;
  }
}

/** The message for the share sheet: the page's text and its link, the link only once. */
export function shareText({ text, url }: ShareRequest): string {
  if (!url || text.includes(url)) return text;
  return text ? `${text}\n${url}` : url;
}
