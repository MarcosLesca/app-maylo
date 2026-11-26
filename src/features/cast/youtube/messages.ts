/**
 * What the user reads when a YouTube video cannot be cast (S2v): the
 * `playabilityStatus` of the VISIONOS player answer as a plain Spanish message,
 * plus a short technical detail for diagnosing on the device. Every message
 * names YouTube (the cast sheet shows those as is). Pure, no imports, so it is
 * tested in Node.
 */

export const YOUTUBE_MESSAGES = {
  login:
    'YouTube pide iniciar sesión para ver este video (por edad o porque es privado), así que no se puede pasar a la tele.',
  /** Members-only, made-for-kids (VISIONOS answers both as a bare UNPLAYABLE) and other refusals. */
  unplayable: 'YouTube no deja ver este video fuera de su app (por ejemplo, si es solo para miembros o para chicos).',
  unavailable: 'Este video de YouTube no está disponible.',
  live: 'Los videos en vivo de YouTube no se pueden pasar a la tele.',
  formats: 'Este video de YouTube no tiene un formato que la tele pueda reproducir.',
  failed: 'No se pudo leer el video de YouTube. Probá de nuevo en un rato.',
  /** S4: separate audio and video streams only play on the TV browser receiver. */
  dlna: 'YouTube solo se puede ver con el navegador de la tele.',
  /** The installed APK predates the proxy that allows the YouTube pair (S5). */
  update: 'Para ver YouTube en la tele instalá la última versión de la app.',
};

type Raw = Record<string, unknown>;

const isObject = (value: unknown): value is Raw => typeof value === 'object' && value != null && !Array.isArray(value);

function toNumber(value: unknown): number | null {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : null;
}

/** Null when the player answer is playable; otherwise why not, in Spanish. */
export function playabilityMessage(response: unknown): string | null {
  if (!isObject(response) || !isObject(response.playabilityStatus)) return YOUTUBE_MESSAGES.failed;
  const status = response.playabilityStatus.status;
  const details = isObject(response.videoDetails) ? response.videoDetails : {};
  const length = toNumber(details.lengthSeconds);
  // VISIONOS answers a live stream UNPLAYABLE ("the recording is not available") with isLiveContent.
  const live = details.isLive === true || (details.isLiveContent === true && (status !== 'OK' || !length));
  if (status === 'LOGIN_REQUIRED' || status === 'AGE_CHECK_REQUIRED' || status === 'AGE_VERIFICATION_REQUIRED') {
    return YOUTUBE_MESSAGES.login;
  }
  if (status === 'LIVE_STREAM_OFFLINE' || status === 'LIVE_STREAM' || live) return YOUTUBE_MESSAGES.live;
  if (status === 'ERROR') return YOUTUBE_MESSAGES.unavailable;
  if (typeof status !== 'string') return YOUTUBE_MESSAGES.failed;
  if (status !== 'OK') return YOUTUBE_MESSAGES.unplayable;
  return null;
}

/** `message` plus a short technical detail (which step, which HTTP status), for diagnosing on the device. */
export function failureText(message: string, detail: string): string {
  const short = detail.trim().slice(0, 120);
  return short ? `${message} (Detalle: ${short})` : message;
}
