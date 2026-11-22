/**
 * Pure DLNA/UPnP helpers: read SSDP replies and device descriptions, and build
 * the SOAP bodies that drive a TV's AVTransport and RenderingControl services. No I/O here so it can
 * be tested in Node; the network calls live in dlna-client.ts.
 */

export const AV_TRANSPORT = 'urn:schemas-upnp-org:service:AVTransport:1';
export const RENDERING_CONTROL = 'urn:schemas-upnp-org:service:RenderingControl:1';

export type SsdpReply = { address: string; response: string };
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

const hostnameOf = (url: string) => hostOf(url).replace(/:\d+$/, '');

/**
 * Description URLs of every device that answered, once each. A reply must point
 * at its own sender, so another device on the Wi-Fi cannot steer our requests.
 */
export function rendererLocations(replies: SsdpReply[]): string[] {
  const seen = new Set<string>();
  for (const reply of replies) {
    const location = parseSsdpHeaders(reply.response).location;
    if (location && hostnameOf(location) === reply.address.toLowerCase()) seen.add(location);
  }
  return [...seen];
}

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function tag(xml: string, name: string): string | undefined {
  const match = new RegExp(`<(?:\\w+:)?${name}>([\\s\\S]*?)</(?:\\w+:)?${name}>`).exec(xml);
  return match ? decodeXml(match[1].trim()) : undefined;
}

/**
 * Name, absolute AVTransport control URL and (when present) RenderingControl URL,
 * or null when the device cannot play media.
 */
export function parseDeviceDescription(xml: string, location: string): Renderer | null {
  const services = xml.match(/<(?:\w+:)?service>[\s\S]*?<\/(?:\w+:)?service>/g) ?? [];
  const base = tag(xml, 'URLBase') || location;
  // Exactly version 1: the SOAP namespace and SOAPACTION we send are version 1.
  const controlUrlOf = (serviceType: string) => {
    const service = services.find((candidate) => tag(candidate, 'serviceType') === serviceType);
    const path = service && tag(service, 'controlURL');
    if (!path) return undefined;
    const url = new URL(path, base).toString();
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
