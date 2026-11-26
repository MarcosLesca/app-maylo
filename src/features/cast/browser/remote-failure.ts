import type { ReceiverErrorDetail } from '../receiver/receiver-state';

const FAILED = 'La tele no pudo reproducir este video. Probá con otro o usá “Duplicar la pantalla”.';

/**
 * The remote's text when the TV could not play the video; with the TV's last
 * hls.js error (S6) it ends with a short technical line, e.g.
 * "Detalle: networkError/fragLoadError 403 (audio)".
 */
export function receiverFailureText(detail?: ReceiverErrorDetail | null): string {
  if (!detail) return FAILED;
  const code = detail.code != null ? ` ${detail.code}` : '';
  const stream = detail.stream ? ` (${detail.stream})` : '';
  return `${FAILED} Detalle: ${detail.type}/${detail.details}${code}${stream}`;
}
