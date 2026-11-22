package expo.modules.tvcast

import android.content.Context
import android.net.wifi.WifiManager
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.SocketTimeoutException

// ssdp:all is a fallback for TVs that ignore the specific targets; JS drops non-renderers.
private val SEARCH_TARGETS = listOf(
  "urn:schemas-upnp-org:service:AVTransport:1",
  "urn:schemas-upnp-org:device:MediaRenderer:1",
  "ssdp:all",
)

/** SSDP discovery of DLNA renderers and the cast proxy (S5); DLNA HTTP/SOAP runs in JS. */
class TvCastModule : Module() {
  private val proxy = CastProxy()

  override fun definition() = ModuleDefinition {
    Name("TvCast")

    // AsyncFunction bodies run off the main thread, so blocking socket reads are fine here.
    AsyncFunction("discoverAsync") { timeoutMs: Int -> discover(timeoutMs.coerceIn(500, 10_000)) }

    // Starts the proxy on demand and registers a session with the page headers.
    AsyncFunction("startProxyAsync") { headers: Map<String, String> -> proxy.register(headers) }

    AsyncFunction("stopProxyAsync") { proxy.stop() }

    OnDestroy { proxy.stop() }
  }

  private fun discover(timeoutMs: Int): List<Map<String, String>> {
    val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
    val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
    val lock = wifi.createMulticastLock("maylo-ssdp").apply {
      setReferenceCounted(false)
      acquire()
    }
    val socket = DatagramSocket()
    try {
      socket.soTimeout = 250
      val group = InetAddress.getByName("239.255.255.250")
      // UDP may drop packets: search twice, at the start and halfway through.
      fun search() {
        for (target in SEARCH_TARGETS) {
          val message = "M-SEARCH * HTTP/1.1\r\n" +
            "HOST: 239.255.255.250:1900\r\n" +
            "MAN: \"ssdp:discover\"\r\n" +
            "MX: 2\r\n" +
            "ST: $target\r\n\r\n"
          val bytes = message.toByteArray(Charsets.UTF_8)
          socket.send(DatagramPacket(bytes, bytes.size, group, 1900))
        }
      }

      val replies = mutableListOf<Map<String, String>>()
      val start = System.currentTimeMillis()
      var searchedAgain = false
      val buffer = ByteArray(8192)
      search()
      while (System.currentTimeMillis() - start < timeoutMs) {
        if (!searchedAgain && System.currentTimeMillis() - start > timeoutMs / 2) {
          search()
          searchedAgain = true
        }
        val packet = DatagramPacket(buffer, buffer.size)
        try {
          socket.receive(packet)
        } catch (_: SocketTimeoutException) {
          continue
        }
        replies.add(
          mapOf(
            "address" to (packet.address?.hostAddress ?: ""),
            "response" to String(packet.data, 0, packet.length, Charsets.UTF_8),
          )
        )
      }
      return replies
    } finally {
      socket.close()
      if (lock.isHeld) lock.release()
    }
  }
}
