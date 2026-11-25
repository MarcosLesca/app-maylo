package expo.modules.tvcast

import android.util.Base64
import java.net.URL

// Line-for-line port of src/features/cast/hls.ts; the TS tests pin this algorithm.
private val SCHEME_AND_HOST = Regex("^[a-zA-Z][a-zA-Z0-9+.-]*://[^/?#]*")
private val EXTENSION = Regex("/[^/]*\\.([a-zA-Z0-9]{1,5})$")
private val URI_ATTRIBUTE = Regex("URI=\"([^\"]*)\"")
private val LINE_BREAK = Regex("\r?\n")
private val QUERY_OR_FRAGMENT = Regex("[?#]")
private const val BOM = "\uFEFF"
private const val BASE64URL_FLAGS = Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING

/** Most extra exact targets a session may allow besides its main one (S5: YouTube video + audio). */
internal const val MAX_EXTRA_TARGETS = 4

internal object Hls {
  /** RFC 4648 base64url of the UTF-8 bytes, without padding. */
  fun base64UrlEncode(text: String): String =
    Base64.encodeToString(text.toByteArray(Charsets.UTF_8), BASE64URL_FLAGS)

  /** Inverse of [base64UrlEncode], or null when [value] is not base64url. */
  fun base64UrlDecode(value: String): String? =
    try {
      String(Base64.decode(value, Base64.URL_SAFE or Base64.NO_WRAP), Charsets.UTF_8)
    } catch (_: IllegalArgumentException) {
      null
    }

  /** `/x.<ext>` from the target's path extension so the TV can infer the type, or "". */
  fun suffixFor(target: String): String {
    val path = target.replaceFirst(SCHEME_AND_HOST, "").split(QUERY_OR_FRAGMENT)[0]
    val match = EXTENSION.find(path)
    return if (match != null) "/x." + match.groupValues[1].lowercase() else ""
  }

  /** [sessionBase] is `http://<ip>:<port>/s/<token>`. */
  fun proxyUrl(sessionBase: String, target: String, suffix: String = suffixFor(target)): String =
    "$sessionBase/${base64UrlEncode(target)}$suffix"

  /** register() accepts these extras: at most [MAX_EXTRA_TARGETS], each http:// or https://. */
  fun extraTargetsValid(extras: List<String>): Boolean =
    extras.size <= MAX_EXTRA_TARGETS && extras.all { it.startsWith("http://") || it.startsWith("https://") }

  fun isHlsPlaylist(contentType: String, url: String, head: String): Boolean {
    if (contentType.lowercase().contains("mpegurl")) return true
    if (url.split(QUERY_OR_FRAGMENT)[0].lowercase().endsWith(".m3u8")) return true
    return head.removePrefix(BOM).trimStart().startsWith("#EXTM3U")
  }

  /** Absolute http(s) URL of [ref] against [base], or null (data:, skd:, unparsable). */
  private fun resolveHttp(ref: String, base: String): String? =
    try {
      val url = URL(URL(base), ref)
      if (url.protocol == "http" || url.protocol == "https") url.toString() else null
    } catch (_: Exception) {
      null
    }

  /**
   * Every URI line and every `URI="..."` attribute of an `#EXT` tag, resolved
   * against [playlistUrl] (the final URL after redirects) and wrapped in the proxy.
   * Lines end in `\n`; anything that does not resolve to http(s) stays as is.
   * [onTarget] gets every absolute target wrapped, so the session can allow it.
   */
  fun rewritePlaylist(
    body: String,
    playlistUrl: String,
    sessionBase: String,
    onTarget: (String) -> Unit = {},
  ): String {
    val wrap = { target: String ->
      onTarget(target)
      proxyUrl(sessionBase, target)
    }
    return body
      .removePrefix(BOM)
      .split(LINE_BREAK)
      .joinToString("\n") { line ->
        val trimmed = line.trim()
        when {
          trimmed.isEmpty() -> line
          trimmed.startsWith("#EXT") -> URI_ATTRIBUTE.replace(line) { match ->
            val resolved = resolveHttp(match.groupValues[1], playlistUrl)
            if (resolved != null) "URI=\"${wrap(resolved)}\"" else match.value
          }
          trimmed.startsWith("#") -> line
          else -> {
            val resolved = resolveHttp(trimmed, playlistUrl)
            if (resolved != null) wrap(resolved) else line
          }
        }
      }
  }
}
