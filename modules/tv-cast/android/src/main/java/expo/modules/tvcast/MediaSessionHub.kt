package expo.modules.tvcast

import android.os.SystemClock
import android.support.v4.media.session.PlaybackStateCompat
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/** What JS passes to startMediaSession / updateMediaSession; absent fields keep the shown value. */
class MediaSessionOptions : Record {
  @Field var title: String? = null
  @Field var subtitle: String? = null
  @Field var playing: Boolean? = null
  @Field var positionMs: Double? = null
  @Field var durationMs: Double? = null
}

/** What the media notification shows; [positionMs] was true at [updatedAt] (elapsedRealtime). */
internal data class MediaState(
  val title: String = "",
  val subtitle: String = "",
  val playing: Boolean = false,
  val positionMs: Long = PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN,
  val durationMs: Long = 0,
  val updatedAt: Long = SystemClock.elapsedRealtime(),
) {
  /** The position now, advanced while playing; PLAYBACK_POSITION_UNKNOWN when never reported. */
  fun currentPositionMs(now: Long = SystemClock.elapsedRealtime()): Long {
    if (positionMs < 0) return PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN
    val position = if (playing) positionMs + (now - updatedAt) else positionMs
    return if (durationMs > 0) position.coerceAtMost(durationMs) else position
  }

  fun merge(options: MediaSessionOptions): MediaState {
    val now = SystemClock.elapsedRealtime()
    return MediaState(
      title = options.title ?: title,
      subtitle = options.subtitle ?: subtitle,
      playing = options.playing ?: playing,
      positionMs = options.positionMs?.takeIf { !it.isNaN() }?.toLong()?.coerceAtLeast(0) ?: currentPositionMs(now),
      durationMs = options.durationMs?.takeIf { !it.isNaN() && it > 0 }?.toLong() ?: durationMs,
      updatedAt = now,
    )
  }
}

/**
 * Shared between [TvCastModule] and [CastMediaService]. Everything but [listener]
 * is touched on the main thread only.
 */
internal object MediaSessionHub {
  /** False once JS (or the notification's stop) ended the session; a service starting late then stops. */
  var active = false
  var state = MediaState()
  var service: CastMediaService? = null

  /** Sends `onMediaAction` to JS; null while no React instance is alive. */
  @Volatile var listener: ((Map<String, Any?>) -> Unit)? = null
}
