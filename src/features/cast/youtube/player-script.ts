/**
 * YouTube's player script (base.js) as the engine WebView runs it (S2b):
 * which player is current, its signature timestamp, and the function that
 * builds a stream URL object and deciphers its `n` parameter.
 *
 * The function is found the way YouTube.js finds it (nsigMatcher in
 * src/utils/javascript/matchers.ts, LuanRT/YouTube.js, MIT License,
 * Copyright (c) 2021 LuanRT; see THIRD_PARTY_NOTICES.md): a function whose
 * first parameter is replaced by `new <UrlClass>(param, ...)` and that then
 * calls `param.set("alr","yes")`. YouTube.js walks a JavaScript AST; this port
 * matches the same shape in the source text, so no parser ships in the app.
 * Instead of cutting the function out, the whole player runs in the WebView
 * and the function is exported from inside its scope (recent players spread
 * the n logic over many helpers, so a standalone copy would not run).
 * Pure, no imports, so it is tested in Node.
 */

export const IFRAME_API_URL = 'https://www.youtube.com/iframe_api';

/** Where the engine finds the exported function after running the player. */
export const NSIG_EXPORT = 'window.__mayloNsig';

const PLAYER_ID = /\/s\\?\/player\\?\/([A-Za-z0-9_-]{6,})\\?\//;
const TIMESTAMP = /signatureTimestamp[=:](\d+)/;
const ALR = /([A-Za-z_$][\w$]*)\.set\((["'])alr\2,\s*(["'])yes\3\)/g;
const NAME_BEFORE = /([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)$/;
const SAFE_NAME = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;
const PLAYER_END = '})(_yt_player);';
/** How far back from `.set("alr","yes")` the function head may be. */
const MAX_HEAD_DISTANCE = 600;

/** The current player id from the iframe API script, or null. */
export function playerIdFromIframeApi(text: string): string | null {
  return PLAYER_ID.exec(text)?.[1] ?? null;
}

export function playerScriptUrl(id: string): string {
  return `https://www.youtube.com/s/player/${id}/player_ias.vflset/en_US/base.js`;
}

/** The `signatureTimestamp` the `player` request must carry, or null. */
export function signatureTimestamp(script: string): number | null {
  const match = TIMESTAMP.exec(script);
  return match ? Number(match[1]) : null;
}

/** Name of the n/sig URL wrapper (possibly dotted, e.g. `g.Qz`), or null. */
export function findNsigFunction(script: string): string | null {
  ALR.lastIndex = 0;
  for (let match = ALR.exec(script); match; match = ALR.exec(script)) {
    const target = match[1];
    const head = script.lastIndexOf('=function(', match.index);
    if (head < 0 || match.index - head > MAX_HEAD_DISTANCE) continue;
    const close = script.indexOf(')', head);
    if (close < 0 || close > match.index) continue;
    // Parameters may carry defaults (`b=""`); the first one is the URL.
    const params = script
      .slice(head + '=function('.length, close)
      .split(',')
      .map((param) => param.split('=')[0].trim());
    if (params.length < 3 || params[0] !== target) continue;
    const body = script.slice(close, match.index);
    if (!body.includes(`${target}=new `)) continue;
    const name = NAME_BEFORE.exec(script.slice(Math.max(0, head - 100), head))?.[1];
    if (name) return name;
  }
  return null;
}

/**
 * The player script with `window.__mayloNsig = <name>` added inside its
 * closing scope, or null when the player does not end the expected way.
 */
export function exportNsigScript(script: string, name: string): string | null {
  if (!SAFE_NAME.test(name)) return null;
  const end = script.lastIndexOf(PLAYER_END);
  if (end < 0) return null;
  return `${script.slice(0, end)};${NSIG_EXPORT}=${name};${script.slice(end)}`;
}
