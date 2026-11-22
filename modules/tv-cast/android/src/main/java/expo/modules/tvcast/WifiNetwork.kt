package expo.modules.tvcast

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import java.net.Inet4Address
import java.net.NetworkInterface

/** The Wi-Fi network as Android tracks it, the interface it runs on and that interface's IPv4; any part may be missing. */
internal class WifiLink(val network: Network?, val iface: NetworkInterface?, val address: Inet4Address?)

internal object WifiNetwork {
  /**
   * The Wi-Fi link even when another network (mobile data, a VPN) is the default
   * route: ConnectivityManager first, then the interface scan as a fallback.
   */
  fun find(context: Context): WifiLink {
    val tracked = fromConnectivity(context)
    if (tracked?.iface != null && tracked.address != null) return tracked
    val scanned = scanInterfaces()
    return WifiLink(tracked?.network, tracked?.iface ?: scanned?.first, tracked?.address ?: scanned?.second)
  }

  /** IPv4 of the Wi-Fi interface (wlan*), else any private IPv4 that is not mobile data. */
  fun scanInterfaces(): Pair<NetworkInterface, Inet4Address>? {
    val found = mutableListOf<Pair<NetworkInterface, Inet4Address>>()
    try {
      val interfaces = NetworkInterface.getNetworkInterfaces() ?: return null
      for (iface in interfaces.toList()) {
        if (!iface.isUp || iface.isLoopback) continue
        for (address in iface.inetAddresses.toList()) {
          if (address is Inet4Address && !address.isLoopbackAddress && !address.isLinkLocalAddress) {
            found.add(iface to address)
          }
        }
      }
    } catch (_: Exception) {
      return null
    }
    return found.firstOrNull { it.first.name.startsWith("wlan") }
      ?: found.firstOrNull { it.second.isSiteLocalAddress && !it.first.name.startsWith("rmnet") }
  }

  @Suppress("DEPRECATION") // allNetworks: the callback API would need a listener for a one-shot lookup.
  private fun fromConnectivity(context: Context): WifiLink? {
    return try {
      val manager = context.applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
        ?: return null
      val network = manager.allNetworks.firstOrNull { candidate ->
        val capabilities = manager.getNetworkCapabilities(candidate)
        capabilities != null &&
          capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) &&
          !capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)
      } ?: return null
      val properties = manager.getLinkProperties(network)
      val iface = properties?.interfaceName?.let { name -> NetworkInterface.getByName(name) }
      val address = properties?.linkAddresses
        ?.map { it.address }
        ?.firstOrNull { it is Inet4Address && !it.isLoopbackAddress && !it.isLinkLocalAddress } as? Inet4Address
      WifiLink(network, iface, address)
    } catch (_: Exception) {
      // SecurityException without ACCESS_NETWORK_STATE, or a network that vanished mid-lookup.
      null
    }
  }
}
