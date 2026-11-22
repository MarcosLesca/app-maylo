/**
 * Pure helpers for the cast proxy (S5): how a target URL is encoded into a
 * proxy URL, and how HLS playlists are rewritten so every URI also goes
 * through the proxy. The native server (modules/tv-cast/.../HlsRewrite.kt)
 * implements the same algorithm line for line; these tests pin it.
 */

const SCHEME_AND_HOST = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i;
const EXTENSION = /\/[^/]*\.([a-z0-9]{1,5})$/i;
const URI_ATTRIBUTE = /URI="([^"]*)"/g;
const LINE_BREAK = /\r?\n/;
const BOM = /^\uFEFF/;
const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function utf8Bytes(text: string): number[] {
  const bytes: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    else
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
  }
  return bytes;
}

/** RFC 4648 base64url of the UTF-8 bytes, without padding. */
export function base64UrlEncode(text: string): string {
  const bytes = utf8Bytes(text);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += BASE64URL[(n >> 18) & 63] + BASE64URL[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += BASE64URL[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += BASE64URL[n & 63];
  }
  return out;
}

/** `/x.<ext>` from the target's path extension so the TV can infer the type, or ''. */
export function suffixFor(target: string): string {
  const path = target.replace(SCHEME_AND_HOST, '').split(/[?#]/)[0];
  const match = EXTENSION.exec(path);
  return match ? `/x.${match[1].toLowerCase()}` : '';
}

/** `sessionBase` is `http://<ip>:<port>/s/<token>`. */
export function proxyUrl(sessionBase: string, target: string, suffix: string = suffixFor(target)): string {
  return `${sessionBase}/${base64UrlEncode(target)}${suffix}`;
}

export function isHlsPlaylist(contentType: string, url: string, head: string): boolean {
  if (contentType.toLowerCase().includes('mpegurl')) return true;
  if (url.split(/[?#]/)[0].toLowerCase().endsWith('.m3u8')) return true;
  return head.replace(BOM, '').trimStart().startsWith('#EXTM3U');
}

/** Absolute http(s) URL of `ref` against `base`, or null (data:, skd:, unparsable). */
function resolveHttp(ref: string, base: string): string | null {
  try {
    const url = new URL(ref, base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Every URI line and every `URI="..."` attribute of an `#EXT` tag, resolved
 * against `playlistUrl` (the final URL after redirects) and wrapped in the proxy.
 * Lines end in `\n`; anything that does not resolve to http(s) stays as is.
 */
export function rewritePlaylist(body: string, playlistUrl: string, sessionBase: string): string {
  return body
    .replace(BOM, '')
    .split(LINE_BREAK)
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed === '') return line;
      if (trimmed.startsWith('#EXT')) {
        return line.replace(URI_ATTRIBUTE, (whole, ref: string) => {
          const resolved = resolveHttp(ref, playlistUrl);
          return resolved ? `URI="${proxyUrl(sessionBase, resolved)}"` : whole;
        });
      }
      if (trimmed.startsWith('#')) return line;
      const resolved = resolveHttp(trimmed, playlistUrl);
      return resolved ? proxyUrl(sessionBase, resolved) : line;
    })
    .join('\n');
}
