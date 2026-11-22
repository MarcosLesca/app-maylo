package expo.modules.tvcast

import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.Collections
import java.util.WeakHashMap

/**
 * SSDP discovery of DLNA renderers, the cast proxy (S5) and the cast browser's
 * every-frame detector (S2); DLNA HTTP/SOAP runs in JS.
 */
class TvCastModule : Module() {
  private val proxy = CastProxy()

  // WebViews that already run the detector at document start; touched on the main thread only.
  private val scriptedWebViews: MutableSet<WebView> = Collections.newSetFromMap(WeakHashMap<WebView, Boolean>())

  override fun definition() = ModuleDefinition {
    Name("TvCast")

    // AsyncFunction bodies run off the main thread, so blocking socket reads are fine here.
    // Kept for JS bundles that predate ssdpSearchAsync: the packets only.
    AsyncFunction("discoverAsync") { timeoutMs: Int -> search(timeoutMs, null)["packets"] }

    // Wi-Fi-bound search plus NOTIFY listening, or a unicast search when [host] (an IPv4) is given.
    AsyncFunction("ssdpSearchAsync") { timeoutMs: Int, host: String? -> search(timeoutMs, host) }

    // Starts the proxy on demand; the new session (page headers + video URL) revokes the previous one.
    AsyncFunction("startProxyAsync") { headers: Map<String, String>, target: String -> proxy.register(headers, target) }

    // Runs [script] at document start in every frame (iframes too) of the WebView under [viewTag].
    AsyncFunction("addDocumentStartScriptAsync") { viewTag: Int, script: String ->
      addDocumentStartScript(viewTag, script)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("stopProxyAsync") { proxy.stop() }

    OnDestroy { proxy.stop() }
  }

  /**
   * False when the view is gone, holds no WebView, or the WebView cannot run
   * document-start scripts (old System WebView); true once it runs [script].
   */
  private fun addDocumentStartScript(viewTag: Int, script: String): Boolean {
    val root = appContext.findView<View>(viewTag) ?: return false
    val webView = findWebView(root) ?: return false
    if (webView in scriptedWebViews) return true
    if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) return false
    return try {
      WebViewCompat.addDocumentStartJavaScript(webView, script, setOf("*"))
      scriptedWebViews.add(webView)
      true
    } catch (_: Exception) {
      false
    }
  }

  private fun findWebView(view: View): WebView? {
    if (view is WebView) return view
    if (view is ViewGroup) {
      for (index in 0 until view.childCount) findWebView(view.getChildAt(index))?.let { return it }
    }
    return null
  }

  private fun search(timeoutMs: Int, host: String?): Map<String, Any> {
    val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
    return ssdpSearch(context, timeoutMs.coerceIn(500, 10_000), host?.takeIf { it.isNotBlank() })
  }
}
