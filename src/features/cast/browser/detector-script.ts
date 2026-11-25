/**
 * Video detector of the cast browser. react-native-webview 14 on Android injects
 * its injectedJavaScript* props into the main frame only (the *ForMainFrameOnly
 * flags are ignored there), so the app also registers this script natively with
 * WebViewCompat.addDocumentStartJavaScript (TvCast.addDocumentStartScriptAsync),
 * which runs it in every frame, cross-origin iframes included, where the WebView
 * supports it. It may run twice in a frame; the guard below makes that a no-op.
 * It only watches what the page itself plays or requests and reports those URLs;
 * it never changes requests, never touches DRM and has no per-site rules.
 * Messages are parsed by candidates.ts.
 *
 * Reported ('maylo-video'): <video>/<source> sources (not blob:), and
 * fetch/XHR/resource requests whose path ends in .m3u8, .mp4, .webm or .mkv. Each
 * carries the frame URL (the Referer), its title, navigator.userAgent and
 * document.cookie.
 * Reported by the top page only ('maylo-frame'): large visible http(s) iframes
 * (at least 200×120), so the app can offer to open the player when no video
 * was seen (e.g. where the script cannot run inside iframes).
 * Reported by the top page only ('maylo-next'): its first http(s) link to another
 * page whose rel is next or whose text/aria-label is next-episode wording (es/en,
 * same rule as next-episode.ts), once per page, so the app can offer
 * "Siguiente episodio" when the cast ends.
 * Reported by the top page only ('maylo-page'): its URL and title each time
 * either changes without a page load (history.pushState/replaceState, popstate,
 * or a 1 s check for title updates), so single-page apps keep the app's
 * address and title current. The values at document start are not reported.
 * Reported by every frame ('maylo-tap', with Date.now()): trusted user taps,
 * at most one per 250 ms, so the app lets a navigation that follows a tap
 * through its redirect guard (navigation-guard.ts). Synthetic clicks are ignored.
 */
export const DETECTOR_SCRIPT = String.raw`(function () {
  if (window.__mayloVideoDetector) return;
  window.__mayloVideoDetector = true;

  var MEDIA_PATH = /\.(m3u8|mp4|webm|mkv)$/i;
  var MIN_FRAME_WIDTH = 200;
  var MIN_FRAME_HEIGHT = 120;
  var NEXT_EPISODE = /^(?:siguiente(?: (?:episodio|cap[ií]tulo))?|pr[oó]ximo (?:episodio|cap[ií]tulo)|next(?: episode)?)$/;
  var sent = {};
  var framesSent = {};
  var nextSent = false;
  var isTop = false;
  try { isTop = window.top === window; } catch (e) {}

  function absolute(url) {
    try { return new URL(String(url), window.location.href).href; } catch (e) { return ''; }
  }

  function report(url) {
    try {
      var href = absolute(url);
      if (!/^https?:/i.test(href) || sent[href]) return;
      sent[href] = true;
      var bridge = window.ReactNativeWebView;
      if (!bridge) return;
      bridge.postMessage(JSON.stringify({
        type: 'maylo-video',
        url: href,
        pageUrl: window.location.href,
        title: document.title || '',
        userAgent: window.navigator.userAgent || '',
        cookie: document.cookie || ''
      }));
    } catch (e) {}
  }

  function reportIfMedia(url) {
    try {
      var href = absolute(url);
      if (href && MEDIA_PATH.test(new URL(href).pathname)) report(href);
    } catch (e) {}
  }

  function reportElement(el) {
    if (!el || !el.tagName) return;
    var tag = String(el.tagName).toUpperCase();
    if (tag !== 'VIDEO' && tag !== 'SOURCE') return;
    var src = el.currentSrc || el.src || (el.getAttribute && el.getAttribute('src'));
    if (src) report(src);
  }

  function scan() {
    try {
      var list = document.querySelectorAll('video, video source');
      for (var i = 0; i < list.length; i++) reportElement(list[i]);
    } catch (e) {}
  }

  function reportFrame(el) {
    try {
      var href = absolute(el.src || (el.getAttribute && el.getAttribute('src')) || '');
      if (!/^https?:/i.test(href) || framesSent[href]) return;
      var rect = el.getBoundingClientRect();
      var width = Math.round(rect.width);
      var height = Math.round(rect.height);
      if (width < MIN_FRAME_WIDTH || height < MIN_FRAME_HEIGHT) return;
      var style = typeof window.getComputedStyle === 'function' ? window.getComputedStyle(el) : null;
      if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) return;
      var bridge = window.ReactNativeWebView;
      if (!bridge) return;
      framesSent[href] = true;
      bridge.postMessage(JSON.stringify({
        type: 'maylo-frame',
        url: href,
        pageUrl: window.location.href,
        width: width,
        height: height
      }));
    } catch (e) {}
  }

  function scanFrames() {
    if (!isTop) return;
    try {
      var list = document.querySelectorAll('iframe');
      for (var i = 0; i < list.length; i++) reportFrame(list[i]);
    } catch (e) {}
  }

  function linkWords(text) {
    return String(text || '').toLowerCase().replace(/\s+/g, ' ')
      .replace(/^[^a-z0-9áéíóúüñ]+|[^a-z0-9áéíóúüñ]+$/g, '');
  }

  // The first link to the next episode (see next-episode.ts), once per page.
  function scanNext() {
    if (!isTop || nextSent) return;
    try {
      var page = String(window.location.href).split('#')[0];
      var list = document.querySelectorAll('a[href]');
      for (var i = 0; i < list.length; i++) {
        var el = list[i];
        var href = absolute(el.href || (el.getAttribute && el.getAttribute('href')) || '');
        if (!/^https?:/i.test(href) || href.split('#')[0] === page) continue;
        var rel = (el.getAttribute && el.getAttribute('rel')) || '';
        var aria = (el.getAttribute && el.getAttribute('aria-label')) || '';
        var text = String(el.textContent || '').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
        if (!/(^|\s)next(\s|$)/i.test(rel) && !NEXT_EPISODE.test(linkWords(text)) && !NEXT_EPISODE.test(linkWords(aria))) continue;
        var bridge = window.ReactNativeWebView;
        if (!bridge) return;
        nextSent = true;
        var label = linkWords(text) ? text : linkWords(aria) ? aria : 'Siguiente episodio';
        bridge.postMessage(JSON.stringify({
          type: 'maylo-next',
          url: href,
          label: String(label).slice(0, 80),
          pageUrl: window.location.href
        }));
        return;
      }
    } catch (e) {}
  }

  // Layout is expensive: look at iframes at most once per burst of DOM changes.
  var framesPending = false;
  function scheduleFrames() {
    if (!isTop || framesPending) return;
    framesPending = true;
    setTimeout(function () { framesPending = false; scanFrames(); scanNext(); }, 800);
  }

  var originalFetch = window.fetch;
  if (typeof originalFetch === 'function') {
    window.fetch = function (input) {
      try { reportIfMedia(typeof input === 'string' ? input : (input && input.url) || String(input)); } catch (e) {}
      return originalFetch.apply(this, arguments);
    };
  }

  var xhr = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
  if (xhr && typeof xhr.open === 'function') {
    var originalOpen = xhr.open;
    xhr.open = function (method, url) {
      try { reportIfMedia(url); } catch (e) {}
      return originalOpen.apply(this, arguments);
    };
  }

  // Requests the page makes without fetch/XHR (the <video> element itself, workers' results).
  if (typeof window.PerformanceObserver === 'function') {
    try {
      new window.PerformanceObserver(function (entries) {
        var list = entries.getEntries();
        for (var i = 0; i < list.length; i++) reportIfMedia(list[i].name);
      }).observe({ type: 'resource', buffered: true });
    } catch (e) {}
  }

  // User taps (trusted only), so the app can tell a tapped link from a redirect.
  var lastTap = 0;
  function reportTap(event) {
    try {
      if (!event || event.isTrusted !== true) return;
      var now = Date.now();
      if (now - lastTap < 250) return;
      lastTap = now;
      var bridge = window.ReactNativeWebView;
      if (bridge) bridge.postMessage(JSON.stringify({ type: 'maylo-tap', at: now }));
    } catch (e) {}
  }
  window.addEventListener('pointerdown', reportTap, true);
  window.addEventListener('click', reportTap, true);

  // Single-page apps change URL and title without a load: the top page reports each change once.
  if (isTop) {
    var lastPage = String(window.location.href) + '\n' + (document.title || '');
    var checkPage = function () {
      try {
        var href = String(window.location.href);
        var title = document.title || '';
        if (href + '\n' + title === lastPage) return;
        lastPage = href + '\n' + title;
        var bridge = window.ReactNativeWebView;
        if (bridge) bridge.postMessage(JSON.stringify({ type: 'maylo-page', url: href, title: title }));
      } catch (e) {}
    };
    var wrapHistory = function (name) {
      var history = window.history;
      var original = history && history[name];
      if (typeof original !== 'function') return;
      history[name] = function () {
        var result = original.apply(this, arguments);
        checkPage();
        return result;
      };
    };
    wrapHistory('pushState');
    wrapHistory('replaceState');
    window.addEventListener('popstate', checkPage);
    if (typeof window.setInterval === 'function') window.setInterval(checkPage, 1000);
  }

  // Media events do not bubble, so listen in the capture phase.
  document.addEventListener('loadstart', function (event) { reportElement(event.target); }, true);
  document.addEventListener('play', function (event) { reportElement(event.target); }, true);
  document.addEventListener('DOMContentLoaded', function () { scan(); scanFrames(); scanNext(); });
  window.addEventListener('load', function () { scanFrames(); scanNext(); });

  if (typeof window.MutationObserver === 'function') {
    try {
      new window.MutationObserver(function () { scan(); scheduleFrames(); }).observe(document, {
        childList: true, subtree: true, attributes: true, attributeFilter: ['src']
      });
    } catch (e) {}
  }

  // A page restored from the back/forward cache must report its video again.
  window.addEventListener('pageshow', function (event) {
    if (event && event.persisted) { sent = {}; framesSent = {}; nextSent = false; scan(); scanFrames(); scanNext(); }
  });
})();
true;`;
