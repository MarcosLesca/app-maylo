/**
 * YouTube ad removal of the cast browser. YouTube serves its video ads from the
 * same hosts as the videos, so WebGuard's host blocking cannot stop them. On
 * youtube.com (and subdomains) and youtube-nocookie.com this script, injected at
 * document start in every frame with the detector, removes the ad fields
 * (AD_KEYS) from the player data before the player reads it, so it never asks
 * for an ad. It hooks the three ways that data arrives: the page's
 * ytInitialPlayerResponse, JSON.parse, and Response.prototype.json (the
 * /youtubei/v1/player fetches). Elsewhere it does nothing.
 *
 * YouTube changes this format from time to time; when ads come back, the
 * field names here are the first thing to check.
 *
 * The shield: while sessionStorage holds OFF_KEY = '1' the data passes untouched.
 * cast.tsx runs youtubeAdsStateScript() in the top frame when the shield changes
 * and before each top page loads. YouTube players embedded in other sites keep
 * their ads removed even with the shield off (only the top frame hears it).
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

  function prune(data) {
    try {
      if (!enabled() || !data || typeof data !== 'object') return data;
      strip(data);
      if (data.playerResponse && typeof data.playerResponse === 'object') strip(data.playerResponse);
    } catch (e) {}
    return data;
  }

  var originalParse = JSON.parse;
  JSON.parse = function () {
    return prune(originalParse.apply(this, arguments));
  };

  var response = window.Response && window.Response.prototype;
  if (response && typeof response.json === 'function') {
    var originalJson = response.json;
    response.json = function () {
      return originalJson.apply(this, arguments).then(prune);
    };
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
