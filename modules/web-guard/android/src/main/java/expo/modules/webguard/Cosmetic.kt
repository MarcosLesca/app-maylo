package expo.modules.webguard

import android.content.Context
import android.net.Uri
import android.util.JsonReader
import android.webkit.WebResourceResponse
import java.io.ByteArrayInputStream
import java.io.InputStream
import java.io.InputStreamReader
import java.io.SequenceInputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Cosmetic filtering (S10): element-hiding selectors bundled in
 * assets/web-guard/cosmetic.json (built by scripts/update-adblock-list.mjs).
 * The loader injected in every frame (src/features/cast/browser/cosmetic-script.ts)
 * requests [STYLESHEET_URL]?host=<frame host>; [GuardedWebViewClient] (and the
 * service-worker client) answer it here with `sel,sel{display:none!important}`
 * blocks, so it never reaches the network. While the shield is off
 * ([Blocklist.enabled]) the stylesheet is empty.
 * [selectors] and [css] mirror cosmeticSelectors and cosmeticCss in
 * src/features/cast/browser/cosmetic.ts; keep them in step.
 */
object Cosmetic {
  /** Reserved name (RFC 6761 .invalid): never resolves, answered locally. */
  const val HOST = "maylo-web-guard.invalid"
  const val STYLESHEET_URL = "https://$HOST/cosmetic.css"
  const val CHUNK_SIZE = 1000

  private const val ASSET = "web-guard/cosmetic.json"
  private const val HIDE = "{display:none!important}"
  // The first page may ask before the asset is parsed; wait a little (WebView IO thread) instead of showing ads.
  private const val LOAD_WAIT_MS = 3000L
  private val EMPTY = ByteArray(0)

  class Index(
    val generic: List<String>,
    val hosts: Map<String, List<String>>,
    val exceptions: Map<String, Set<String>>,
    val genericHide: Set<String>,
    val elemHide: Set<String>,
  ) {
    /** The common case (no exception for the host): built once. */
    val genericCss: ByteArray by lazy { css(generic).toByteArray(Charsets.UTF_8) }
  }

  class Selection(val generic: List<String>, val specific: List<String>)

  @Volatile private var index: Index? = null
  private val loaded = CountDownLatch(1)
  private var loading = false

  /** Parses the asset once, off the main thread. */
  @Synchronized
  fun loadAsync(context: Context) {
    if (loading) return
    loading = true
    val assets = context.applicationContext.assets
    Thread({
      try {
        index = assets.open(ASSET).use { read(it) }
      } catch (_: Exception) {
        synchronized(this) { loading = false }
      } finally {
        loaded.countDown()
      }
    }, "web-guard-cosmetic").start()
  }

  private fun read(stream: InputStream): Index {
    var generic: List<String> = emptyList()
    var hosts: Map<String, List<String>> = emptyMap()
    var exceptions: Map<String, Set<String>> = emptyMap()
    var genericHide: Set<String> = emptySet()
    var elemHide: Set<String> = emptySet()
    JsonReader(InputStreamReader(stream, Charsets.UTF_8)).use { reader ->
      reader.beginObject()
      while (reader.hasNext()) {
        when (reader.nextName()) {
          "generic" -> generic = readStrings(reader)
          "hosts" -> hosts = readMap(reader) { it }
          "exceptions" -> exceptions = readMap(reader) { it.toHashSet() }
          "genericHide" -> genericHide = readStrings(reader).toHashSet()
          "elemHide" -> elemHide = readStrings(reader).toHashSet()
          else -> reader.skipValue()
        }
      }
      reader.endObject()
    }
    return Index(generic, hosts, exceptions, genericHide, elemHide)
  }

  private fun readStrings(reader: JsonReader): List<String> {
    val list = ArrayList<String>()
    reader.beginArray()
    while (reader.hasNext()) list.add(reader.nextString())
    reader.endArray()
    return list
  }

  private fun <T> readMap(reader: JsonReader, convert: (List<String>) -> T): Map<String, T> {
    val map = HashMap<String, T>()
    reader.beginObject()
    while (reader.hasNext()) {
      val key = reader.nextName()
      map[key] = convert(readStrings(reader))
    }
    reader.endObject()
    return map
  }

  fun isStylesheetRequest(url: Uri?): Boolean = url != null && HOST.equals(url.host, ignoreCase = true)

  /** The answer to any request for the reserved host: CSS for `?host=`, empty while disabled. */
  fun response(url: Uri): WebResourceResponse {
    val host = (try { url.getQueryParameter("host") } catch (_: Exception) { null }) ?: ""
    return WebResourceResponse(
      "text/css",
      "utf-8",
      200,
      "OK",
      mapOf("Access-Control-Allow-Origin" to "*", "Cache-Control" to "no-store"),
      if (Blocklist.enabled) stylesheet(host) else ByteArrayInputStream(EMPTY),
    )
  }

  private fun stylesheet(host: String): InputStream {
    if (index == null) {
      try {
        loaded.await(LOAD_WAIT_MS, TimeUnit.MILLISECONDS)
      } catch (_: InterruptedException) {
        Thread.currentThread().interrupt()
      }
    }
    val current = index ?: return ByteArrayInputStream(EMPTY)
    val selection = selectors(current, host)
    val specific = ByteArrayInputStream(css(selection.specific).toByteArray(Charsets.UTF_8))
    val generic =
      if (selection.generic === current.generic) current.genericCss
      else css(selection.generic).toByteArray(Charsets.UTF_8)
    return SequenceInputStream(ByteArrayInputStream(generic), specific)
  }

  /**
   * Selectors for [host]: rules and exceptions of the host and each parent domain
   * (never a bare TLD). The generic list is [Index.generic] itself when nothing removes any of it.
   */
  fun selectors(index: Index, host: String): Selection {
    val levels = ArrayList<String>()
    var name = Blocklist.normalizeHost(host)
    while (name.contains('.')) {
      levels.add(name)
      name = name.substring(name.indexOf('.') + 1)
    }
    if (levels.any { index.elemHide.contains(it) }) return Selection(emptyList(), emptyList())
    val noGeneric = levels.any { index.genericHide.contains(it) }
    val excluded = HashSet<String>()
    for (level in levels) index.exceptions[level]?.let { excluded.addAll(it) }
    val specific = LinkedHashSet<String>()
    for (level in levels) {
      index.hosts[level]?.forEach { if (!excluded.contains(it)) specific.add(it) }
    }
    val generic = when {
      noGeneric -> emptyList()
      excluded.isEmpty() -> index.generic
      else -> index.generic.filter { !excluded.contains(it) }
    }
    return Selection(generic, specific.toList())
  }

  /** `sel,sel{display:none!important}` lines of at most [chunkSize] selectors; :has() ones in their own blocks. */
  fun css(selectors: List<String>, chunkSize: Int = CHUNK_SIZE): String {
    val plain = ArrayList<String>()
    val has = ArrayList<String>()
    for (selector in selectors) (if (selector.contains(":has(")) has else plain).add(selector)
    val out = StringBuilder()
    for (group in listOf(plain, has)) {
      var start = 0
      while (start < group.size) {
        val end = minOf(start + chunkSize, group.size)
        for (i in start until end) {
          if (i > start) out.append(',')
          out.append(group[i])
        }
        out.append(HIDE).append('\n')
        start = end
      }
    }
    return out.toString()
  }
}
