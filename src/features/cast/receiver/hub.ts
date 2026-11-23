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

/** Most member names the hub keeps (S6). */
export const HUB_MAX_MEMBERS = 4;

/** Largest POST /register body the hub accepts, in UTF-8 bytes (S6 raised it from 512). */
export const HUB_BODY_LIMIT = 1024;

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

// Cut whole code points: a half emoji (lone surrogate) makes the hub reject the body.
const hubName = (name: string) => Array.from(name.trim()).slice(0, MAX_NAME).join('');

/** The members the hub shows (S6): trimmed, cut at 40 whole characters, without empty or repeated names, at most 4. */
export function hubMemberNames(names: readonly unknown[]): string[] {
  const result: string[] = [];
  for (const value of names) {
    if (typeof value !== 'string') continue;
    const name = hubName(value);
    if (name && !result.includes(name)) result.push(name);
    if (result.length === HUB_MAX_MEMBERS) break;
  }
  return result;
}

/** UTF-8 length of a string (JSON.stringify output has no lone surrogates here). */
function utf8Bytes(text: string): number {
  let bytes = 0;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/**
 * JSON body of POST <hub>/register, or null when the hub would refuse this URL.
 * `members` (all app members, S6) is sent when there is any; the last ones are
 * left out if the body would pass the hub's 1024-byte limit.
 */
export function hubRegisterBody(url: string, name: string, members: readonly unknown[] = []): string | null {
  if (typeof url !== 'string' || !REGISTER_URL.test(url)) return null;
  const base = { url, name: hubName(name ?? '') };
  const list = hubMemberNames(members);
  for (let count = list.length; count > 0; count -= 1) {
    const body = JSON.stringify({ ...base, members: list.slice(0, count) });
    if (utf8Bytes(body) <= HUB_BODY_LIMIT) return body;
  }
  return JSON.stringify(base);
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
