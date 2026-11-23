/**
 * Cosmetic filtering loader of the cast browser (S10). Injected at document start
 * in every frame together with the detector (see detector-script.ts for how),
 * it adds `<link rel="stylesheet" href="<base>?host=<frame host>">` and re-adds it
 * when the page removes it. The base URL is a reserved, never-resolving address
 * (WebGuard.cosmeticStylesheetUrl()) that the native WebGuard answers itself in
 * shouldInterceptRequest with the hiding rules for that host (cosmetic.ts), or
 * with an empty stylesheet while the shield is off; it never reaches the network.
 * So the script stays tiny and the selectors (tens of thousands) never cross the
 * JS bridge. Only use it where WebGuard provides that URL.
 *
 * Shield toggles run cosmeticRefreshScript() in the top frame: every frame
 * reloads its stylesheet and passes the message on to its child frames.
 */
export const COSMETIC_REFRESH_MESSAGE = 'maylo-cosmetic-refresh';

export function cosmeticScript(baseUrl: string): string {
  return String.raw`(function () {
  if (window.__mayloCosmetic) return;
  var BASE = ${JSON.stringify(baseUrl)};
  var MESSAGE = ${JSON.stringify(COSMETIC_REFRESH_MESSAGE)};
  var host = '';
  try {
    if (/^https?:$/.test(window.location.protocol)) host = String(window.location.hostname || '').toLowerCase();
  } catch (e) {}
  if (!host) return;
  var link = null;
  var version = 0;

  function ensure() {
    try {
      if (link && link.isConnected) return;
      var root = document.head || document.documentElement;
      if (!root) return;
      link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = BASE + '?host=' + encodeURIComponent(host) + (version ? '&v=' + version : '');
      link.setAttribute('data-maylo', 'cosmetic');
      root.appendChild(link);
    } catch (e) {}
  }

  function refresh() {
    version++;
    try { if (link && link.parentNode) link.parentNode.removeChild(link); } catch (e) {}
    link = null;
    ensure();
    try {
      for (var i = 0; i < window.frames.length; i++) window.frames[i].postMessage(MESSAGE, '*');
    } catch (e) {}
  }

  window.__mayloCosmetic = { refresh: refresh };
  ensure();
  document.addEventListener('DOMContentLoaded', ensure);
  window.addEventListener('message', function (event) {
    if (event && event.data === MESSAGE && event.source === window.parent) refresh();
  });
  if (typeof window.MutationObserver === 'function') {
    try {
      new window.MutationObserver(function () { if (!link || !link.isConnected) ensure(); })
        .observe(document, { childList: true, subtree: true });
    } catch (e) {}
  }
})();
true;`;
}

/** Run in the top frame after the shield changes: every frame reloads its stylesheet. */
export function cosmeticRefreshScript(): string {
  return 'try { if (window.__mayloCosmetic) window.__mayloCosmetic.refresh(); } catch (e) {}\ntrue;';
}
