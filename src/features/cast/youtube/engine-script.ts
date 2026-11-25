/**
 * The hidden engine WebView (S2b), NewPipe-style (PoTokenWebView is the design
 * reference only; no NewPipe code is used): a blank page on the youtube.com
 * origin that runs what must run in a real browser, never in Hermes:
 *
 * - `botguard` {interpreter, program, globalName}: runs the BotGuard
 *   interpreter and program and returns the snapshot (BotGuard answer).
 * - `mint` {integrityToken, identifier}: builds the minter from the snapshot's
 *   signal output and mints the PO token for `identifier` (web-safe base64).
 * - `player` {id, script?}: runs the player script (exported by
 *   player-script.ts); without `script` it only says whether `id` is loaded.
 * - `n` {values}: deciphers each `n` value with the player's URL class.
 *
 * The app injects `engineCallScript(...)`; the page answers through
 * ReactNativeWebView.postMessage with `{type:'maylo-engine', id, ok, value|error}`.
 * All network requests are made by the app, not by the page.
 *
 * BotGuard/minter code is ported from BgUtils (BotGuardClient, WebPoMinter and
 * the base64 helpers; LuanRT/BgUtils, MIT License, Copyright (c) 2024 LuanRT);
 * the n processor from YouTube.js (getNsigProcessorFn in src/utils/Utils.ts;
 * LuanRT/YouTube.js, MIT License, Copyright (c) 2021 LuanRT). See
 * THIRD_PARTY_NOTICES.md. No imports, so it is tested in Node.
 */

export const ENGINE_MESSAGE_TYPE = 'maylo-engine';

export const ENGINE_SCRIPT = String.raw`(function () {
  if (window.__mayloEngine) return;
  var TIMEOUT_MS = 15000;
  var state = { signals: null, minter: null, minterToken: null, playerId: null };

  function post(message) {
    message.type = 'maylo-engine';
    window.ReactNativeWebView.postMessage(JSON.stringify(message));
  }

  function withTimeout(promise, what) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { reject(new Error(what + ': timeout')); }, TIMEOUT_MS);
      promise.then(function (value) { clearTimeout(timer); resolve(value); }, function (error) { clearTimeout(timer); reject(error); });
    });
  }

  /* BgUtils base64ToU8 / u8ToBase64(.., true): base64url in, web-safe base64 (padding kept) out. */
  function base64ToU8(text) {
    var binary = atob(String(text).replace(/[-_.]/g, function (c) { return c === '-' ? '+' : c === '_' ? '/' : '='; }));
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function u8ToWebsafe(bytes) {
    var binary = '';
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_');
  }

  /* BgUtils BotGuardClient.load + snapshot. */
  function botguard(payload) {
    new Function(String(payload.interpreter || ''))();
    var vm = window[payload.globalName];
    if (!vm || typeof vm.a !== 'function') throw new Error('BotGuard unavailable');
    var noop = function () {};
    var ready = new Promise(function (resolve) {
      vm.a(payload.program, function (asyncSnapshot) { resolve(asyncSnapshot); }, true, undefined, noop, [[], []], undefined, false, [noop, noop, noop, noop, noop]);
    });
    var signals = [];
    return withTimeout(ready, 'BotGuard').then(function (asyncSnapshot) {
      return withTimeout(new Promise(function (resolve) {
        asyncSnapshot(function (response) { resolve(response); }, [undefined, undefined, signals, undefined]);
      }), 'snapshot');
    }).then(function (response) {
      if (typeof response !== 'string' || !response) throw new Error('empty BotGuard response');
      state.signals = signals;
      state.minter = null;
      state.minterToken = null;
      return response;
    });
  }

  /* BgUtils WebPoMinter.create + mintAsWebsafeString. */
  function mint(payload) {
    var token = String(payload.integrityToken || '');
    var minter = state.minter && state.minterToken === token ? Promise.resolve(state.minter) : null;
    if (!minter) {
      var getMinter = state.signals && state.signals[0];
      if (typeof getMinter !== 'function') throw new Error('PMD:Undefined');
      minter = withTimeout(Promise.resolve(getMinter(base64ToU8(token))), 'minter').then(function (callback) {
        if (typeof callback !== 'function') throw new Error('APF:Failed');
        state.minter = callback;
        state.minterToken = token;
        return callback;
      });
    }
    return minter.then(function (callback) {
      return withTimeout(Promise.resolve(callback(new TextEncoder().encode(String(payload.identifier)))), 'mint');
    }).then(function (result) {
      if (!result || typeof result.length !== 'number') throw new Error('ODM:Invalid');
      return u8ToWebsafe(result);
    });
  }

  function player(payload) {
    if (payload.script == null) return state.playerId === payload.id && typeof window.__mayloNsig === 'function';
    window.__mayloNsig = undefined;
    state.playerId = null;
    (0, eval)(String(payload.script));
    if (typeof window.__mayloNsig !== 'function') throw new Error('n function not exported');
    state.playerId = payload.id;
    return true;
  }

  /* YouTube.js getNsigProcessorFn: build a stream URL object, run its methods, read n back. */
  var SKIPPED = ['constructor', 'clone', 'set', 'get'];
  function decipher(n) {
    var wrap = window.__mayloNsig;
    if (typeof wrap !== 'function') throw new Error('player not loaded');
    var url = wrap('https://ytjs.googlevideo.com/videoplayback?expire=1234567890&n=' + encodeURIComponent(n), '', '');
    var names = Object.getOwnPropertyNames(Object.getPrototypeOf(url));
    for (var i = 0; i < names.length; i++) {
      if (SKIPPED.indexOf(names[i]) >= 0) continue;
      try {
        if (typeof url[names[i]] === 'function') url[names[i]]();
      } catch (error) {}
    }
    var result = url.get('n');
    result = result ? decodeURIComponent(result) : '';
    if (!result || result === n) throw new Error('n not deciphered');
    return result;
  }

  var handlers = {
    botguard: botguard,
    mint: mint,
    player: player,
    n: function (payload) {
      var values = payload.values || [];
      var out = [];
      for (var i = 0; i < values.length; i++) out.push(decipher(String(values[i])));
      return out;
    }
  };

  window.__mayloEngine = {
    run: function (id, type, payload) {
      Promise.resolve().then(function () {
        if (!Object.prototype.hasOwnProperty.call(handlers, type)) throw new Error('unknown call ' + type);
        return handlers[type](payload || {});
      }).then(function (value) {
        post({ id: id, ok: true, value: value });
      }, function (error) {
        post({ id: id, ok: false, error: String((error && error.message) || error).slice(0, 300) });
      });
    }
  };
})();
true;`;

/** Blank page that defines the engine; loaded with baseUrl https://www.youtube.com. */
export const ENGINE_HTML = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>MayLo</title></head>
<body>
<script>
${ENGINE_SCRIPT}
</script>
</body>
</html>
`;

/** JSON safe as JavaScript source on old engines too. */
const scriptJson = (value: unknown) =>
  JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

/** What the app injects to run one call. */
export function engineCallScript(id: string, type: string, payload: unknown): string {
  return `window.__mayloEngine && window.__mayloEngine.run(${scriptJson(id)}, ${scriptJson(type)}, ${scriptJson(payload)});\ntrue;`;
}

export type EngineReply = { id: string; ok: true; value: unknown } | { id: string; ok: false; error: string };

/** An engine answer from a WebView message, or null for anything else. */
export function parseEngineReply(data: string): EngineReply | null {
  let message: unknown;
  try {
    message = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof message !== 'object' || message == null) return null;
  const fields = message as Record<string, unknown>;
  if (fields.type !== ENGINE_MESSAGE_TYPE || typeof fields.id !== 'string') return null;
  if (fields.ok === true) return { id: fields.id, ok: true, value: fields.value };
  return { id: fields.id, ok: false, error: typeof fields.error === 'string' ? fields.error : 'error' };
}
