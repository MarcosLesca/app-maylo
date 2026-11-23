package expo.modules.webguard

import android.annotation.TargetApi
import android.graphics.Bitmap
import android.net.Uri
import android.net.http.SslError
import android.os.Handler
import android.os.Looper
import android.os.Message
import android.view.KeyEvent
import android.webkit.ClientCertRequest
import android.webkit.HttpAuthHandler
import android.webkit.RenderProcessGoneDetail
import android.webkit.SafeBrowsingResponse
import android.webkit.SslErrorHandler
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import java.io.ByteArrayInputStream
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * Wraps react-native-webview's RNCWebViewClient and forwards every WebViewClient
 * callback to it unchanged, so navigation events, errors, SSL, auth,
 * render-process-gone and onShouldStartLoadWithRequest keep working. It adds:
 * - shouldInterceptRequest: the reserved cosmetic stylesheet host
 *   ([Cosmetic.HOST]) is always answered locally and never reaches the network;
 *   requests from any frame to a listed ad/tracker host
 *   get an empty 204 response (never the top-level document); the count per
 *   page goes to [onCount] (main thread, throttled) and restarts on every
 *   top-level document request.
 * - shouldOverrideUrlLoading: http(s) navigations inside an iframe stay in the
 *   iframe without asking JS (RNW does not tell JS which frame navigates, and the
 *   app's redirect guard is for the top page only). RNW's default for them is
 *   also to allow.
 * RNCWebView.setWebViewClient keeps its own RNCWebViewClient reference when the
 * new client is not an RNCWebViewClient, so messaging still uses the original.
 */
@Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
class GuardedWebViewClient(
  val delegate: WebViewClient,
  private val onCount: (Int) -> Unit,
) : WebViewClient() {
  @Volatile private var topHost: String? = null
  private val blocked = AtomicInteger(0)
  private val emitPending = AtomicBoolean(false)
  private val mainHandler = Handler(Looper.getMainLooper())

  private fun scheduleEmit() {
    if (!emitPending.compareAndSet(false, true)) return
    mainHandler.postDelayed({
      emitPending.set(false)
      onCount(blocked.get())
    }, EMIT_DELAY_MS)
  }

  override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?): WebResourceResponse? {
    if (request != null) {
      if (Cosmetic.isStylesheetRequest(request.url)) return Cosmetic.response(request.url)
      if (request.isForMainFrame) {
        topHost = request.url?.host
        blocked.set(0)
        scheduleEmit()
      } else if (Blocklist.shouldBlock(request.url, false, topHost)) {
        blocked.incrementAndGet()
        scheduleEmit()
        return emptyResponse()
      }
    }
    return delegate.shouldInterceptRequest(view, request)
  }

  override fun shouldInterceptRequest(view: WebView?, url: String?): WebResourceResponse? =
    delegate.shouldInterceptRequest(view, url)

  override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
    if (request != null && !request.isForMainFrame && isHttp(request.url)) return false
    return delegate.shouldOverrideUrlLoading(view, request)
  }

  override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean =
    delegate.shouldOverrideUrlLoading(view, url)

  override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) =
    delegate.onPageStarted(view, url, favicon)

  override fun onPageFinished(view: WebView?, url: String?) = delegate.onPageFinished(view, url)

  override fun onLoadResource(view: WebView?, url: String?) = delegate.onLoadResource(view, url)

  override fun onPageCommitVisible(view: WebView?, url: String?) = delegate.onPageCommitVisible(view, url)

  override fun onTooManyRedirects(view: WebView?, cancelMsg: Message?, continueMsg: Message?) =
    delegate.onTooManyRedirects(view, cancelMsg, continueMsg)

  override fun onReceivedError(view: WebView?, errorCode: Int, description: String?, failingUrl: String?) =
    delegate.onReceivedError(view, errorCode, description, failingUrl)

  override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) =
    delegate.onReceivedError(view, request, error)

  override fun onReceivedHttpError(view: WebView?, request: WebResourceRequest?, errorResponse: WebResourceResponse?) =
    delegate.onReceivedHttpError(view, request, errorResponse)

  override fun onFormResubmission(view: WebView?, dontResend: Message?, resend: Message?) =
    delegate.onFormResubmission(view, dontResend, resend)

  override fun doUpdateVisitedHistory(view: WebView?, url: String?, isReload: Boolean) =
    delegate.doUpdateVisitedHistory(view, url, isReload)

  override fun onReceivedSslError(view: WebView?, handler: SslErrorHandler?, error: SslError?) =
    delegate.onReceivedSslError(view, handler, error)

  override fun onReceivedClientCertRequest(view: WebView?, request: ClientCertRequest?) =
    delegate.onReceivedClientCertRequest(view, request)

  override fun onReceivedHttpAuthRequest(view: WebView?, handler: HttpAuthHandler?, host: String?, realm: String?) =
    delegate.onReceivedHttpAuthRequest(view, handler, host, realm)

  override fun shouldOverrideKeyEvent(view: WebView?, event: KeyEvent?): Boolean =
    delegate.shouldOverrideKeyEvent(view, event)

  override fun onUnhandledKeyEvent(view: WebView?, event: KeyEvent?) = delegate.onUnhandledKeyEvent(view, event)

  override fun onScaleChanged(view: WebView?, oldScale: Float, newScale: Float) =
    delegate.onScaleChanged(view, oldScale, newScale)

  override fun onReceivedLoginRequest(view: WebView?, realm: String?, account: String?, args: String?) =
    delegate.onReceivedLoginRequest(view, realm, account, args)

  @TargetApi(26)
  override fun onRenderProcessGone(view: WebView?, detail: RenderProcessGoneDetail?): Boolean =
    delegate.onRenderProcessGone(view, detail)

  @TargetApi(27)
  override fun onSafeBrowsingHit(view: WebView?, request: WebResourceRequest?, threatType: Int, callback: SafeBrowsingResponse?) =
    delegate.onSafeBrowsingHit(view, request, threatType, callback)

  private companion object {
    const val EMIT_DELAY_MS = 500L

    fun isHttp(url: Uri?): Boolean {
      val scheme = url?.scheme ?: return false
      return scheme.equals("http", ignoreCase = true) || scheme.equals("https", ignoreCase = true)
    }

    fun emptyResponse(): WebResourceResponse =
      WebResourceResponse(
        "text/plain",
        "utf-8",
        204,
        "No Content",
        mapOf("Access-Control-Allow-Origin" to "*", "Cache-Control" to "no-store"),
        ByteArrayInputStream(ByteArray(0)),
      )
  }
}
