package expo.modules.webguard

import android.content.Context
import android.net.Uri
import java.util.Locale

/**
 * Ad/tracker domains bundled in assets/web-guard/blocklist.txt (one per line,
 * '#' comments). Host matching mirrors src/features/cast/browser/adblock.ts
 * (normalizeHost, isBlockedHost, shouldBlockRequest); keep them in step.
 */
object Blocklist {
  private const val ASSET = "web-guard/blocklist.txt"

  @Volatile private var domains: Set<String> = emptySet()
  private var loading = false

  /** Session switch from JS (the shield button). */
  @Volatile var enabled = true

  /** Reads the list once, off the main thread; nothing is blocked until it is loaded. */
  @Synchronized
  fun loadAsync(context: Context) {
    if (loading) return
    loading = true
    val assets = context.applicationContext.assets
    Thread({
      try {
        val set = HashSet<String>(16_384)
        assets.open(ASSET).bufferedReader().useLines { lines ->
          for (line in lines) {
            val name = normalizeHost(line.substringBefore('#'))
            if (name.contains('.')) set.add(name)
          }
        }
        domains = set
      } catch (_: Exception) {
        synchronized(this) { loading = false }
      }
    }, "web-guard-blocklist").start()
  }

  /** Lowercase, trimmed, without a trailing dot or IPv6 brackets. */
  fun normalizeHost(host: String): String {
    var name = host.trim().lowercase(Locale.ROOT)
    if (name.endsWith(".")) name = name.substring(0, name.length - 1)
    if (name.length >= 2 && name.startsWith("[") && name.endsWith("]")) name = name.substring(1, name.length - 1)
    return name
  }

  /** True when [host] or one of its parent domains (never a bare TLD) is listed. */
  fun isBlockedHost(host: String, blocked: Set<String> = domains): Boolean {
    var name = normalizeHost(host)
    while (name.contains('.')) {
      if (blocked.contains(name)) return true
      name = name.substring(name.indexOf('.') + 1)
    }
    return false
  }

  /** The top-level document, non-network schemes and the page's own host are never blocked. */
  fun shouldBlock(url: Uri?, isMainFrame: Boolean, topHost: String?): Boolean {
    if (!enabled || isMainFrame || url == null) return false
    val scheme = url.scheme?.lowercase(Locale.ROOT) ?: return false
    if (scheme != "http" && scheme != "https" && scheme != "ws" && scheme != "wss") return false
    val host = normalizeHost(url.host ?: return false)
    if (host.isEmpty() || host == normalizeHost(topHost ?: "")) return false
    return isBlockedHost(host)
  }
}
