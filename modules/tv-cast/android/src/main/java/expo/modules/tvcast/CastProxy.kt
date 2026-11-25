package expo.modules.tvcast

import expo.modules.kotlin.exception.CodedException
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.net.URL
import java.security.SecureRandom
import java.util.Collections
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadFactory
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

private const val MAX_THREADS = 12
private const val MAX_QUEUED = 24
private const val MAX_REQUEST_HEAD = 16 * 1024
private const val HEAD_TIMEOUT_MS = 5_000
private const val STREAM_TIMEOUT_MS = 30_000
private const val MAX_PLAYLIST = 8 * 1024 * 1024
private const val MAX_REDIRECTS = 5
private const val BUFFER = 64 * 1024
private const val MPEGURL = "application/vnd.apple.mpegurl"
private val QUERY_OR_FRAGMENT = Regex("[?#]")

// Never forwarded from the page: they describe our own connection or would break the relay.
private val DROPPED_HEADERS = setOf(
  "host", "connection", "keep-alive", "proxy-connection", "proxy-authorization", "te", "trailer",
  "transfer-encoding", "upgrade", "content-length", "range", "accept-encoding",
)

private class ProxyRequest(val method: String, val path: String, val headers: Map<String, String>)

/** One cast: its random token, the page headers, and the exact targets it may fetch. */
private class Session(
  val token: String,
  val headers: Map<String, String>,
  val referer: String,
  val allowed: AllowedTargets,
)

/** The target resolves to this phone, loopback or link-local: never fetched for the LAN. */
private class ForbiddenTargetException(host: String) : IOException("forbidden target host $host")

/**
 * HTTP server on the phone's Wi-Fi address that serves videos to the TV with the
 * page's Referer/User-Agent/Cookie (S5). Only `/s/<token>/<base64url(target)>[/x.ext]`
 * of the one active session is served, and only for targets that session issued
 * (its initial video, the exact extra targets it was started with, e.g. a
 * YouTube video's audio, and the URIs of the playlists it rewrote), so it is not
 * an open relay on the LAN. Starting a cast revokes the previous one. A client
 * Range header is forwarded and the origin's 206/Content-Range relayed as is
 * (except for .m3u8 targets, which are rewritten whole).
 *
 * The same server, on port 8765 (or the next free one up to 8775), also serves
 * the TV browser receiver under `/tv/<key>` (S1, S4). The receiver keeps it
 * running without a cast session; stopping the proxy then only revokes sessions.
 *
 * Every `/tv` and `/s` response carries CORS headers and an OPTIONS preflight
 * there answers 204, so the receiver page served by the other member's phone
 * can poll this one and play its proxied HLS; the key and the session token
 * still gate the actual requests.
 */
internal class CastProxy {
  private val lock = Any()
  private var server: ServerSocket? = null
  private var pool: ThreadPoolExecutor? = null
  private var host = ""
  private val random = SecureRandom()
  private val clients: MutableSet<Socket> = Collections.newSetFromMap(ConcurrentHashMap<Socket, Boolean>())

  // Connections serving a cast session: revoking the session cuts only these, not the receiver's polls.
  private val proxyClients: MutableSet<Socket> = Collections.newSetFromMap(ConcurrentHashMap<Socket, Boolean>())
  private val receiver = TvReceiver()

  // Only one cast at a time: a new session replaces (revokes) the previous one.
  @Volatile private var session: Session? = null

  /**
   * Starts the server if needed and makes a new session for [target] (plus the
   * exact [extraTargets], at most [MAX_EXTRA_TARGETS]) the only active one,
   * cutting the previous session's streams; `{ baseUrl, sessionId }`.
   */
  fun register(
    headers: Map<String, String>,
    target: String,
    extraTargets: List<String> = emptyList(),
  ): Map<String, String> {
    if (!(target.startsWith("http://") || target.startsWith("https://")) || !Hls.extraTargetsValid(extraTargets)) {
      throw CodedException("ERR_BAD_TARGET", "Este video no se puede pasar a la tele.", null)
    }
    val token = newToken()
    val clean = headers.filter { (name, value) ->
      name.isNotBlank() &&
        name.lowercase() !in DROPPED_HEADERS &&
        name.none { it == '\r' || it == '\n' || it == ':' } &&
        value.none { it == '\r' || it == '\n' }
    }
    val referer = clean.entries.firstOrNull { it.key.equals("referer", ignoreCase = true) }?.value ?: ""
    val baseUrl = synchronized(lock) {
      val started = startLocked()
      val allowed = AllowedTargets(target)
      for (extra in extraTargets) allowed.add(extra)
      session = Session(token, clean, referer, allowed)
      started
    }
    // Nothing uses the new token yet, so every open stream belongs to a revoked session.
    for (client in proxyClients.toList()) closeQuietly(client)
    return mapOf("baseUrl" to baseUrl, "sessionId" to token)
  }

  /** Revokes the cast session; the server keeps running while the receiver is started. */
  fun stop() {
    synchronized(lock) {
      session = null
      for (client in proxyClients.toList()) closeQuietly(client)
      if (!receiver.active) stopLocked()
    }
  }

  /**
   * Starts the server if needed and serves [html] at `/tv/<key>` plus [hls] at
   * `/tv/<key>/hls.js`; `{ url, port, address }` with the port actually bound.
   */
  fun startReceiver(key: String, html: String, hls: ByteArray?): Map<String, Any> {
    if (!isReceiverKey(key)) {
      throw CodedException("ERR_BAD_KEY", "La clave del receptor debe tener 6 letras o números.", null)
    }
    synchronized(lock) {
      startLocked()
      receiver.start(key, html, hls)
      val port = server?.localPort ?: 0
      return mapOf("url" to "http://$host:$port/tv/$key", "port" to port, "address" to host)
    }
  }

  /** Stops serving the receiver, and the server too when no cast session is active. */
  fun stopReceiver() {
    synchronized(lock) {
      receiver.stop()
      if (session == null) stopLocked()
    }
  }

  fun pushReceiverCommand(command: String) {
    val queued = try {
      receiver.push(command)
    } catch (_: IllegalArgumentException) {
      throw CodedException("ERR_BAD_COMMAND", "La orden para la tele debe ser un objeto JSON.", null)
    }
    if (!queued) throw CodedException("ERR_RECEIVER_STOPPED", "El receptor de la tele no está activo.", null)
  }

  fun receiverState(): Map<String, Any> = receiver.snapshot()

  /** Everything off: session, receiver and server (module destroyed). */
  fun shutdown() {
    synchronized(lock) {
      session = null
      receiver.stop()
      stopLocked()
    }
  }

  private fun startLocked(): String {
    val address = wifiAddress()
      ?: throw CodedException(
        "ERR_NO_WIFI",
        "No encontré la red Wi-Fi del teléfono. Conectalo al mismo Wi-Fi que la tele.",
        null,
      )
    val addressText = address.hostAddress ?: ""
    val current = server
    if (current != null && !current.isClosed && host == addressText) {
      return "http://$host:${current.localPort}"
    }
    // First start, or the Wi-Fi address changed: rebind on the current one.
    stopLocked()
    val socket = bind(address)
    val threads = ThreadFactory { runnable -> Thread(runnable, "maylo-cast-proxy").apply { isDaemon = true } }
    val executor = ThreadPoolExecutor(
      MAX_THREADS, MAX_THREADS, 30, TimeUnit.SECONDS, ArrayBlockingQueue<Runnable>(MAX_QUEUED), threads,
    )
    executor.allowCoreThreadTimeOut(true)
    server = socket
    pool = executor
    host = addressText
    Thread({ acceptLoop(socket, executor) }, "maylo-cast-accept").apply { isDaemon = true }.start()
    return "http://$host:${socket.localPort}"
  }

  /** Port 8765, else the next free one up to 8775, so the TV can keep the receiver as a favorite. */
  private fun bind(address: Inet4Address): ServerSocket {
    for (port in RECEIVER_PORTS) {
      val socket = ServerSocket()
      try {
        // A restart must not wait for our own TIME_WAIT connections; a live listener still blocks the port.
        socket.reuseAddress = true
        socket.bind(InetSocketAddress(address, port), 50)
        return socket
      } catch (_: IOException) {
        closeQuietly(socket)
      }
    }
    throw CodedException(
      "ERR_NO_PORT",
      "Los puertos ${RECEIVER_PORTS.first()} a ${RECEIVER_PORTS.last()} del teléfono están ocupados.",
      null,
    )
  }

  private fun stopLocked() {
    closeQuietly(server)
    server = null
    pool?.shutdownNow()
    pool = null
    // Blocking socket IO ignores interrupts: closing the sockets ends running streams.
    for (client in clients.toList()) closeQuietly(client)
    clients.clear()
    proxyClients.clear()
  }

  private fun newToken(): String {
    val bytes = ByteArray(16)
    random.nextBytes(bytes)
    return bytes.joinToString("") { (it.toInt() and 0xff).toString(16).padStart(2, '0') }
  }

  /** IPv4 of the Wi-Fi interface (wlan*), else any private IPv4 that is not mobile data. */
  private fun wifiAddress(): Inet4Address? = WifiNetwork.scanInterfaces()?.second

  private fun acceptLoop(socket: ServerSocket, executor: ThreadPoolExecutor) {
    while (!socket.isClosed) {
      val client = try {
        socket.accept()
      } catch (_: Exception) {
        break
      }
      try {
        executor.execute { handle(client) }
      } catch (_: RejectedExecutionException) {
        closeQuietly(client)
      }
    }
  }

  private fun handle(client: Socket) {
    clients.add(client)
    try {
      // A client that trickles its request head must not hold a pool thread for long.
      client.soTimeout = HEAD_TIMEOUT_MS
      val input = BufferedInputStream(client.getInputStream())
      val output = client.getOutputStream().buffered(BUFFER)
      val request = readRequest(input) ?: return
      if (isCorsPreflight(request.method, request.path)) {
        // Answered before any key or token check: the actual request is the one that is checked.
        writeHead(output, PREFLIGHT_STATUS, listOf("Access-Control-Max-Age" to CORS_MAX_AGE), cors = true)
        output.flush()
        return
      }
      val route = receiver.route(request.method, request.path)
      if (route != null) {
        // Small bodies only: the head timeout still bounds a trickled state POST.
        val reply = receiver.handle(route, request.headers, input, client.inetAddress?.hostAddress ?: "")
        writeReply(output, reply, request.method == "HEAD", isCorsRoute(request.path))
        output.flush()
        return
      }
      proxyClients.add(client)
      client.soTimeout = STREAM_TIMEOUT_MS
      val local = client.localAddress.hostAddress ?: host
      serve(request, "http://$local:${client.localPort}", output)
      output.flush()
    } catch (_: Throwable) {
      // The TV hung up mid-stream, the upstream failed, or we were stopped: just drop it.
      // Throwable, so nothing escapes and kills the pool thread or the app.
    } finally {
      clients.remove(client)
      proxyClients.remove(client)
      closeQuietly(client)
    }
  }

  private fun writeReply(out: OutputStream, reply: HttpReply, isHead: Boolean, cors: Boolean) {
    // A 204 must not carry Content-Length.
    val length = if (reply.status == 204) emptyList() else listOf("Content-Length" to reply.body.size.toString())
    writeHead(out, reply.status, reply.headers + length, cors)
    if (!isHead && reply.status != 204) out.write(reply.body)
  }

  private fun readRequest(input: InputStream): ProxyRequest? {
    val head = ByteArrayOutputStream()
    var matched = 0 // progress through "\r\n\r\n"
    while (matched < 4) {
      val byte = input.read()
      if (byte == -1 || head.size() >= MAX_REQUEST_HEAD) return null
      head.write(byte)
      matched = when {
        byte == '\r'.code && (matched == 0 || matched == 2) -> matched + 1
        byte == '\n'.code && (matched == 1 || matched == 3) -> matched + 1
        byte == '\r'.code -> 1
        else -> 0
      }
    }
    val lines = head.toString("ISO-8859-1").split("\r\n")
    val parts = lines[0].split(" ")
    if (parts.size < 2) return null
    val headers = HashMap<String, String>()
    for (line in lines.drop(1)) {
      val colon = line.indexOf(':')
      if (colon > 0) headers[line.substring(0, colon).trim().lowercase()] = line.substring(colon + 1).trim()
    }
    return ProxyRequest(parts[0].uppercase(), parts[1], headers)
  }

  private fun serve(request: ProxyRequest, origin: String, out: OutputStream) {
    val cors = isCorsRoute(request.path)
    if (request.method != "GET" && request.method != "HEAD") {
      writeEmpty(out, 405, cors)
      return
    }
    // "", "s", token, base64url(target), optional file-like suffix
    val segments = request.path.split(QUERY_OR_FRAGMENT)[0].split('/')
    if (segments.size < 4 || segments[0] != "" || segments[1] != "s") {
      writeEmpty(out, 404, cors)
      return
    }
    val token = segments[2]
    val session = this.session
    if (session == null || session.token != token) {
      writeEmpty(out, 404, cors)
      return
    }
    val target = Hls.base64UrlDecode(segments[3])
    if (target == null || !(target.startsWith("http://") || target.startsWith("https://"))) {
      writeEmpty(out, 400, cors)
      return
    }
    // Only URLs this session issued: the token alone must not fetch arbitrary URLs.
    if (!session.allowed.has(target)) {
      writeEmpty(out, 403, cors)
      return
    }
    val isHead = request.method == "HEAD"
    val targetIsPlaylist = target.split(QUERY_OR_FRAGMENT)[0].lowercase().endsWith(".m3u8")
    // A playlist is rewritten whole, so a byte range of it would be meaningless.
    val range = if (targetIsPlaylist) null else request.headers["range"]
    val connection = try {
      open(target, session, range, isHead)
    } catch (_: ForbiddenTargetException) {
      writeEmpty(out, 403, cors)
      return
    } catch (_: Exception) {
      writeEmpty(out, 502, cors)
      return
    }
    try {
      relay(connection, request, isHead, targetIsPlaylist, "$origin/s/$token", session, out)
    } finally {
      connection.disconnect()
    }
  }

  /**
   * Follows redirects by hand so http↔https hops work. Every hop must resolve to
   * a host outside this phone, and gets the Cookie only on the page's own host.
   */
  private fun open(target: String, session: Session, range: String?, isHead: Boolean): HttpURLConnection {
    var url = URL(target)
    repeat(MAX_REDIRECTS + 1) {
      checkPublicHost(url.host)
      val sendCookie = cookieAllowed(url.toString(), session.referer)
      val connection = url.openConnection() as HttpURLConnection
      connection.instanceFollowRedirects = false
      connection.connectTimeout = 15_000
      connection.readTimeout = 30_000
      connection.requestMethod = if (isHead) "HEAD" else "GET"
      for ((name, value) in session.headers) {
        if (name.equals("cookie", ignoreCase = true) && !sendCookie) continue
        connection.setRequestProperty(name, value)
      }
      // Keep bytes and Content-Length exactly as the origin sends them.
      connection.setRequestProperty("Accept-Encoding", "identity")
      if (range != null) connection.setRequestProperty("Range", range)
      val status = connection.responseCode
      val location = connection.getHeaderField("Location")
      if (status in 300..399 && status != 304 && location != null) {
        val next = URL(url, location)
        connection.disconnect()
        if (next.protocol != "http" && next.protocol != "https") throw IOException("redirect to ${next.protocol}")
        url = next
        return@repeat
      }
      return connection
    }
    throw IOException("too many redirects")
  }

  /** Throws [ForbiddenTargetException] when [host] resolves to loopback, link-local, any-local or this phone. */
  private fun checkPublicHost(host: String) {
    val addresses = InetAddress.getAllByName(host) // UnknownHostException -> 502
    val own = ownAddresses()
    if (addresses.any { it.isLoopbackAddress || it.isLinkLocalAddress || it.isAnyLocalAddress || it in own }) {
      throw ForbiddenTargetException(host)
    }
  }

  private fun ownAddresses(): Set<InetAddress> =
    try {
      NetworkInterface.getNetworkInterfaces()?.toList().orEmpty().flatMap { it.inetAddresses.toList() }.toSet()
    } catch (_: Exception) {
      emptySet()
    }

  private fun relay(
    connection: HttpURLConnection,
    request: ProxyRequest,
    isHead: Boolean,
    targetIsPlaylist: Boolean,
    sessionBase: String,
    session: Session,
    out: OutputStream,
  ) {
    val cors = isCorsRoute(request.path)
    val status = connection.responseCode
    val contentType = connection.contentType ?: ""
    val finalUrl = connection.url.toString()
    val ok = status in 200..299
    val body: InputStream? = when {
      isHead -> null
      status >= 400 -> connection.errorStream
      else -> connection.inputStream
    }
    val stream = body?.let { BufferedInputStream(it, BUFFER) }
    val peek = if (stream != null && ok) peekHead(stream) else ""
    val dlna = dlnaHeaders(request)

    if (ok && (targetIsPlaylist || Hls.isHlsPlaylist(contentType, finalUrl, peek))) {
      if (stream == null) {
        writeHead(out, 200, listOf("Content-Type" to MPEGURL, "Cache-Control" to "no-cache") + dlna, cors)
        return
      }
      val bytes = readLimited(stream, MAX_PLAYLIST)
      if (bytes == null) {
        writeEmpty(out, 502, cors)
        return
      }
      // Every URI the TV will ask for next becomes allowed for this session only.
      val rewritten = Hls.rewritePlaylist(String(bytes, Charsets.UTF_8), finalUrl, sessionBase, session.allowed::add)
        .toByteArray(Charsets.UTF_8)
      writeHead(
        out,
        200,
        listOf(
          "Content-Type" to MPEGURL,
          "Content-Length" to rewritten.size.toString(),
          "Cache-Control" to "no-cache",
        ) + dlna,
        cors,
      )
      out.write(rewritten)
      return
    }

    val headers = mutableListOf<Pair<String, String>>()
    if (contentType.isNotEmpty()) headers.add("Content-Type" to contentType)
    for (name in listOf("Content-Length", "Content-Range", "Accept-Ranges", "Content-Encoding")) {
      // An error without a body must not announce one, or the TV waits for bytes that never come.
      if (name == "Content-Length" && !isHead && stream == null) continue
      connection.getHeaderField(name)?.let { headers.add(name to it) }
    }
    writeHead(out, status, headers + dlna, cors)
    stream?.copyTo(out, BUFFER)
  }

  /** DLNA renderers ask for these; answering lets them seek with Range. */
  private fun dlnaHeaders(request: ProxyRequest): List<Pair<String, String>> {
    val headers = mutableListOf<Pair<String, String>>()
    if (request.headers.containsKey("getcontentfeatures.dlna.org")) {
      headers.add("contentFeatures.dlna.org" to "DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000")
    }
    request.headers["transfermode.dlna.org"]?.let { headers.add("transferMode.dlna.org" to it) }
    return headers
  }

  private fun peekHead(stream: BufferedInputStream): String {
    val bytes = ByteArray(16)
    stream.mark(bytes.size)
    var read = 0
    while (read < bytes.size) {
      val n = stream.read(bytes, read, bytes.size - read)
      if (n == -1) break
      read += n
    }
    stream.reset()
    return String(bytes, 0, read, Charsets.ISO_8859_1)
  }

  private fun readLimited(stream: InputStream, limit: Int): ByteArray? {
    val out = ByteArrayOutputStream()
    val buffer = ByteArray(BUFFER)
    while (true) {
      val n = stream.read(buffer)
      if (n == -1) return out.toByteArray()
      out.write(buffer, 0, n)
      if (out.size() > limit) return null
    }
  }

  private fun writeEmpty(out: OutputStream, status: Int, cors: Boolean) {
    writeHead(out, status, listOf("Content-Length" to "0"), cors)
  }

  /** [cors]: the request was for `/tv` or `/s`, so the reply carries [CORS_HEADERS]. */
  private fun writeHead(out: OutputStream, status: Int, headers: List<Pair<String, String>>, cors: Boolean) {
    val head = StringBuilder("HTTP/1.1 $status ${reason(status)}\r\n")
    for ((name, value) in headers) head.append(name).append(": ").append(value).append("\r\n")
    if (cors) for ((name, value) in CORS_HEADERS) head.append(name).append(": ").append(value).append("\r\n")
    head.append("Connection: close\r\n\r\n")
    out.write(head.toString().toByteArray(Charsets.ISO_8859_1))
  }

  private fun reason(status: Int): String = when (status) {
    200 -> "OK"
    204 -> "No Content"
    206 -> "Partial Content"
    301 -> "Moved Permanently"
    302 -> "Found"
    304 -> "Not Modified"
    400 -> "Bad Request"
    401 -> "Unauthorized"
    403 -> "Forbidden"
    404 -> "Not Found"
    405 -> "Method Not Allowed"
    411 -> "Length Required"
    413 -> "Content Too Large"
    416 -> "Range Not Satisfiable"
    500 -> "Internal Server Error"
    502 -> "Bad Gateway"
    503 -> "Service Unavailable"
    else -> "Status"
  }

  private fun closeQuietly(closeable: Closeable?) {
    try {
      closeable?.close()
    } catch (_: Exception) {
    }
  }
}
