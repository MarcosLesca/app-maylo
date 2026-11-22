package expo.modules.webguard

import android.os.Build
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Native ad/tracker request blocking for the cast browser's WebView (S5). */
class WebGuardModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("WebGuard")

    Events("onBlockedCount")

    OnCreate {
      appContext.reactContext?.let { Blocklist.loadAsync(it) }
    }

    // Wraps the client of the WebView under [viewTag] (findNodeHandle of a view that contains it).
    AsyncFunction("attachAsync") { viewTag: Int -> attach(viewTag) }.runOnQueue(Queues.MAIN)

    Function("setEnabled") { enabled: Boolean -> Blocklist.enabled = enabled }
  }

  /**
   * False when the view is gone, holds no WebView, or the device is older than
   * Android 8 (WebView.getWebViewClient); true once the WebView is guarded.
   */
  private fun attach(viewTag: Int): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false
    val root = appContext.findView<View>(viewTag) ?: return false
    val webView = findWebView(root) ?: return false
    val current = webView.webViewClient
    if (current is GuardedWebViewClient) return true
    webView.webViewClient = GuardedWebViewClient(current) { count ->
      sendEvent("onBlockedCount", mapOf("viewTag" to viewTag, "count" to count))
    }
    return true
  }

  private fun findWebView(view: View): WebView? {
    if (view is WebView) return view
    if (view is ViewGroup) {
      for (index in 0 until view.childCount) findWebView(view.getChildAt(index))?.let { return it }
    }
    return null
  }
}
