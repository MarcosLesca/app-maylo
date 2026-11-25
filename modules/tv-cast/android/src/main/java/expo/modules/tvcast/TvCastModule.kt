package expo.modules.tvcast

import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.core.content.ContextCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.Collections
import java.util.WeakHashMap
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private const val MEDIA_ACTION_EVENT = "onMediaAction"

/**
 * SSDP discovery of DLNA renderers, the cast proxy (S5) and the cast browser's
 * every-frame detector (S2); DLNA HTTP/SOAP runs in JS.
 */
class TvCastModule : Module() {
  private val proxy = CastProxy()

  // The vendored hls.js (module assets), read once; null when the asset cannot be read.
  @Volatile private var hlsScript: ByteArray? = null

  // WebViews that already run the detector at document start; touched on the main thread only.
  private val scriptedWebViews: MutableSet<WebView> = Collections.newSetFromMap(WeakHashMap<WebView, Boolean>())

  // Sends the media session's actions to JS while this React instance lives.
  private val mediaListener: (Map<String, Any?>) -> Unit = { event -> sendEvent(MEDIA_ACTION_EVENT, event) }

  override fun definition() = ModuleDefinition {
    Name("TvCast")

    Events(MEDIA_ACTION_EVENT)

    OnCreate { MediaSessionHub.listener = mediaListener }

    // Searches block on socket reads for seconds: they run on the IO dispatcher so they neither
    // hold the single shared async-function queue nor serialize the parallel unicast follow-ups.
    // Kept for JS bundles that predate ssdpSearchAsync: the packets only.
    AsyncFunction("discoverAsync") Coroutine { timeoutMs: Int ->
      withContext(Dispatchers.IO) { search(timeoutMs, null)["packets"] }
    }

    // Wi-Fi-bound search plus NOTIFY listening, or a unicast search when [host] (an IPv4) is given.
    AsyncFunction("ssdpSearchAsync") Coroutine { timeoutMs: Int, host: String? ->
      withContext(Dispatchers.IO) { search(timeoutMs, host) }
    }

    // Starts the proxy on demand; the new session (page headers + video URL) revokes the previous one.
    AsyncFunction("startProxyAsync") { headers: Map<String, String>, target: String -> proxy.register(headers, target) }

    // Runs [script] at document start in every frame (iframes too) of the WebView under [viewTag].
    AsyncFunction("addDocumentStartScriptAsync") { viewTag: Int, script: String ->
      addDocumentStartScript(viewTag, script)
    }.runOnQueue(Queues.MAIN)

    // Revokes the cast session; the server keeps running while the TV browser receiver is started.
    AsyncFunction("stopProxyAsync") { proxy.stop() }

    // TV browser receiver (S1, S4): serves [html] at /tv/<key> on port 8765 (or the next free one up to 8775).
    AsyncFunction("startReceiverAsync") Coroutine { key: String, html: String ->
      withContext(Dispatchers.IO) { proxy.startReceiver(key, html, loadHlsScript()) }
    }

    // [command] is a JSON object text; the TV gets it with an increasing id.
    AsyncFunction("pushReceiverCommandAsync") { command: String -> proxy.pushReceiverCommand(command) }

    AsyncFunction("getReceiverStateAsync") { proxy.receiverState() }

    // Stops the receiver, and the server too when no cast session is active.
    AsyncFunction("stopReceiverAsync") { proxy.stopReceiver() }

    // Background control (S5): media-playback foreground service + MediaSession + remote volume.
    // On the main queue so start/update/stop run in call order with the service's lifecycle.
    AsyncFunction("startMediaSession") { options: MediaSessionOptions ->
      startMediaSession(options)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("updateMediaSession") { options: MediaSessionOptions ->
      if (MediaSessionHub.active) {
        MediaSessionHub.state = MediaSessionHub.state.merge(options)
        MediaSessionHub.service?.refresh()
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("stopMediaSession") { stopMediaSession() }.runOnQueue(Queues.MAIN)

    OnDestroy {
      proxy.shutdown()
      if (MediaSessionHub.listener === mediaListener) MediaSessionHub.listener = null
      // Nothing is left to act on the notification's controls.
      Handler(Looper.getMainLooper()).post { stopMediaSession() }
    }
  }

  private fun startMediaSession(options: MediaSessionOptions) {
    val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
    MediaSessionHub.listener = mediaListener
    MediaSessionHub.state = MediaState().merge(options)
    MediaSessionHub.active = true
    val running = MediaSessionHub.service
    if (running != null) {
      running.refresh()
      return
    }
    val intent = Intent(context, CastMediaService::class.java).setAction(CastMediaService.ACTION_START)
    try {
      ContextCompat.startForegroundService(context, intent)
    } catch (error: IllegalStateException) {
      // ForegroundServiceStartNotAllowedException (Android 12+, app in background) is one.
      MediaSessionHub.active = false
      throw CodedException("ERR_FGS_NOT_ALLOWED", "Android did not allow the media service to start", error)
    }
  }

  /** Idempotent; a service still starting stops itself once it calls startForeground. */
  private fun stopMediaSession() {
    MediaSessionHub.active = false
    MediaSessionHub.service?.shutdown()
  }

  private fun loadHlsScript(): ByteArray? {
    hlsScript?.let { return it }
    val context = appContext.reactContext ?: return null
    return try {
      context.assets.open("tv-cast/hls.min.js").use { it.readBytes() }.also { hlsScript = it }
    } catch (_: Exception) {
      null
    }
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
