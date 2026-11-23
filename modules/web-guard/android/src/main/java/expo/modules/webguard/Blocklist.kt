package expo.modules.webguard

import android.content.Context
import android.net.Uri
import java.util.Locale

/**
 * Ad/tracker domains bundled in assets/web-guard/blocklist.txt (one per line,
 * '#' comments) plus filter-list exceptions as allow lines: "@@host" (allowed
 * everywhere although a parent is listed) and "@@host site,site" (allowed on
 * pages of those sites). Host matching mirrors src/features/cast/browser/adblock.ts
 * (normalizeHost, isBlockedHost, parseAllowRules, isAllowedHost,
 * shouldBlockRequest); keep them in step.
 */
object Blocklist {
  private const val ASSET = "web-guard/blocklist.txt"

  private class Rules(
    val domains: Set<String>,
    val allowHosts: Set<String>,
    val allowSites: Map<String, Set<String>>,
  )

  @Volatile private var rules = Rules(emptySet(), emptySet(), emptyMap())
  private var loading = false

  /** Session switch from JS (the shield button); also turns cosmetic filtering off. */
  @Volatile var enabled = true

  /** Reads the list once, off the main thread; nothing is blocked until it is loaded. */
  @Synchronized
  fun loadAsync(context: Context) {
    if (loading) return
    loading = true
    val assets = context.applicationContext.assets
    Thread({
      try {
        val domains = HashSet<String>(131_072)
        val allowHosts = HashSet<String>()
        val allowSites = HashMap<String, MutableSet<String>>()
        assets.open(ASSET).bufferedReader().useLines { lines ->
          for (line in lines) {
            val text = line.substringBefore('#').trim()
            if (text.startsWith("@@")) {
              parseAllow(text.substring(2), allowHosts, allowSites)
              continue
            }
            val name = normalizeHost(text)
            if (name.contains('.')) domains.add(name)
          }
        }
        rules = Rules(domains, allowHosts, allowSites)
      } catch (_: Exception) {
        synchronized(this) { loading = false }
      }
    }, "web-guard-blocklist").start()
  }

  private fun parseAllow(text: String, hosts: MutableSet<String>, sites: MutableMap<String, MutableSet<String>>) {
    val fields = text.split(WHITESPACE).filter { it.isNotEmpty() }
    if (fields.isEmpty() || fields.size > 2) return
    val host = normalizeHost(fields[0])
    if (!host.contains('.')) return
    if (fields.size == 1) {
      hosts.add(host)
      return
    }
    val names = fields[1].split(',').map { normalizeHost(it) }.filter { it.contains('.') }
    if (names.isNotEmpty()) sites.getOrPut(host) { HashSet() }.addAll(names)
  }

  private val WHITESPACE = Regex("\\s+")

  /** Lowercase, trimmed, without a trailing dot or IPv6 brackets. */
  fun normalizeHost(host: String): String {
    var name = host.trim().lowercase(Locale.ROOT)
    if (name.endsWith(".")) name = name.substring(0, name.length - 1)
    if (name.length >= 2 && name.startsWith("[") && name.endsWith("]")) name = name.substring(1, name.length - 1)
    return name
  }

  /** True when [host] or one of its parent domains (never a bare TLD) is listed. */
  fun isBlockedHost(host: String, blocked: Set<String> = rules.domains): Boolean {
    var name = normalizeHost(host)
    while (name.contains('.')) {
      if (blocked.contains(name)) return true
      name = name.substring(name.indexOf('.') + 1)
    }
    return false
  }

  /** True when an allow line of [host] or a parent domain applies on a page of [topHost]. */
  fun isAllowedHost(host: String, topHost: String): Boolean {
    val current = rules
    if (current.allowHosts.isEmpty() && current.allowSites.isEmpty()) return false
    var name = normalizeHost(host)
    while (name.contains('.')) {
      if (current.allowHosts.contains(name)) return true
      val sites = current.allowSites[name]
      if (sites != null && isBlockedHost(topHost, sites)) return true
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
    return isBlockedHost(host) && !isAllowedHost(host, topHost ?: "")
  }
}
