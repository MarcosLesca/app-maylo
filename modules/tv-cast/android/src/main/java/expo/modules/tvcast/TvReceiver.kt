package expo.modules.tvcast

import java.io.DataInputStream
import java.io.InputStream
import java.util.concurrent.TimeUnit
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/** A complete small response; the server adds Content-Length and Connection: close. */
internal class HttpReply(val status: Int, val headers: List<Pair<String, String>>, val body: ByteArray)

/**
 * The TV browser receiver (S1, S4): the page under `/tv/<key>`, the vendored
 * hls.js, the command queue the page long-polls and the last state it posted.
 * It holds no socket: [CastProxy] serves it on the same port as the videos.
 */
internal class TvReceiver {
  private val lock = ReentrantLock()
  private val changed = lock.newCondition()

  // Ids keep increasing across app restarts, so a TV holding an old cursor never skips new commands.
  private val queue = CommandQueue(System.currentTimeMillis())
  private var key = ""
  private var html = ByteArray(0)
  private var hls: ByteArray? = null
  private var waiting = 0
  private var generation = 0L
  private var state = ""
  private var stateAddress = ""
  private var lastSeenMs = 0L

  val active: Boolean get() = lock.withLock { key != "" }

  fun start(key: String, html: String, hls: ByteArray?) {
    lock.withLock {
      this.key = key
      this.html = html.toByteArray(Charsets.UTF_8)
      this.hls = hls
    }
  }

  /** Forgets the page, the pending commands and the TV state; waiting polls answer empty. */
  fun stop() {
    lock.withLock {
      key = ""
      html = ByteArray(0)
      queue.clear()
      state = ""
      stateAddress = ""
      lastSeenMs = 0L
      generation += 1
      changed.signalAll()
    }
  }

  /** Queues [command] (a JSON object text) for the TV; false when the receiver is not started. */
  fun push(command: String): Boolean {
    lock.withLock {
      if (key == "") return false
      queue.push(command) // IllegalArgumentException when it is not a JSON object
      changed.signalAll()
      return true
    }
  }

  fun snapshot(): Map<String, Any> {
    lock.withLock {
      return mapOf(
        "connected" to isConnected(lastSeenMs, System.currentTimeMillis()),
        "address" to stateAddress,
        "lastSeenMs" to lastSeenMs.toDouble(),
        "state" to state,
      )
    }
  }

  /** The receiver's route for this request, or null when the path belongs to the proxy. */
  fun route(method: String, path: String): ReceiverRoute? = routeReceiver(method, path, lock.withLock { key })

  fun handle(route: ReceiverRoute, headers: Map<String, String>, input: InputStream, remote: String): HttpReply =
    when (route) {
      is ReceiverRoute.Page -> lock.withLock {
        HttpReply(200, listOf("Content-Type" to "text/html; charset=utf-8", "Cache-Control" to "no-store"), html)
      }
      is ReceiverRoute.HlsScript -> lock.withLock { hls }?.let {
        HttpReply(
          200,
          listOf("Content-Type" to "application/javascript; charset=utf-8", "Cache-Control" to "public, max-age=86400"),
          it,
        )
      } ?: empty(404)
      is ReceiverRoute.Commands -> commands(route.after)
      is ReceiverRoute.State -> postState(headers, input, remote)
      is ReceiverRoute.MethodNotAllowed -> empty(405)
      is ReceiverRoute.NotFound -> empty(404)
    }

  /**
   * Pending commands at once, or after waiting up to LONG_POLL_MS for one. At
   * most MAX_LONG_POLLS requests wait, so they never pin the proxy's pool;
   * extra ones answer empty at once.
   */
  private fun commands(after: Long): HttpReply {
    val pending = lock.withLock {
      var found = queue.since(after)
      if (found.isEmpty() && waiting < MAX_LONG_POLLS) {
        waiting += 1
        val started = generation
        try {
          var nanos = TimeUnit.MILLISECONDS.toNanos(LONG_POLL_MS)
          while (found.isEmpty() && nanos > 0 && started == generation) {
            nanos = changed.awaitNanos(nanos)
            found = queue.since(after)
          }
        } finally {
          waiting -= 1
        }
      }
      found
    }
    return HttpReply(
      200,
      listOf("Content-Type" to "application/json; charset=utf-8", "Cache-Control" to "no-store"),
      commandsBody(pending).toByteArray(Charsets.UTF_8),
    )
  }

  /** Stores the page's state (a JSON object of at most MAX_STATE_BYTES) with the TV's address and time. */
  private fun postState(headers: Map<String, String>, input: InputStream, remote: String): HttpReply {
    stateBodyError(headers["content-length"])?.let { return empty(it) }
    val body = ByteArray(headers["content-length"]!!.toInt())
    DataInputStream(input).readFully(body) // EOFException drops the request
    val text = String(body, Charsets.UTF_8)
    if (parseObject(text) == null) return empty(400)
    lock.withLock {
      if (key == "") return empty(404) // stopped while the body arrived
      state = text
      stateAddress = remote
      lastSeenMs = System.currentTimeMillis()
    }
    return HttpReply(204, emptyList(), ByteArray(0))
  }

  private fun empty(status: Int) = HttpReply(status, emptyList(), ByteArray(0))
}
