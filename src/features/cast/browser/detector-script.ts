/**
 * Injected before content loads into every frame of the cast browser (cross-origin
 * iframes included, on Android). It only watches what the page itself plays or
 * requests and reports those URLs; it never changes requests, never touches DRM
 * and has no per-site rules. Messages are parsed by candidates.ts.
 *
 * Reported: <video>/<source> sources (not blob:), and fetch/XHR/resource requests
 * whose path ends in .m3u8, .mp4, .webm or .mkv. Each carries the frame URL (the
 * Referer), its title, navigator.userAgent and document.cookie.
 */
export const DETECTOR_SCRIPT = String.raw`(function () {
  if (window.__mayloVideoDetector) return;
  window.__mayloVideoDetector = true;

  var MEDIA_PATH = /\.(m3u8|mp4|webm|mkv)$/i;
  var sent = {};

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

  // Media events do not bubble, so listen in the capture phase.
  document.addEventListener('loadstart', function (event) { reportElement(event.target); }, true);
  document.addEventListener('play', function (event) { reportElement(event.target); }, true);
  document.addEventListener('DOMContentLoaded', scan);

  if (typeof window.MutationObserver === 'function') {
    try {
      new window.MutationObserver(scan).observe(document, {
        childList: true, subtree: true, attributes: true, attributeFilter: ['src']
      });
    } catch (e) {}
  }

  // A page restored from the back/forward cache must report its video again.
  window.addEventListener('pageshow', function (event) {
    if (event && event.persisted) { sent = {}; scan(); }
  });
})();
true;`;
