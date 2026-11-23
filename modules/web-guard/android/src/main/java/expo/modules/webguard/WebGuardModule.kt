package expo.modules.webguard

import android.annotation.TargetApi
import android.os.Build
import android.view.View
import android.view.ViewGroup
import android.webkit.ServiceWorkerClient
import android.webkit.ServiceWorkerController
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Native ad/tracker request blocking (S5) and cosmetic filtering (S10) for the cast browser's WebView. */
class WebGuardModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("WebGuard")

    Events("onBlockedCount")

    OnCreate {
      appContext.reactContext?.let {
        Blocklist.loadAsync(it)
        Cosmetic.loadAsync(it)
      }
    }

    // Wraps the client of the WebView under [viewTag] (findNodeHandle of a view that contains it).
    AsyncFunction("attachAsync") { viewTag: Int -> attach(viewTag) }.runOnQueue(Queues.MAIN)

    // Turns request blocking and cosmetic filtering on/off for every guarded WebView.
    Function("setEnabled") { enabled: Boolean -> Blocklist.enabled = enabled }

    // The reserved stylesheet URL the injected cosmetic loader requests (answered locally).
    Function("cosmeticStylesheetUrl") { Cosmetic.STYLESHEET_URL }
  }

  /**
   * False when the view is gone, holds no WebView, or the device is older than
   * Android 8 (WebView.getWebViewClient); true once the WebView is guarded.
   */
  private fun attach(viewTag: Int): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false
    val root = appContext.findView<View>(viewTag) ?: return false
    val webView = findWebView(root) ?: return false
    guardServiceWorkers()
    val current = webView.webViewClient
    if (current is GuardedWebViewClient) return true
    webView.webViewClient = GuardedWebViewClient(current) { count ->
      sendEvent("onBlockedCount", mapOf("viewTag" to viewTag, "count" to count))
    }
    return true
  }

  /**
   * A page's service worker may fetch the cosmetic stylesheet itself; those
   * requests skip the WebViewClient, so the app-wide service-worker client also
   * answers the reserved host locally (everything else is left to the network).
   */
  @TargetApi(24)
  private fun guardServiceWorkers() {
    if (serviceWorkersGuarded) return
    try {
      ServiceWorkerController.getInstance().setServiceWorkerClient(object : ServiceWorkerClient() {
        override fun shouldInterceptRequest(request: WebResourceRequest): WebResourceResponse? =
          if (Cosmetic.isStylesheetRequest(request.url)) Cosmetic.response(request.url) else null
      })
      serviceWorkersGuarded = true
    } catch (_: Exception) {
      // No service-worker support in this WebView: nothing to guard.
    }
  }

  private fun findWebView(view: View): WebView? {
    if (view is WebView) return view
    if (view is ViewGroup) {
      for (index in 0 until view.childCount) findWebView(view.getChildAt(index))?.let { return it }
    }
    return null
  }

  private companion object {
    @Volatile var serviceWorkersGuarded = false
  }
}
