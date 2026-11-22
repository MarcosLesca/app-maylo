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
private const val MAX_SESSIONS = 16
private const val MAX_REQUEST_HEAD = 16 * 1024
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

/**
 * HTTP server on the phone's Wi-Fi address that serves videos to the TV with the
 * page's Referer/User-Agent/Cookie (S5). Only `/s/<token>/<base64url(target)>[/x.ext]`
 * for a registered random token is served, so it is not an open relay on the LAN.
 */
internal class CastProxy {
  private val lock = Any()
  private var server: ServerSocket? = null
  private var pool: ThreadPoolExecutor? = null
  private var host = ""
  private val random = SecureRandom()
  private val clients: MutableSet<Socket> = Collections.newSetFromMap(ConcurrentHashMap<Socket, Boolean>())

  // Guarded by itself; the oldest sessions are forgotten past MAX_SESSIONS.
  private val sessions = object : LinkedHashMap<String, Map<String, String>>() {
    override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Map<String, String>>?): Boolean =
      size > MAX_SESSIONS
  }

  /** Starts the server if needed and registers a session; `{ baseUrl, sessionId }`. */
  fun register(headers: Map<String, String>): Map<String, String> {
    val baseUrl = ensureStarted()
    val token = newToken()
    val clean = headers.filter { (name, value) ->
      name.isNotBlank() &&
        name.lowercase() !in DROPPED_HEADERS &&
        name.none { it == '\r' || it == '\n' || it == ':' } &&
        value.none { it == '\r' || it == '\n' }
    }
    synchronized(sessions) { sessions[token] = clean }
    return mapOf("baseUrl" to baseUrl, "sessionId" to token)
  }

  fun stop() {
    synchronized(lock) { stopLocked() }
    synchronized(sessions) { sessions.clear() }
  }

  private fun ensureStarted(): String {
    synchronized(lock) {
      return startLocked()
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
    val socket = ServerSocket(0, 50, address)
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

  private fun stopLocked() {
    closeQuietly(server)
    server = null
    pool?.shutdownNow()
    pool = null
    // Blocking socket IO ignores interrupts: closing the sockets ends running streams.
    for (client in clients.toList()) closeQuietly(client)
    clients.clear()
  }

  private fun newToken(): String {
    val bytes = ByteArray(16)
    random.nextBytes(bytes)
    return bytes.joinToString("") { (it.toInt() and 0xff).toString(16).padStart(2, '0') }
  }

  /** IPv4 of the Wi-Fi interface (wlan*), else any private IPv4 that is not mobile data. */
  private fun wifiAddress(): Inet4Address? {
    val found = mutableListOf<Pair<String, Inet4Address>>()
    try {
      val interfaces = NetworkInterface.getNetworkInterfaces() ?: return null
      for (iface in interfaces.toList()) {
        if (!iface.isUp || iface.isLoopback) continue
        for (address in iface.inetAddresses.toList()) {
          if (address is Inet4Address && !address.isLoopbackAddress && !address.isLinkLocalAddress) {
            found.add(iface.name to address)
          }
        }
      }
    } catch (_: Exception) {
      return null
    }
    return (
      found.firstOrNull { it.first.startsWith("wlan") }
        ?: found.firstOrNull { it.second.isSiteLocalAddress && !it.first.startsWith("rmnet") }
      )?.second
  }

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
      client.soTimeout = 30_000
      val input = BufferedInputStream(client.getInputStream())
      val output = client.getOutputStream().buffered(BUFFER)
      val request = readRequest(input) ?: return
      val local = client.localAddress.hostAddress ?: host
      serve(request, "http://$local:${client.localPort}", output)
      output.flush()
    } catch (_: Exception) {
      // The TV hung up mid-stream, the upstream failed, or we were stopped: just drop it.
    } finally {
      clients.remove(client)
      closeQuietly(client)
    }
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
    if (request.method != "GET" && request.method != "HEAD") {
      writeEmpty(out, 405)
      return
    }
    // "", "s", token, base64url(target), optional file-like suffix
    val segments = request.path.split(QUERY_OR_FRAGMENT)[0].split('/')
    if (segments.size < 4 || segments[0] != "" || segments[1] != "s") {
      writeEmpty(out, 404)
      return
    }
    val token = segments[2]
    val headers = synchronized(sessions) { sessions[token] }
    if (headers == null) {
      writeEmpty(out, 404)
      return
    }
    val target = Hls.base64UrlDecode(segments[3])
    if (target == null || !(target.startsWith("http://") || target.startsWith("https://"))) {
      writeEmpty(out, 400)
      return
    }
    val isHead = request.method == "HEAD"
    val targetIsPlaylist = target.split(QUERY_OR_FRAGMENT)[0].lowercase().endsWith(".m3u8")
    // A playlist is rewritten whole, so a byte range of it would be meaningless.
    val range = if (targetIsPlaylist) null else request.headers["range"]
    val connection = try {
      open(target, headers, range, isHead)
    } catch (_: Exception) {
      writeEmpty(out, 502)
      return
    }
    try {
      relay(connection, request, isHead, targetIsPlaylist, "$origin/s/$token", out)
    } finally {
      connection.disconnect()
    }
  }

  /** Follows redirects by hand so http↔https hops work; Cookie stays on the original host. */
  private fun open(target: String, headers: Map<String, String>, range: String?, isHead: Boolean): HttpURLConnection {
    var url = URL(target)
    val originalHost = url.host
    repeat(MAX_REDIRECTS + 1) {
      val connection = url.openConnection() as HttpURLConnection
      connection.instanceFollowRedirects = false
      connection.connectTimeout = 15_000
      connection.readTimeout = 30_000
      connection.requestMethod = if (isHead) "HEAD" else "GET"
      for ((name, value) in headers) {
        if (name.equals("cookie", ignoreCase = true) && !url.host.equals(originalHost, ignoreCase = true)) continue
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

  private fun relay(
    connection: HttpURLConnection,
    request: ProxyRequest,
    isHead: Boolean,
    targetIsPlaylist: Boolean,
    sessionBase: String,
    out: OutputStream,
  ) {
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
        writeHead(out, 200, listOf("Content-Type" to MPEGURL, "Cache-Control" to "no-cache") + dlna)
        return
      }
      val bytes = readLimited(stream, MAX_PLAYLIST)
      if (bytes == null) {
        writeEmpty(out, 502)
        return
      }
      val rewritten = Hls.rewritePlaylist(String(bytes, Charsets.UTF_8), finalUrl, sessionBase)
        .toByteArray(Charsets.UTF_8)
      writeHead(
        out,
        200,
        listOf(
          "Content-Type" to MPEGURL,
          "Content-Length" to rewritten.size.toString(),
          "Cache-Control" to "no-cache",
        ) + dlna,
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
    writeHead(out, status, headers + dlna)
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

  private fun writeEmpty(out: OutputStream, status: Int) {
    writeHead(out, status, listOf("Content-Length" to "0"))
  }

  private fun writeHead(out: OutputStream, status: Int, headers: List<Pair<String, String>>) {
    val head = StringBuilder("HTTP/1.1 $status ${reason(status)}\r\n")
    for ((name, value) in headers) head.append(name).append(": ").append(value).append("\r\n")
    head.append("Connection: close\r\n\r\n")
    out.write(head.toString().toByteArray(Charsets.ISO_8859_1))
  }

  private fun reason(status: Int): String = when (status) {
    200 -> "OK"
    206 -> "Partial Content"
    301 -> "Moved Permanently"
    302 -> "Found"
    304 -> "Not Modified"
    400 -> "Bad Request"
    401 -> "Unauthorized"
    403 -> "Forbidden"
    404 -> "Not Found"
    405 -> "Method Not Allowed"
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
