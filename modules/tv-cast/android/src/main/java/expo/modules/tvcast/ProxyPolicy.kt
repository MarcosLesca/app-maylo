package expo.modules.tvcast

import java.net.URL

// Line-for-line port of src/features/cast/proxy-policy.ts; the TS tests pin these decisions.

/** Most targets one cast session remembers (initial target + playlist URIs). */
internal const val MAX_ALLOWED_TARGETS = 20_000

/** Lowercase host of an http(s) URL, or null. */
private fun httpHost(url: String): String? =
  try {
    val parsed = URL(url)
    if (parsed.protocol != "http" && parsed.protocol != "https") null else parsed.host.lowercase().ifEmpty { null }
  } catch (_: Exception) {
    null
  }

/**
 * The page's cookie may go to [target] only when it is on the same host as
 * [referer] (the frame the cookie was read from), and never from an https
 * page to a plain-http target.
 */
internal fun cookieAllowed(target: String, referer: String): Boolean {
  val targetHost = httpHost(target)
  val refererHost = httpHost(referer)
  if (targetHost == null || refererHost == null || targetHost != refererHost) return false
  return !(referer.lowercase().startsWith("https:") && target.lowercase().startsWith("http:"))
}

/**
 * Exact absolute target URLs one session may fetch: the one it was started
 * with plus every URI its rewritten playlists emitted. Past [max], the least
 * recently used one is forgotten (live playlists stay because the TV polls them).
 * Thread-safe: the TV fetches segments in parallel.
 */
internal class AllowedTargets(initial: String, private val max: Int = MAX_ALLOWED_TARGETS) {
  // Access order: a hit or a re-add moves the target to the newest end.
  private val targets = object : LinkedHashMap<String, Boolean>(16, 0.75f, true) {
    override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Boolean>?): Boolean = size > max
  }

  init {
    add(initial)
  }

  val size: Int
    get() = synchronized(targets) { targets.size }

  fun add(target: String) {
    synchronized(targets) { targets[target] = true }
  }

  /** True when the session issued [target]; a hit counts as a use. */
  fun has(target: String): Boolean = synchronized(targets) { targets[target] != null }
}
