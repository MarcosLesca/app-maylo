/**
 * Pure rules of the ESP32 TV hub (odd/tasks/esp32-tv-hub.md S4): its address,
 * what this phone registers there and the Spanish texts of the connect screen.
 * No imports, so it is tested in Node; storage and HTTP live in hub-client.ts.
 */

/** mDNS name the firmware announces (S1); the IP works too when mDNS does not. */
export const DEFAULT_HUB_ADDRESS = 'http://maylo-tv.local';

/** Re-register this often while the receiver is held (the hub forgets phones after 180 s). */
export const HUB_REGISTER_MS = 60_000;

/** Timeout of every request to the hub. */
export const HUB_TIMEOUT_MS = 3000;

/** Longest name the hub keeps (S2). */
const MAX_NAME = 40;

export const HUB_INVALID_TEXT =
  'Escribí una dirección como http://maylo-tv.local o http://192.168.0.50 (sin nada después de la dirección).';

const LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/** `http://host[:port]` (optional trailing slash) as a lower-case origin, or null for anything else. */
export function parseHubAddress(input: string): string | null {
  if (typeof input !== 'string') return null;
  const match = /^http:\/\/([^/:?#@\s]+)(?::(\d{1,5}))?\/?$/i.exec(input.trim());
  if (!match) return null;
  const host = match[1].toLowerCase();
  if (!host.split('.').every((label) => LABEL.test(label))) return null;
  if (match[2] != null) {
    const port = Number(match[2]);
    if (port < 1 || port > 65535) return null;
    return `http://${host}:${port}`;
  }
  return `http://${host}`;
}

/** The URL rule of the hub's POST /register (S2): this phone's receiver on ports 8765-8775. */
const OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const REGISTER_URL = new RegExp(`^http://${OCTET}(?:\\.${OCTET}){3}:87(?:6[5-9]|7[0-5])/tv/[A-Za-z0-9]{6}$`);

/** JSON body of POST <hub>/register, or null when the hub would refuse this URL. */
export function hubRegisterBody(url: string, name: string): string | null {
  if (typeof url !== 'string' || !REGISTER_URL.test(url)) return null;
  return JSON.stringify({ url, name: (name ?? '').trim().slice(0, MAX_NAME) });
}

/** Outcome of the last POST /register. */
export type HubRegistration = { ok: boolean; at: number };

/** Connect screen line for the last registration; null before the first one. */
export function hubRegistrationText(last: HubRegistration | null, now: number): string | null {
  if (!last) return null;
  if (!last.ok) return 'No se pudo registrar en el hub';
  return `Registrado en el hub hace ${Math.max(0, Math.floor((now - last.at) / 1000))} s`;
}

/** Phones in a GET /phones answer, or null when it is not the hub's JSON. */
export function parseHubPhones(json: string): number | null {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value == null || Array.isArray(value)) return null;
  const phones = (value as { phones?: unknown }).phones;
  return Array.isArray(phones) ? phones.length : null;
}

export type HubProbe = { ok: true; phones: number } | { ok: false };

/** Result of the "Probar" button. */
export function hubProbeText(probe: HubProbe): string {
  if (!probe.ok) {
    return 'No se pudo conectar con el hub. Revisá la dirección y que el ESP32 esté prendido y en el mismo Wi-Fi.';
  }
  if (probe.phones === 0) return 'El hub responde (sin teléfonos registrados todavía)';
  return probe.phones === 1
    ? 'El hub responde (1 teléfono registrado)'
    : `El hub responde (${probe.phones} teléfonos registrados)`;
}

/** The one favorite the TV keeps. */
export function hubFavoriteText(hub: string): string {
  return `En la tele guardá como favorito: ${hub}/`;
}
