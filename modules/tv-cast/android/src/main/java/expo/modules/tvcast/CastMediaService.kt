package expo.modules.tvcast

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.os.PowerManager
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.app.NotificationCompat
import androidx.media.VolumeProviderCompat
import kotlin.math.abs
import kotlin.math.roundToLong

/**
 * Background control (S5): a media-playback foreground service that keeps the process,
 * the CPU and the Wi-Fi awake while a cast is active (the proxy keeps serving with the
 * screen off), with a MediaSession whose notification (lock screen too) and remote
 * volume send the user's actions to JS as `onMediaAction`. Started by [TvCastModule].
 */
class CastMediaService : Service() {
  companion object {
    internal const val ACTION_START = "expo.modules.tvcast.media.START"
    private const val ACTION_PLAY = "expo.modules.tvcast.media.PLAY"
    private const val ACTION_PAUSE = "expo.modules.tvcast.media.PAUSE"
    private const val ACTION_REWIND = "expo.modules.tvcast.media.REWIND"
    private const val ACTION_FORWARD = "expo.modules.tvcast.media.FORWARD"
    private const val ACTION_STOP = "expo.modules.tvcast.media.STOP"
    private const val CHANNEL_ID = "tv-cast-media"
    private const val NOTIFICATION_ID = 0x7ca57
    private const val SEEK_SECONDS = 10
    private const val LOCK_TAG = "maylo:tv-cast"

    // Safety net only: the locks are released when the session stops.
    private const val WAKE_LOCK_TIMEOUT_MS = 6L * 60 * 60 * 1000
  }

  private var session: MediaSessionCompat? = null
  private var wakeLock: PowerManager.WakeLock? = null
  private var wifiLock: WifiManager.WifiLock? = null

  // Relative volume: each press of the phone's volume buttons becomes one step on the TV.
  private val volumeProvider = object : VolumeProviderCompat(VOLUME_CONTROL_RELATIVE, 100, 50) {
    override fun onAdjustVolume(direction: Int) {
      if (direction == 1 || direction == -1) emit(mapOf("action" to "volume", "direction" to direction))
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    MediaSessionHub.service = this
    createChannel()
    session = MediaSessionCompat(this, "TvCast").apply {
      setCallback(SessionCallback())
      setPlaybackToRemote(volumeProvider)
      isActive = true
    }
    acquireLocks()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val action = intent?.action
    if (action == ACTION_START) {
      // Every startForegroundService must be followed by startForeground, even when stopping right away.
      goForeground()
      if (!MediaSessionHub.active) shutdown()
      return START_NOT_STICKY
    }
    // A tap on a stale notification after the session ended: nothing to control.
    if (!MediaSessionHub.active) {
      shutdown()
      return START_NOT_STICKY
    }
    when (action) {
      ACTION_PLAY -> action("play")
      ACTION_PAUSE -> action("pause")
      ACTION_REWIND -> seekBy(-SEEK_SECONDS)
      ACTION_FORWARD -> seekBy(SEEK_SECONDS)
      ACTION_STOP -> stopFromUser()
    }
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    if (MediaSessionHub.service === this) MediaSessionHub.service = null
    session?.run {
      isActive = false
      release()
    }
    session = null
    releaseLocks()
    super.onDestroy()
  }

  /** Shows [MediaSessionHub.state] in the session and the notification. */
  fun refresh() {
    val notification = render() ?: return
    getSystemService(NotificationManager::class.java)?.notify(NOTIFICATION_ID, notification)
  }

  /** Removes the notification and stops the service (its locks are released in onDestroy). */
  fun shutdown() {
    MediaSessionHub.active = false
    if (MediaSessionHub.service === this) MediaSessionHub.service = null
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } else {
      @Suppress("DEPRECATION")
      stopForeground(true)
    }
    stopSelf()
  }

  private fun goForeground() {
    val notification = render() ?: return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  private inner class SessionCallback : MediaSessionCompat.Callback() {
    override fun onPlay() = action("play")

    override fun onPause() = action("pause")

    override fun onStop() = stopFromUser()

    override fun onRewind() = seekBy(-SEEK_SECONDS)

    override fun onFastForward() = seekBy(SEEK_SECONDS)

    // The system seek bar (Android 13+): sent as a relative seek from the shown position.
    override fun onSeekTo(pos: Long) {
      val current = MediaSessionHub.state.currentPositionMs()
      if (current < 0) return
      val seconds = ((pos - current) / 1000.0).roundToLong()
      if (abs(seconds) >= 1) emit(mapOf("action" to "seekBy", "seconds" to seconds.toDouble()))
    }

    override fun onCustomAction(action: String?, extras: Bundle?) {
      when (action) {
        ACTION_REWIND -> seekBy(-SEEK_SECONDS)
        ACTION_FORWARD -> seekBy(SEEK_SECONDS)
        ACTION_STOP -> stopFromUser()
      }
    }
  }

  private fun action(name: String) = emit(mapOf("action" to name))

  private fun seekBy(seconds: Int) = emit(mapOf("action" to "seekBy", "seconds" to seconds))

  // JS stops the cast; the notification goes away now even if JS is slow or gone.
  private fun stopFromUser() {
    emit(mapOf("action" to "stop"))
    shutdown()
  }

  private fun emit(event: Map<String, Any?>) {
    val listener = MediaSessionHub.listener
    if (listener == null) {
      // No React instance to act on it: a notification that controls nothing is worse than none.
      shutdown()
      return
    }
    listener(event)
  }

  /** Updates the session from the hub's state and builds the notification; null when the session is gone. */
  private fun render(): Notification? {
    val session = session ?: return null
    val state = MediaSessionHub.state
    val title = state.title.ifBlank { "En la tele" }

    session.setMetadata(
      MediaMetadataCompat.Builder()
        .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
        .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_TITLE, title)
        .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, state.subtitle)
        .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_SUBTITLE, state.subtitle)
        .apply { if (state.durationMs > 0) putLong(MediaMetadataCompat.METADATA_KEY_DURATION, state.durationMs) }
        .build(),
    )

    var actions = PlaybackStateCompat.ACTION_PLAY or PlaybackStateCompat.ACTION_PAUSE or
      PlaybackStateCompat.ACTION_PLAY_PAUSE or PlaybackStateCompat.ACTION_STOP or
      PlaybackStateCompat.ACTION_REWIND or PlaybackStateCompat.ACTION_FAST_FORWARD
    if (state.durationMs > 0 && state.positionMs >= 0) actions = actions or PlaybackStateCompat.ACTION_SEEK_TO
    // Android 13+ draws media controls from the playback state: without skip actions the
    // custom ones fill the previous/next slots (−10 s, +10 s), then stop.
    session.setPlaybackState(
      PlaybackStateCompat.Builder()
        .setActions(actions)
        .setState(
          if (state.playing) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED,
          state.positionMs,
          if (state.playing) 1f else 0f,
          state.updatedAt,
        )
        .addCustomAction(ACTION_REWIND, "Atrás 10 s", android.R.drawable.ic_media_rew)
        .addCustomAction(ACTION_FORWARD, "Adelante 10 s", android.R.drawable.ic_media_ff)
        .addCustomAction(ACTION_STOP, "Detener", android.R.drawable.ic_menu_close_clear_cancel)
        .build(),
    )

    // Android 12 and older draw these notification actions instead.
    val playPause = if (state.playing) {
      NotificationCompat.Action(android.R.drawable.ic_media_pause, "Pausa", serviceIntent(ACTION_PAUSE))
    } else {
      NotificationCompat.Action(android.R.drawable.ic_media_play, "Reproducir", serviceIntent(ACTION_PLAY))
    }
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(smallIcon())
      .apply { notificationColor()?.let { setColor(it) } }
      .setContentTitle(title)
      .setContentText(state.subtitle)
      .setContentIntent(launchIntent())
      .setDeleteIntent(serviceIntent(ACTION_STOP))
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setShowWhen(false)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .addAction(android.R.drawable.ic_media_rew, "Atrás 10 s", serviceIntent(ACTION_REWIND))
      .addAction(playPause)
      .addAction(android.R.drawable.ic_media_ff, "Adelante 10 s", serviceIntent(ACTION_FORWARD))
      .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Detener", serviceIntent(ACTION_STOP))
      .setStyle(
        androidx.media.app.NotificationCompat.MediaStyle()
          .setMediaSession(session.sessionToken)
          .setShowActionsInCompactView(0, 1, 2),
      )
      .build()
  }

  private fun serviceIntent(action: String): PendingIntent =
    PendingIntent.getService(
      this,
      action.hashCode(),
      Intent(this, CastMediaService::class.java).setAction(action),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

  private fun launchIntent(): PendingIntent? {
    val launch = packageManager.getLaunchIntentForPackage(packageName) ?: return null
    return PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  }

  // The monochrome icon expo-notifications generates (notification_icon), else the app icon.
  @SuppressLint("DiscouragedApi")
  private fun smallIcon(): Int =
    resources.getIdentifier("notification_icon", "drawable", packageName).takeIf { it != 0 }
      ?: applicationInfo.icon.takeIf { it != 0 }
      ?: android.R.drawable.ic_media_play

  @SuppressLint("DiscouragedApi")
  private fun notificationColor(): Int? {
    val id = resources.getIdentifier("notification_icon_color", "color", packageName)
    return if (id == 0) null else runCatching { getColor(id) }.getOrNull()
  }

  private fun createChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(NotificationManager::class.java) ?: return
    val channel = NotificationChannel(CHANNEL_ID, "Control de la tele", NotificationManager.IMPORTANCE_LOW).apply {
      description = "Reproducción en la tele mientras la app está en segundo plano"
      setShowBadge(false)
      lockscreenVisibility = Notification.VISIBILITY_PUBLIC
    }
    manager.createNotificationChannel(channel)
  }

  @SuppressLint("WakelockTimeout")
  private fun acquireLocks() {
    runCatching {
      val power = getSystemService(Context.POWER_SERVICE) as PowerManager
      wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, LOCK_TAG).apply {
        setReferenceCounted(false)
        acquire(WAKE_LOCK_TIMEOUT_MS)
      }
    }
    runCatching {
      val wifi = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
      @Suppress("DEPRECATION")
      wifiLock = wifi.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, LOCK_TAG).apply {
        setReferenceCounted(false)
        acquire()
      }
    }
  }

  private fun releaseLocks() {
    runCatching { wakeLock?.takeIf { it.isHeld }?.release() }
    runCatching { wifiLock?.takeIf { it.isHeld }?.release() }
    wakeLock = null
    wifiLock = null
  }
}
