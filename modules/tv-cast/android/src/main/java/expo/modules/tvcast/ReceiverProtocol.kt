package expo.modules.tvcast

import org.json.JSONObject
import org.json.JSONTokener

// Line-for-line port of src/features/cast/receiver/receiver-protocol.ts; the TS tests pin these rules.

/** Fixed port first, then the next ones; the screen shows the one that was free. */
internal val RECEIVER_PORTS: List<Int> = (0 until 11).map { 8765 + it }

/** Commands kept for the TV; older ones are dropped. */
internal const val MAX_COMMANDS = 50

/** Largest state body the TV may POST. */
internal const val MAX_STATE_BYTES = 16 * 1024

/** How long an idle commands request waits before answering empty. */
internal const val LONG_POLL_MS = 25_000L

/** Concurrent waiting commands requests; extra ones answer empty at once. */
internal const val MAX_LONG_POLLS = 2

/** The receiver is connected while its last state is at most this old. */
internal const val CONNECTED_WINDOW_MS = 5_000L

private val KEY = Regex("^[A-Za-z0-9]{6}$")
private val AFTER = Regex("^[0-9]{1,15}$")
private val DIGITS = Regex("^[0-9]+$")

internal fun isReceiverKey(key: String): Boolean = KEY.matches(key)

internal sealed class ReceiverRoute {
  object Page : ReceiverRoute()
  object HlsScript : ReceiverRoute()
  class Commands(val after: Long) : ReceiverRoute()
  object State : ReceiverRoute()
  object NotFound : ReceiverRoute()
  object MethodNotAllowed : ReceiverRoute()
}

/** `after` of a query string; missing or not a plain non-negative integer means 0. */
internal fun parseAfter(query: String): Long {
  for (pair in query.split('&')) {
    val equals = pair.indexOf('=')
    if (equals < 0 || pair.substring(0, equals) != "after") continue
    val value = pair.substring(equals + 1)
    return if (AFTER.matches(value)) value.toLong() else 0L
  }
  return 0L
}

/**
 * Route of a request for the receiver whose key is [key] ("" when stopped);
 * null when the path is not under `/tv` (the proxy's). A wrong key and an
 * unknown path are both not found.
 */
internal fun routeReceiver(method: String, target: String, key: String): ReceiverRoute? {
  val hash = target.indexOf('#')
  val withoutHash = if (hash < 0) target else target.substring(0, hash)
  val question = withoutHash.indexOf('?')
  val path = if (question < 0) withoutHash else withoutHash.substring(0, question)
  val query = if (question < 0) "" else withoutHash.substring(question + 1)
  if (path != "/tv" && !path.startsWith("/tv/")) return null
  val segments = path.split('/') // "", "tv", key, rest...
  if (segments.size < 3 || key == "" || !isReceiverKey(segments[2]) || segments[2] != key) {
    return ReceiverRoute.NotFound
  }
  val rest = when (segments.size) {
    3 -> ""
    4 -> segments[3]
    else -> null
  }
  val read = method == "GET" || method == "HEAD"
  return when (rest) {
    "" -> if (read) ReceiverRoute.Page else ReceiverRoute.MethodNotAllowed
    "hls.js" -> if (read) ReceiverRoute.HlsScript else ReceiverRoute.MethodNotAllowed
    "commands" -> if (method == "GET") ReceiverRoute.Commands(parseAfter(query)) else ReceiverRoute.MethodNotAllowed
    "state" -> if (method == "POST") ReceiverRoute.State else ReceiverRoute.MethodNotAllowed
    else -> ReceiverRoute.NotFound
  }
}

/** A JSON object text, or null for anything else (arrays, scalars, trailing garbage). */
internal fun parseObject(json: String): JSONObject? =
  try {
    val tokener = JSONTokener(json)
    val value = tokener.nextValue()
    // nextClean() is '\u0000' only at the end: anything after the object is rejected.
    if (value is JSONObject && tokener.nextClean() == '\u0000') value else null
  } catch (_: Exception) {
    null
  }

/**
 * The last MAX_COMMANDS commands, each serialized as `{"id":n, ...command}`
 * with ids increasing from [firstId] for the whole run (clear() keeps counting).
 * Not thread-safe: the receiver guards it.
 */
internal class CommandQueue(firstId: Long) {
  private var nextId = firstId
  private val items = ArrayDeque<Pair<Long, String>>()

  /** Highest id issued this run (firstId - 1 when none). */
  val lastId: Long get() = nextId - 1

  /** Appends [command] (a JSON object text) and returns its id; throws for anything else. */
  fun push(command: String): Long {
    val parsed = parseObject(command) ?: throw IllegalArgumentException("The command must be a JSON object.")
    val id = nextId
    nextId += 1
    val ordered = JSONObject()
    ordered.put("id", id)
    for (name in parsed.keys()) if (name != "id") ordered.put(name, parsed.get(name))
    items.addLast(id to ordered.toString())
    while (items.size > MAX_COMMANDS) items.removeFirst()
    return id
  }

  /**
   * Commands with an id above [after], oldest first. A cursor above the
   * highest id this run issued comes from a previous run: it means 0.
   */
  fun since(after: Long): List<String> {
    val cursor = if (after > lastId) 0L else after
    return items.filter { it.first > cursor }.map { it.second }
  }

  fun clear() {
    items.clear()
  }
}

internal fun commandsBody(commands: List<String>): String = "{\"commands\":[${commands.joinToString(",")}]}"

/** Why a state POST with this Content-Length is refused (411/413), or null to read it. */
internal fun stateBodyError(contentLength: String?): Int? {
  if (contentLength == null || !DIGITS.matches(contentLength)) return 411
  if (contentLength.length > 9 || contentLength.toInt() > MAX_STATE_BYTES) return 413
  return null
}

internal fun isConnected(lastSeenMs: Long, nowMs: Long): Boolean =
  lastSeenMs > 0 && nowMs - lastSeenMs <= CONNECTED_WINDOW_MS

/*
 * CORS (shared receivers): the page served by one phone polls and posts to the
 * other phone, and plays its proxied HLS with hls.js (XHR), so every /tv and /s
 * response carries these headers and an OPTIONS preflight there answers 204
 * at once. The key (/tv) and the session token (/s) are still checked on the
 * actual requests.
 */
internal val CORS_HEADERS: List<Pair<String, String>> = listOf(
  "Access-Control-Allow-Origin" to "*",
  "Access-Control-Allow-Methods" to "GET, POST, OPTIONS, HEAD",
  "Access-Control-Allow-Headers" to "Range, Content-Type",
  "Access-Control-Expose-Headers" to "Content-Length, Content-Range, Accept-Ranges",
)

/** Seconds the TV may cache a preflight answer. */
internal const val CORS_MAX_AGE = "600"

internal const val PREFLIGHT_STATUS = 204

private val QUERY_OR_HASH = Regex("[?#]")

/** True for the receiver (`/tv`, `/tv/...`) and proxy (`/s/...`) paths. */
internal fun isCorsRoute(target: String): Boolean {
  val path = target.split(QUERY_OR_HASH, limit = 2)[0]
  return path == "/tv" || path.startsWith("/tv/") || path.startsWith("/s/")
}

internal fun isCorsPreflight(method: String, target: String): Boolean = method == "OPTIONS" && isCorsRoute(target)
