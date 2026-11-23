/**
 * Pure DLNA/UPnP helpers: read SSDP replies and device descriptions, and build
 * the SOAP bodies that drive a TV's AVTransport and RenderingControl services. No I/O here so it can
 * be tested in Node; the network calls live in dlna-client.ts.
 */

/** The SOAP calls always speak version 1; versions 2 and 3 must accept it. */
export const AV_TRANSPORT = 'urn:schemas-upnp-org:service:AVTransport:1';
export const RENDERING_CONTROL = 'urn:schemas-upnp-org:service:RenderingControl:1';

/** Routers announce themselves with these device and service types. */
const ROUTER_TYPE = /InternetGatewayDevice|WAN(?:IP|PPP)Connection|WANDevice|WANConnectionDevice|WANCommonInterfaceConfig/i;
const DIAL_TYPE = /dial-multiscreen-org/i;
/** Hints that a sender is the Hisense (VIDAA) TV. */
const TV_BRAND = /hisense|vidaa|linux\s*tv/i;

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

/** What one address sent during a search, also when it gave no Location. */
export type SsdpSender = {
  /** Normalized address (IPv4-mapped IPv6 as plain IPv4). */
  address: string;
  responses: number;
  notifies: number;
  /** Anything else, e.g. another phone's M-SEARCH. */
  others: number;
  /** Distinct ST (replies) and NT (NOTIFYs), short form, in first-seen order. */
  targets: string[];
  server?: string;
  /** USN up to the uuid's first block. */
  usn?: string;
  /** Answered or announced DIAL (what YouTube uses to find TVs). */
  dial: boolean;
  /** Announced a router type (InternetGatewayDevice, WANIPConnection, ...). */
  router: boolean;
};

export type SsdpSummary = {
  responses: number;
  notifies: number;
  candidates: LocationCandidate[];
  senders: SsdpSender[];
};

/** `urn:...:service:AVTransport:1` -> `AVTransport:1`, `upnp:rootdevice` -> `rootdevice`. */
function shortTarget(value: string): string {
  const text = value.trim();
  if (/^uuid:/i.test(text)) return 'uuid';
  if (/^upnp:rootdevice$/i.test(text)) return 'rootdevice';
  const parts = text.split(':');
  if (/^urn:/i.test(text) && parts.length >= 5) return parts.slice(-2).join(':');
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

function usnPrefix(usn: string): string {
  const id = usn.split('::')[0].trim();
  return id.length > 13 ? `${id.slice(0, 13)}…` : id;
}

/**
 * Packet counts, every sender, and every distinct Location with its sender. A
 * Location may be used only when it points at the device that sent it, so
 * another device on the Wi-Fi cannot steer our requests.
 */
export function summarizeSsdp(packets: SsdpPacket[]): SsdpSummary {
  let responses = 0;
  let notifies = 0;
  const candidates = new Map<string, LocationCandidate>();
  const senders = new Map<string, SsdpSender>();
  for (const packet of packets) {
    const kind = packetKind(packet);
    if (kind === 'response') responses++;
    else if (kind === 'notify') notifies++;
    const address = normalizeHost(packet.address);
    let sender = senders.get(address);
    if (!sender) {
      sender = { address, responses: 0, notifies: 0, others: 0, targets: [], dial: false, router: false };
      senders.set(address, sender);
    }
    if (kind === 'response') sender.responses++;
    else if (kind === 'notify') sender.notifies++;
    else sender.others++;
    if (kind !== 'other') {
      const headers = parseSsdpHeaders(packet.response);
      const target = kind === 'response' ? headers.st : headers.nt;
      if (target) {
        const short = shortTarget(target);
        if (!sender.targets.includes(short)) sender.targets.push(short);
        if (DIAL_TYPE.test(target)) sender.dial = true;
        if (ROUTER_TYPE.test(target)) sender.router = true;
      }
      if (!sender.server && headers.server) sender.server = headers.server;
      if (!sender.usn && headers.usn) sender.usn = usnPrefix(headers.usn);
    }
    const location = announcedLocation(packet);
    if (!location) continue;
    const host = hostnameOf(location);
    const hostMatches = host !== '' && host === normalizeHost(packet.address);
    const known = candidates.get(location);
    if (!known || (hostMatches && !known.hostMatches)) {
      candidates.set(location, { location, sender: packet.address, hostMatches });
    }
  }
  return { responses, notifies, candidates: [...candidates.values()], senders: [...senders.values()] };
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

/**
 * URNs hold no whitespace and compare case-insensitively; the version must be
 * exactly 1, 2 or 3 (later versions accept the version 1 calls we send).
 */
const serviceFamily = (name: string) => new RegExp(`^urn:schemas-upnp-org:service:${name}:[123]$`, 'i');
const AV_TRANSPORT_TYPE = serviceFamily('AVTransport');
const RENDERING_CONTROL_TYPE = serviceFamily('RenderingControl');
const isServiceType = (value: string | undefined, family: RegExp) => value != null && family.test(value.replace(/\s+/g, ''));

const DEVICE_TAG = /<(\/?)(?:[\w.-]+:)?(device|deviceList)(?=[\s>\/])[^>]*>/g;

/**
 * The own XML of every `<device>` (root first, then embedded ones in document
 * order) without its nested `<deviceList>`; the whole text when there is none.
 */
function deviceBlocks(xml: string): string[] {
  const blocks: string[] = [];
  const stack: { name: string; block: number; cursor: number }[] = [];
  for (const match of xml.matchAll(DEVICE_TAG)) {
    const [text, closing, name] = match;
    const start = match.index;
    const end = start + text.length;
    if (text.endsWith('/>')) continue;
    const top = stack[stack.length - 1];
    if (!closing) {
      if (top?.name === 'device') blocks[top.block] += xml.slice(top.cursor, start);
      if (name === 'device') stack.push({ name, block: blocks.push('') - 1, cursor: end });
      else stack.push({ name, block: -1, cursor: end });
      continue;
    }
    if (top?.name !== name) continue; // Malformed nesting: ignore the stray closing tag.
    stack.pop();
    if (name === 'device') blocks[top.block] += xml.slice(top.cursor, start);
    const parent = stack[stack.length - 1];
    if (parent) parent.cursor = end;
  }
  // Unclosed devices keep whatever followed their last nested list.
  for (const open of stack) if (open.name === 'device') blocks[open.block] += xml.slice(open.cursor);
  return blocks.length ? blocks : [xml];
}

/**
 * Name, absolute AVTransport control URL and (when present) RenderingControl URL,
 * or null when the device cannot play media. Embedded devices count; volume
 * comes from the renderer's own device first.
 */
export function parseDeviceDescription(xml: string, location: string): Renderer | null {
  const devices = deviceBlocks(xml);
  const base = tag(xml, 'URLBase') || location;
  const controlUrlIn = (device: string, family: RegExp) => {
    const services = device.match(new RegExp(element('service'), 'g')) ?? [];
    const service = services.find((candidate) => isServiceType(tag(candidate, 'serviceType'), family));
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
  for (const device of devices) {
    const controlUrl = controlUrlIn(device, AV_TRANSPORT_TYPE);
    if (!controlUrl) continue;
    const name = tag(device, 'friendlyName') || tag(xml, 'friendlyName') || hostnameOf(location);
    const renderer: Renderer = { name, controlUrl };
    let renderingControlUrl = controlUrlIn(device, RENDERING_CONTROL_TYPE);
    for (const other of devices) {
      if (renderingControlUrl) break;
      if (other !== device) renderingControlUrl = controlUrlIn(other, RENDERING_CONTROL_TYPE);
    }
    if (renderingControlUrl) renderer.renderingControlUrl = renderingControlUrl;
    return renderer;
  }
  return null;
}

/** What a fetched description says about its device, for the report. */
export type DescriptionInfo = { friendlyName?: string; manufacturer?: string; modelName?: string; router: boolean };

/** friendlyName, manufacturer and modelName (root device first) and whether it is a router. */
export function describeDevice(xml: string): DescriptionInfo {
  const devices = deviceBlocks(xml);
  const info: DescriptionInfo = { router: false };
  for (const field of ['friendlyName', 'manufacturer', 'modelName'] as const) {
    for (const device of devices) {
      const value = tag(device, field);
      if (value) {
        info[field] = value;
        break;
      }
    }
  }
  const types = [...(xml.match(new RegExp(element('deviceType'), 'g')) ?? []), ...(xml.match(new RegExp(element('serviceType'), 'g')) ?? [])];
  info.router = types.some((type) => ROUTER_TYPE.test(type));
  return info;
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
  | { kind: 'ok'; name: string; info?: DescriptionInfo }
  | { kind: 'host-mismatch' }
  | { kind: 'fetch-failed'; status?: number; error?: string }
  | { kind: 'not-a-renderer'; info?: DescriptionInfo };

export type LocationReport = { location: string; sender: string; outcome: LocationOutcome };

/** A unicast M-SEARCH sent to a sender that gave no renderer, within the same search. */
export type FollowUp = { host: string; responses: number; error?: string };

/** What a search saw, for the test panel log. `legacy`: an APK without the Wi-Fi-bound search. */
export type DiscoveryReport = {
  mode: 'multicast' | 'unicast';
  target?: string;
  legacy?: boolean;
  responses: number;
  notifies: number;
  network?: { interfaceName?: string; localAddress?: string; listening?: boolean; error?: string };
  /** Every address that sent something; missing on older callers. */
  senders?: SsdpSender[];
  locations: LocationReport[];
  followUps?: FollowUp[];
};

const failReason = (outcome: { status?: number; error?: string }) =>
  outcome.status != null ? `HTTP ${outcome.status}` : (outcome.error ?? 'error');

/** `Hisense 50A4NV` from manufacturer + model, else the friendlyName. */
function modelLabel(info: DescriptionInfo | undefined): string | undefined {
  if (!info) return undefined;
  const { manufacturer, modelName } = info;
  const model =
    manufacturer && modelName?.toLowerCase().includes(manufacturer.toLowerCase())
      ? modelName
      : [manufacturer, modelName].filter(Boolean).join(' ');
  return model || undefined;
}

function brandOf(text: string | undefined): string | undefined {
  const found = text && TV_BRAND.exec(text)?.[0].toLowerCase();
  if (!found) return undefined;
  return found === 'hisense' ? 'Hisense' : found === 'vidaa' ? 'VIDAA' : 'Linux TV';
}

function infoText(info: DescriptionInfo | undefined): string {
  const parts = [info?.friendlyName, modelLabel(info)].filter((part): part is string => !!part);
  return [...new Set(parts)].join(' — ');
}

function outcomeText(outcome: LocationOutcome): string {
  switch (outcome.kind) {
    case 'ok':
      return `TV lista — ${outcome.name}`;
    case 'host-mismatch':
      return 'descartada, la dirección no es la de quien respondió';
    case 'fetch-failed':
      return `no se pudo leer la descripción (${failReason(outcome)})`;
    case 'not-a-renderer': {
      const what = outcome.info?.router ? 'router, no es una TV' : 'no es una TV (sin AVTransport)';
      const details = infoText(outcome.info);
      return details ? `${what} · ${details}` : what;
    }
  }
}

type SenderView = {
  sender: SsdpSender;
  locations: LocationReport[];
  info?: DescriptionInfo;
  router: boolean;
  ok: boolean;
  likelyTv: boolean;
  /** Name for the sender: model from its description, else a TV brand in its SERVER. */
  label?: string;
};

function senderViews(senders: SsdpSender[], locations: LocationReport[]): SenderView[] {
  return senders.map((sender) => {
    const own = locations.filter((entry) => normalizeHost(entry.sender) === sender.address);
    const info = own
      .map(({ outcome }) => (outcome.kind === 'ok' || outcome.kind === 'not-a-renderer' ? outcome.info : undefined))
      .find((value) => value != null);
    const router = sender.router || own.some(({ outcome }) => 'info' in outcome && outcome.info?.router === true);
    const ok = own.some(({ outcome }) => outcome.kind === 'ok');
    const hints = [sender.server, info?.manufacturer, info?.friendlyName, info?.modelName];
    const likelyTv = !router && (sender.dial || hints.some((hint) => hint != null && TV_BRAND.test(hint)));
    const label = modelLabel(info) ?? info?.friendlyName ?? brandOf(sender.server);
    return { sender, locations: own, info, router, ok, likelyTv, label };
  });
}

const ellipsis = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

/** One short line per sender: counts, ST/NT, SERVER, USN prefix. */
function senderLine(view: SenderView): string {
  const { sender } = view;
  const counts = [
    sender.responses ? `${sender.responses} respuestas` : '',
    sender.notifies ? `${sender.notifies} NOTIFY` : '',
    sender.others ? `${sender.others} M-SEARCH` : '',
  ]
    .filter(Boolean)
    .join(', ');
  const shown = sender.targets.slice(0, 4).join(', ');
  const targets = sender.targets.length > 4 ? `${shown} +${sender.targets.length - 4}` : shown;
  const parts = [counts, targets, sender.server ? ellipsis(sender.server, 48) : '', sender.usn ?? ''];
  if (view.locations.length === 0) parts.push('sin Location');
  const label = view.router ? 'router' : view.label;
  return `${sender.address}${label ? ` (${label})` : ''}: ${parts.filter(Boolean).join(' · ')}`;
}

/** Plain-Spanish verdict when no TV was found: the likely TV and why it cannot play, or who answered. */
function headline(views: SenderView[]): string[] {
  const likely = views.filter((view) => view.likelyTv).slice(0, 3);
  if (likely.length) {
    let playable = false;
    const lines = likely.map((view) => {
      const failed = view.locations.find(({ outcome }) => outcome.kind === 'fetch-failed')?.outcome;
      const who = `${view.sender.address}${view.label ? ` (${view.label})` : ''} respondió${view.sender.dial ? ' por DIAL' : ''}`;
      if (failed?.kind === 'fetch-failed') return `${who} pero no se pudo leer su descripción (${failReason(failed)})`;
      playable = true;
      return `${who} pero no ofrece reproductor DLNA (AVTransport)`;
    });
    if (playable) {
      lines.push('La tele está en la red pero no acepta videos por DLNA: revisá “Compartir contenido” o usá Duplicar pantalla.');
    }
    return lines;
  }
  if (views.every((view) => view.router)) {
    return [`Solo respondió el router (${views.map((view) => view.sender.address).join(', ')}): la TV no contestó a ninguna búsqueda.`];
  }
  return ['Ningún aparato parece una TV: ninguno ofrece reproductor DLNA (AVTransport).'];
}

/**
 * Hosts worth a unicast M-SEARCH within the same search: senders that gave no
 * renderer and are not the router nor `exclude` (the phone), likely TVs first, at most 8.
 */
export function followUpHosts(senders: SsdpSender[], locations: LocationReport[], exclude: string[]): string[] {
  const skip = new Set(exclude.map(normalizeHost));
  const views = senderViews(senders, locations).filter(
    (view) => view.sender.address !== '' && !view.router && !view.ok && !skip.has(view.sender.address),
  );
  return [...views.filter((view) => view.likelyTv), ...views.filter((view) => !view.likelyTv)]
    .slice(0, 8)
    .map((view) => view.sender.address);
}

/**
 * The senders without the phone itself: its own M-SEARCH packets come back
 * through the multicast listener. `ownAddress` '' (Wi-Fi unknown) drops nothing.
 */
export function withoutOwnSenders(senders: SsdpSender[], ownAddress: string): SsdpSender[] {
  const own = normalizeHost(ownAddress);
  return own ? senders.filter((sender) => sender.address !== own) : senders;
}

/**
 * True when no DLNA TV was found and every TV-like device answered DIAL only:
 * the TV can still play through its own browser (the receiver page).
 */
export function suggestsBrowserReceiver(report: DiscoveryReport | null): boolean {
  if (!report || report.locations.some(({ outcome }) => outcome.kind === 'ok')) return false;
  const likely = senderViews(report.senders ?? [], report.locations).filter((view) => view.likelyTv);
  return likely.length > 0 && likely.every((view) => view.sender.dial && !view.ok);
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
  const views = senderViews(report.senders ?? [], report.locations);
  if (views.length) {
    if (!views.some((view) => view.ok)) lines.push(...headline(views));
    lines.push(`Aparatos que respondieron: ${views.length}`);
    for (const view of views) {
      lines.push(senderLine(view));
      for (const { location, outcome } of view.locations) lines.push(`  ${location}: ${outcomeText(outcome)}`);
    }
  }
  const listed = new Set(views.map((view) => view.sender.address));
  for (const { location, sender, outcome } of report.locations) {
    if (!listed.has(normalizeHost(sender))) lines.push(`${location} (de ${sender}): ${outcomeText(outcome)}`);
  }
  for (const followUp of report.followUps ?? []) {
    const result = followUp.error ? `falló (${followUp.error})` : `${followUp.responses} respuestas`;
    lines.push(`Búsqueda directa a ${followUp.host}: ${result}`);
  }
  if (report.locations.length === 0 && views.length === 0) {
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
