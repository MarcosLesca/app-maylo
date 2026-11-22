/**
 * Pure DLNA/UPnP helpers: read SSDP replies and device descriptions, and build
 * the SOAP bodies that drive a TV's AVTransport and RenderingControl services. No I/O here so it can
 * be tested in Node; the network calls live in dlna-client.ts.
 */

export const AV_TRANSPORT = 'urn:schemas-upnp-org:service:AVTransport:1';
export const RENDERING_CONTROL = 'urn:schemas-upnp-org:service:RenderingControl:1';

/** One SSDP packet: a search reply or (best effort) a multicast `NOTIFY` heard on the Wi-Fi. */
export type SsdpPacket = { address: string; response: string; kind?: 'response' | 'notify' };
export type SsdpReply = SsdpPacket;
/** `renderingControlUrl` is missing when the TV does not expose volume control. */
export type Renderer = { name: string; controlUrl: string; renderingControlUrl?: string };

export function parseSsdpHeaders(response: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of response.split(/\r?\n/).slice(1)) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }
  return headers;
}

/** `host[:port]` of an absolute URL, or '' when it is not one. */
export function hostOf(url: string): string {
  return /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(url)?.[1]?.toLowerCase() ?? '';
}

/**
 * Comparable form of a host or address: lower case, without IPv6 brackets or
 * zone id, and IPv4-mapped IPv6 (`::ffff:a.b.c.d`) as plain IPv4.
 */
export function normalizeHost(host: string): string {
  let value = host.trim().toLowerCase();
  if (value.startsWith('[') && value.endsWith(']')) value = value.slice(1, -1);
  value = value.replace(/%.*$/, '');
  const mapped = /^(?:0{1,4}:){0,5}:?:?ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(value);
  return mapped ? mapped[1] : value;
}

/** Normalized host name (no port, no user info) of an absolute URL, or '' when it is not one. */
function hostnameOf(url: string): string {
  const host = hostOf(url).replace(/^[^@]*@/, '');
  const name = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.replace(/:\d*$/, '');
  return normalizeHost(name);
}

/** The start line decides: a reply to our search, a NOTIFY, or anything else (another phone's M-SEARCH). */
function packetKind(packet: SsdpPacket): 'response' | 'notify' | 'other' {
  const start = packet.response.trimStart().slice(0, 8).toUpperCase();
  if (start.startsWith('HTTP/')) return 'response';
  if (start.startsWith('NOTIFY')) return 'notify';
  return 'other';
}

/** Description URL a packet announces: search replies and `NOTIFY ssdp:alive` only. */
function announcedLocation(packet: SsdpPacket): string | undefined {
  const kind = packetKind(packet);
  if (kind === 'other') return undefined;
  const headers = parseSsdpHeaders(packet.response);
  if (kind === 'notify' && headers.nts?.toLowerCase() !== 'ssdp:alive') return undefined;
  return headers.location || undefined;
}

export type LocationCandidate = { location: string; sender: string; hostMatches: boolean };
export type SsdpSummary = { responses: number; notifies: number; candidates: LocationCandidate[] };

/**
 * Packet counts and every distinct Location with its sender. A Location may be
 * used only when it points at the device that sent it, so another device on the
 * Wi-Fi cannot steer our requests.
 */
export function summarizeSsdp(packets: SsdpPacket[]): SsdpSummary {
  let responses = 0;
  let notifies = 0;
  const candidates = new Map<string, LocationCandidate>();
  for (const packet of packets) {
    const kind = packetKind(packet);
    if (kind === 'response') responses++;
    else if (kind === 'notify') notifies++;
    const location = announcedLocation(packet);
    if (!location) continue;
    const host = hostnameOf(location);
    const hostMatches = host !== '' && host === normalizeHost(packet.address);
    const known = candidates.get(location);
    if (!known || (hostMatches && !known.hostMatches)) {
      candidates.set(location, { location, sender: packet.address, hostMatches });
    }
  }
  return { responses, notifies, candidates: [...candidates.values()] };
}

/** Description URLs of every device that answered or announced itself, once each. */
export function rendererLocations(packets: SsdpPacket[]): string[] {
  return summarizeSsdp(packets)
    .candidates.filter((candidate) => candidate.hostMatches)
    .map((candidate) => candidate.location);
}

const NAMED_ENTITIES: Record<string, string> = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };

/** One pass, so `&amp;#38;` stays `&#38;` instead of being decoded twice. */
function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|quot|apos|amp);/gi, (entity, body: string) => {
    if (body[0] !== '#') return NAMED_ENTITIES[body.toLowerCase()] ?? entity;
    const hex = body[1] === 'x' || body[1] === 'X';
    const code = hex ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });
}

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Tags may carry attributes (`<service xmlns="...">`) and a namespace prefix (`<u:serviceType>`).
const element = (name: string) => `<(?:[\\w.-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}\\s*>`;

function tag(xml: string, name: string): string | undefined {
  const match = new RegExp(element(name)).exec(xml);
  return match ? decodeXml(match[1].trim()) : undefined;
}

/** URNs hold no whitespace and compare case-insensitively; the version must still match exactly. */
const sameServiceType = (value: string | undefined, expected: string) =>
  value != null && value.replace(/\s+/g, '').toLowerCase() === expected.toLowerCase();

/**
 * Name, absolute AVTransport control URL and (when present) RenderingControl URL,
 * or null when the device cannot play media.
 */
export function parseDeviceDescription(xml: string, location: string): Renderer | null {
  const services = xml.match(new RegExp(element('service'), 'g')) ?? [];
  const base = tag(xml, 'URLBase') || location;
  // Exactly version 1: the SOAP namespace and SOAPACTION we send are version 1.
  const controlUrlOf = (serviceType: string) => {
    const service = services.find((candidate) => sameServiceType(tag(candidate, 'serviceType'), serviceType));
    const path = service && tag(service, 'controlURL');
    if (!path) return undefined;
    let url: string;
    try {
      url = new URL(path, base).toString();
    } catch {
      return undefined;
    }
    // Control must stay on the device that served the description.
    return hostnameOf(url) === hostnameOf(location) ? url : undefined;
  };
  const controlUrl = controlUrlOf(AV_TRANSPORT);
  if (!controlUrl) return null;
  const renderer: Renderer = { name: tag(xml, 'friendlyName') || hostnameOf(location), controlUrl };
  const renderingControlUrl = controlUrlOf(RENDERING_CONTROL);
  if (renderingControlUrl) renderer.renderingControlUrl = renderingControlUrl;
  return renderer;
}

/** Canonical IPv4 the user typed for a unicast search, or null when it cannot be a TV's address. */
export function parseIpv4(text: string): string | null {
  const value = text.trim();
  if (!/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(value)) return null;
  const octets = value.split('.').map(Number);
  if (octets.some((octet) => octet > 255)) return null;
  // Not "this network", loopback, multicast or reserved/broadcast.
  if (octets[0] === 0 || octets[0] === 127 || octets[0] >= 224) return null;
  return octets.join('.');
}

export type LocationOutcome =
  | { kind: 'ok'; name: string }
  | { kind: 'host-mismatch' }
  | { kind: 'fetch-failed'; status?: number; error?: string }
  | { kind: 'not-a-renderer' };

/** What a search saw, for the test panel log. `legacy`: an APK without the Wi-Fi-bound search. */
export type DiscoveryReport = {
  mode: 'multicast' | 'unicast';
  target?: string;
  legacy?: boolean;
  responses: number;
  notifies: number;
  network?: { interfaceName?: string; localAddress?: string; listening?: boolean; error?: string };
  locations: { location: string; sender: string; outcome: LocationOutcome }[];
};

function outcomeText(outcome: LocationOutcome): string {
  switch (outcome.kind) {
    case 'ok':
      return `TV lista — ${outcome.name}`;
    case 'host-mismatch':
      return 'descartada, la dirección no es la de quien respondió';
    case 'fetch-failed':
      return `no se pudo leer la descripción (${outcome.status != null ? `HTTP ${outcome.status}` : (outcome.error ?? 'error')})`;
    case 'not-a-renderer':
      return 'no es una TV (sin AVTransport:1)';
  }
}

/** Plain lines for the "Prueba de conexión" log. */
export function formatDiscoveryReport(report: DiscoveryReport): string[] {
  const how = report.mode === 'unicast' ? `Búsqueda directa a ${report.target ?? '?'}` : 'Búsqueda por multicast';
  const lines = [`${how}: ${report.responses} respuestas, ${report.notifies} NOTIFY`];
  if (report.legacy) lines.push('Esta versión de la app busca sin elegir la red Wi-Fi; instalá la última versión.');
  const network = report.network;
  if (network) {
    const where = [network.interfaceName, network.localAddress].filter(Boolean).join(' ') || 'Wi-Fi no encontrado';
    const listening =
      network.listening == null ? '' : ` · escucha de NOTIFY: ${network.listening ? 'sí' : 'no (puerto 1900 ocupado)'}`;
    lines.push(`Red: ${where}${listening}`);
    if (network.error) lines.push(`No se pudo enviar la búsqueda: ${network.error}`);
  }
  for (const { location, sender, outcome } of report.locations) {
    lines.push(`${location} (de ${sender}): ${outcomeText(outcome)}`);
  }
  if (report.locations.length === 0) {
    lines.push(
      report.responses + report.notifies === 0
        ? 'Ningún aparato respondió a la búsqueda.'
        : 'Respondieron aparatos, pero ninguno indicó una dirección de descripción.',
    );
  }
  return lines;
}

/** CurrentVolume of a GetVolume response, clamped to 0-100, or null when unreadable. */
export function parseVolume(xml: string): number | null {
  const text = tag(xml, 'CurrentVolume');
  if (!text || !/^\d+$/.test(text)) return null;
  return Math.min(100, Number(text));
}

/** CurrentMute of a GetMute response, or null when unreadable. */
export function parseMute(xml: string): boolean | null {
  const text = tag(xml, 'CurrentMute')?.toLowerCase();
  if (text === '1' || text === 'true') return true;
  if (text === '0' || text === 'false') return false;
  return null;
}

export function mimeTypeFor(url: string): string {
  const path = url.split(/[?#]/)[0].toLowerCase();
  if (path.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
  if (path.endsWith('.webm')) return 'video/webm';
  if (path.endsWith('.mkv')) return 'video/x-matroska';
  return 'video/mp4';
}

/** Metadata most renderers (Hisense included) want alongside the URI. */
export function buildDidlLite(url: string, title: string): string {
  return (
    '<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" ' +
    'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">' +
    '<item id="0" parentID="-1" restricted="1">' +
    `<dc:title>${escapeXml(title)}</dc:title>` +
    '<upnp:class>object.item.videoItem</upnp:class>' +
    `<res protocolInfo="http-get:*:${mimeTypeFor(url)}:*">${escapeXml(url)}</res>` +
    '</item></DIDL-Lite>'
  );
}

export function buildSoapEnvelope(
  action: string,
  args: Record<string, string>,
  serviceType: string = AV_TRANSPORT,
): string {
  const body = Object.entries(args)
    .map(([key, value]) => `<${key}>${escapeXml(value)}</${key}>`)
    .join('');
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" ' +
    's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body>' +
    `<u:${action} xmlns:u="${serviceType}">${body}</u:${action}>` +
    '</s:Body></s:Envelope>'
  );
}
