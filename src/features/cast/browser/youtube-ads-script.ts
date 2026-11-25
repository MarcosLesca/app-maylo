/**
 * YouTube ad removal of the cast browser. YouTube serves its video ads from the
 * same hosts as the videos, so WebGuard's host blocking cannot stop them. On
 * youtube.com (and subdomains) and youtube-nocookie.com this script, injected at
 * document start in every frame with the detector, removes the ad fields
 * (AD_KEYS) from the player data before the player reads it, so it never asks
 * for an ad. It hooks the three ways that data arrives: the page's
 * ytInitialPlayerResponse, JSON.parse, and Response.prototype.json (the
 * /youtubei/v1/player fetches), for an object, its playerResponse, and arrays of
 * those. The wrappers keep the toString and length of the functions they wrap.
 * Elsewhere it does nothing. The field names follow uBlock Origin's YouTube
 * filters (uAssets filters/filters.txt).
 *
 * YouTube changes this format from time to time; when ads come back, the
 * field names here are the first thing to check.
 *
 * The shield: while sessionStorage holds OFF_KEY = '1' the data passes untouched.
 * cast.tsx runs youtubeAdsStateScript() in the top frame when the shield changes
 * and before each top page loads. sessionStorage is per site, and on Android the
 * state may land after the first player data of a page, so after switching the
 * shield on another site the first YouTube video can still follow the old state.
 * On Android, YouTube players embedded in other sites keep their ads removed even
 * with the shield off (only the top frame hears it).
 */
const OFF_KEY = 'maylo-adblock-off';

export const YOUTUBE_ADS_SCRIPT = String.raw`(function () {
  if (window.__mayloYoutubeAds) return;
  var host = '';
  try { host = String(window.location.hostname || '').toLowerCase(); } catch (e) {}
  if (!/(^|\.)youtube\.com$|(^|\.)youtube-nocookie\.com$/.test(host)) return;
  window.__mayloYoutubeAds = true;

  var OFF_KEY = ${JSON.stringify(OFF_KEY)};
  var AD_KEYS = ['adPlacements', 'playerAds', 'adSlots', 'adBreakHeartbeatParams'];

  function enabled() {
    try { return window.sessionStorage.getItem(OFF_KEY) !== '1'; } catch (e) { return true; }
  }

  function strip(data) {
    if (!data || typeof data !== 'object') return;
    for (var i = 0; i < AD_KEYS.length; i++) {
      if (AD_KEYS[i] in data) delete data[AD_KEYS[i]];
    }
  }

  function stripResponse(data) {
    if (!data || typeof data !== 'object') return;
    strip(data);
    strip(data.playerResponse);
  }

  function prune(data) {
    try {
      if (!data || typeof data !== 'object' || !enabled()) return data;
      if (Array.isArray(data)) {
        for (var i = 0; i < data.length; i++) stripResponse(data[i]);
      } else {
        stripResponse(data);
      }
    } catch (e) {}
    return data;
  }

  // A hook that answers toString and length like the function it wraps.
  function disguise(hook, original) {
    try {
      Object.defineProperty(hook, 'length', { value: original.length });
      Object.defineProperty(hook, 'toString', {
        value: function () { return Function.prototype.toString.call(original); }
      });
    } catch (e) {}
    return hook;
  }

  var originalParse = JSON.parse;
  JSON.parse = disguise(function (text, reviver) {
    return prune(originalParse.apply(this, arguments));
  }, originalParse);

  var response = window.Response && window.Response.prototype;
  if (response && typeof response.json === 'function') {
    var originalJson = response.json;
    response.json = disguise(function () {
      return originalJson.apply(this, arguments).then(prune);
    }, originalJson);
  }

  try {
    var initial;
    Object.defineProperty(window, 'ytInitialPlayerResponse', {
      configurable: true,
      get: function () { return initial; },
      set: function (value) { initial = prune(value); }
    });
  } catch (e) {}
})();
true;`;

/** Run in the top frame: tells the page whether to remove YouTube ads (the shield is on). */
export function youtubeAdsStateScript(blocking: boolean): string {
  const action = blocking ? `removeItem(${JSON.stringify(OFF_KEY)})` : `setItem(${JSON.stringify(OFF_KEY)}, '1')`;
  return `try { window.sessionStorage.${action}; } catch (e) {}\ntrue;`;
}
