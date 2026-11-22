package expo.modules.tvcast

import android.content.Context
import android.net.wifi.WifiManager
import java.net.DatagramPacket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.MulticastSocket
import java.net.SocketAddress
import java.net.SocketTimeoutException

private const val SSDP_GROUP = "239.255.255.250"
private const val SSDP_PORT = 1900
private const val MAX_PACKETS = 300

// ssdp:all is a fallback for TVs that ignore the specific targets; JS drops non-renderers.
private val SEARCH_TARGETS = listOf(
  "urn:schemas-upnp-org:service:AVTransport:1",
  "urn:schemas-upnp-org:device:MediaRenderer:1",
  "ssdp:all",
)

private val IPV4_LITERAL = Regex("^(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)(\\.(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)){3}$")

/**
 * SSDP search over the Wi-Fi network explicitly (not the default route, which
 * may be mobile data or a VPN): multicast M-SEARCH with TTL 4 plus, best effort,
 * the NOTIFY ssdp:alive heard on 239.255.255.250:1900 during the window; or a
 * unicast M-SEARCH to [unicastHost]:1900 when given. JS parses every packet.
 */
internal fun ssdpSearch(context: Context, timeoutMs: Int, unicastHost: String?): Map<String, Any> {
  // An IPv4 literal only: InetAddress.getByName must never turn this into a DNS lookup.
  val target = unicastHost?.trim()?.let { host ->
    require(IPV4_LITERAL.matches(host)) { "IP inválida: $host" }
    InetAddress.getByName(host)
  }
  val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
  val lock = wifi.createMulticastLock("maylo-ssdp").apply {
    setReferenceCounted(false)
    acquire()
  }
  val link = WifiNetwork.find(context)
  val group = InetAddress.getByName(SSDP_GROUP)
  // Release the lock if the socket cannot be created; the finally below covers the rest.
  val searchSocket = try {
    MulticastSocket()
  } catch (error: Exception) {
    if (lock.isHeld) lock.release()
    throw error
  }
  val listener = if (target == null) openNotifyListener(group, link) else null
  val packets = mutableListOf<Map<String, String>>()
  var sendError: String? = null
  try {
    searchSocket.soTimeout = if (listener != null) 100 else 200
    // Every step is best effort: a failure falls back to the default route instead of aborting.
    link.network?.let { network ->
      try {
        network.bindSocket(searchSocket)
      } catch (_: Exception) {
      }
    }
    link.iface?.let { iface ->
      try {
        searchSocket.networkInterface = iface
      } catch (_: Exception) {
      }
    }
    try {
      searchSocket.timeToLive = 4
    } catch (_: Exception) {
    }

    fun search() {
      for (searchTarget in SEARCH_TARGETS) {
        val message = if (target == null) {
          "M-SEARCH * HTTP/1.1\r\n" +
            "HOST: $SSDP_GROUP:$SSDP_PORT\r\n" +
            "MAN: \"ssdp:discover\"\r\n" +
            "MX: 2\r\n" +
            "ST: $searchTarget\r\n" +
            "USER-AGENT: Android UPnP/1.1 MayLo/1.0\r\n\r\n"
        } else {
          // Unicast M-SEARCH (UPnP 1.1): HOST is the device itself and there is no MX.
          "M-SEARCH * HTTP/1.1\r\n" +
            "HOST: ${target.hostAddress}:$SSDP_PORT\r\n" +
            "MAN: \"ssdp:discover\"\r\n" +
            "ST: $searchTarget\r\n" +
            "USER-AGENT: Android UPnP/1.1 MayLo/1.0\r\n\r\n"
        }
        val bytes = message.toByteArray(Charsets.UTF_8)
        try {
          searchSocket.send(DatagramPacket(bytes, bytes.size, target ?: group, SSDP_PORT))
        } catch (error: Exception) {
          sendError = error.message ?: error.javaClass.simpleName
        }
      }
    }

    val buffer = ByteArray(8192)
    fun receive(socket: MulticastSocket, kind: String) {
      val packet = DatagramPacket(buffer, buffer.size)
      try {
        socket.receive(packet)
      } catch (_: SocketTimeoutException) {
        return
      }
      if (packets.size >= MAX_PACKETS) return
      packets.add(
        mapOf(
          "address" to (packet.address?.hostAddress ?: ""),
          "response" to String(packet.data, 0, packet.length, Charsets.UTF_8),
          "kind" to kind,
        )
      )
    }

    // UDP may drop packets: search twice, at the start and halfway through.
    val start = System.currentTimeMillis()
    var searchedAgain = false
    search()
    while (System.currentTimeMillis() - start < timeoutMs) {
      if (!searchedAgain && System.currentTimeMillis() - start > timeoutMs / 2) {
        search()
        searchedAgain = true
      }
      receive(searchSocket, "response")
      if (listener != null) {
        try {
          receive(listener, "notify")
        } catch (_: Exception) {
          // The passive listener is best effort; the search goes on without it.
        }
      }
    }
  } finally {
    searchSocket.close()
    listener?.close()
    if (lock.isHeld) lock.release()
  }

  val result = mutableMapOf<String, Any>(
    "packets" to packets,
    "interfaceName" to (link.iface?.name ?: ""),
    "localAddress" to (link.address?.hostAddress ?: ""),
    "wifiNetwork" to (link.network != null),
    "listening" to (listener != null),
  )
  sendError?.let { result["sendError"] = it }
  return result
}

/**
 * Socket on port 1900 (shared with other apps via SO_REUSEADDR) that joined the
 * SSDP group on the Wi-Fi interface, or null when the port or the join is refused.
 */
private fun openNotifyListener(group: InetAddress, link: WifiLink): MulticastSocket? {
  val socket = try {
    MulticastSocket(null as SocketAddress?)
  } catch (_: Exception) {
    return null
  }
  return try {
    socket.reuseAddress = true
    socket.bind(InetSocketAddress(SSDP_PORT))
    socket.soTimeout = 100
    val iface = link.iface
    if (iface != null) socket.joinGroup(InetSocketAddress(group, SSDP_PORT), iface) else socket.joinGroup(group)
    socket
  } catch (_: Exception) {
    socket.close()
    null
  }
}
