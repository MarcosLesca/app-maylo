/**
 * Playback time as DLNA speaks it (H:MM:SS, e.g. RelTime and Seek targets) and
 * as the remote shows it. Pure, so it runs under node:test.
 */

/** Whole seconds from `H:MM:SS[.fff]`; null for NOT_IMPLEMENTED, empty or malformed values. */
export function parseHms(text: string | undefined): number | null {
  const match = /^(\d+):([0-5]\d):([0-5]\d)(?:\.\d+)?$/.exec(text?.trim() ?? '');
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

const pad = (value: number) => String(value).padStart(2, '0');

function split(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  return { hours: Math.floor(total / 3600), minutes: Math.floor((total % 3600) / 60), secs: total % 60 };
}

/** `H:MM:SS`, the REL_TIME target Seek expects. */
export function formatHms(seconds: number): string {
  const { hours, minutes, secs } = split(seconds);
  return `${hours}:${pad(minutes)}:${pad(secs)}`;
}

/** Clock under the progress bar: `12:04`, or `1:36:00` once there are hours. */
export function formatClock(seconds: number | null): string {
  if (seconds == null) return '--:--';
  const { hours, minutes, secs } = split(seconds);
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}

const unit = (value: number, one: string, many: string) => `${value} ${value === 1 ? one : many}`;

/** "12 minutos 4 segundos", for screen readers. */
export function spokenTime(seconds: number): string {
  const { hours, minutes, secs } = split(seconds);
  const parts = [
    hours ? unit(hours, 'hora', 'horas') : '',
    minutes ? unit(minutes, 'minuto', 'minutos') : '',
    secs ? unit(secs, 'segundo', 'segundos') : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' ') : '0 segundos';
}

/** Whole-second seek target inside [0, duration]; only the lower bound when the duration is unknown. */
export function clampSeek(target: number, duration: number | null): number {
  const rounded = Math.max(0, Math.round(target));
  return duration == null ? rounded : Math.min(rounded, Math.max(0, Math.round(duration)));
}

function element(xml: string, name: string): string | undefined {
  return new RegExp(`<(?:\\w+:)?${name}>([^<]*)</(?:\\w+:)?${name}>`).exec(xml)?.[1];
}

/** Position and duration (seconds) from a GetPositionInfo response; a zero duration means unknown. */
export function parsePositionInfo(xml: string): { position: number | null; duration: number | null } {
  const duration = parseHms(element(xml, 'TrackDuration'));
  return { position: parseHms(element(xml, 'RelTime')), duration: duration ? duration : null };
}
