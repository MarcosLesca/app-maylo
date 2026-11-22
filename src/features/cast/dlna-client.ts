import TvCast from '../../../modules/tv-cast';
import {
  AV_TRANSPORT,
  buildDidlLite,
  buildSoapEnvelope,
  type DiscoveryReport,
  type LocationCandidate,
  type LocationOutcome,
  parseDeviceDescription,
  parseIpv4,
  parseMute,
  parseVolume,
  RENDERING_CONTROL,
  type Renderer,
  type SsdpPacket,
  summarizeSsdp,
} from './dlna';
import { formatHms, parsePositionInfo } from './time';

export type { DiscoveryReport, Renderer } from './dlna';

/** False on iOS and on APKs that predate the native module. */
export const castSupported = TvCast != null;

type TextResponse = { ok: boolean; status: number; text: string };

/** The timeout covers the body too, so a TV that stalls mid-response cannot hang the screen. */
async function fetchText(url: string, init: RequestInit = {}, timeoutMs = 4000): Promise<TextResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return { ok: response.ok, status: response.status, text: await response.text() };
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`la TV no respondió en ${timeoutMs / 1000} s`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export type Discovery = { renderers: Renderer[]; report: DiscoveryReport };

export const INVALID_IP_MESSAGE = 'Escribí una IP válida, por ejemplo 192.168.1.50.';

/** Reads one announced description; the outcome says why it is not a TV when it is not. */
async function inspect(candidate: LocationCandidate): Promise<{ renderer: Renderer | null; outcome: LocationOutcome }> {
  if (!candidate.hostMatches) return { renderer: null, outcome: { kind: 'host-mismatch' } };
  let response: TextResponse;
  try {
    response = await fetchText(candidate.location);
  } catch (error) {
    return {
      renderer: null,
      outcome: { kind: 'fetch-failed', error: error instanceof Error ? error.message : String(error) },
    };
  }
  if (!response.ok) return { renderer: null, outcome: { kind: 'fetch-failed', status: response.status } };
  const renderer = parseDeviceDescription(response.text, candidate.location);
  return renderer
    ? { renderer, outcome: { kind: 'ok', name: renderer.name } }
    : { renderer: null, outcome: { kind: 'not-a-renderer' } };
}

/**
 * Every TV on the Wi-Fi that can play a URL (DLNA MediaRenderer with AVTransport),
 * plus a report of what the search saw. With `host` (an IPv4 the user typed) only
 * that device is asked, through a unicast M-SEARCH; its replies follow the same rules.
 */
export async function discoverRenderers(options: { timeoutMs?: number; host?: string } = {}): Promise<Discovery> {
  if (!TvCast) throw new Error('Esta versión de la app no puede buscar televisores.');
  const timeoutMs = options.timeoutMs ?? 3000;
  const target = options.host == null ? null : parseIpv4(options.host);
  if (options.host != null && !target) throw new Error(INVALID_IP_MESSAGE);

  let packets: SsdpPacket[];
  let report: Omit<DiscoveryReport, 'responses' | 'notifies' | 'locations'>;
  if (TvCast.ssdpSearchAsync) {
    const result = await TvCast.ssdpSearchAsync(timeoutMs, target);
    packets = result.packets;
    report = {
      mode: target ? 'unicast' : 'multicast',
      target: target ?? undefined,
      network: {
        interfaceName: result.interfaceName,
        localAddress: result.localAddress,
        listening: target ? undefined : result.listening,
        error: result.sendError,
      },
    };
  } else {
    // APKs built before ssdpSearchAsync: plain multicast search, no unicast.
    if (target) throw new Error('Esta versión de la app no puede buscar por IP. Instalá la última versión.');
    packets = await TvCast.discoverAsync(timeoutMs);
    report = { mode: 'multicast', legacy: true };
  }

  const summary = summarizeSsdp(packets);
  const inspected = await Promise.all(summary.candidates.map(inspect));
  const unique = new Map<string, Renderer>();
  for (const { renderer } of inspected) if (renderer) unique.set(renderer.controlUrl, renderer);
  return {
    renderers: [...unique.values()],
    report: {
      ...report,
      responses: summary.responses,
      notifies: summary.notifies,
      locations: summary.candidates.map((candidate, index) => ({
        location: candidate.location,
        sender: candidate.sender,
        outcome: inspected[index].outcome,
      })),
    },
  };
}

async function soap(
  renderer: Renderer,
  action: string,
  args: Record<string, string> = {},
  service: 'av' | 'rendering' = 'av',
): Promise<string> {
  const serviceType = service === 'av' ? AV_TRANSPORT : RENDERING_CONTROL;
  const url = service === 'av' ? renderer.controlUrl : renderer.renderingControlUrl;
  if (!url) throw new Error('Esta tele no deja cambiar el volumen desde el teléfono.');
  // Generous: loading an HLS URI can take the TV several seconds before it answers.
  const response = await fetchText(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset="utf-8"',
        SOAPACTION: `"${serviceType}#${action}"`,
      },
      body: buildSoapEnvelope(action, { InstanceID: '0', ...args }, serviceType),
    },
    10_000,
  );
  const { text } = response;
  if (!response.ok) {
    const code = /<errorCode>(\d+)<\/errorCode>/.exec(text)?.[1];
    const description = /<errorDescription>([^<]*)<\/errorDescription>/.exec(text)?.[1];
    throw new Error(`${action} falló (HTTP ${response.status}${code ? `, UPnP ${code}` : ''}${description ? `: ${description}` : ''})`);
  }
  return text;
}

/** Load the URL on the TV and start playing it; the TV downloads the video itself. */
export async function castUrl(renderer: Renderer, url: string, title: string): Promise<void> {
  await soap(renderer, 'Stop').catch(() => undefined); // Some TVs refuse a new URI while playing.
  await soap(renderer, 'SetAVTransportURI', { CurrentURI: url, CurrentURIMetaData: buildDidlLite(url, title) });
  await soap(renderer, 'Play', { Speed: '1' });
}

export const play = (renderer: Renderer) => soap(renderer, 'Play', { Speed: '1' }).then(() => undefined);
export const pause = (renderer: Renderer) => soap(renderer, 'Pause').then(() => undefined);
export const stop = (renderer: Renderer) => soap(renderer, 'Stop').then(() => undefined);

/** Current position and duration in seconds (null when the TV does not know yet). */
export async function positionInfo(renderer: Renderer) {
  return parsePositionInfo(await soap(renderer, 'GetPositionInfo'));
}

/** Jump to `seconds` from the start of the video. */
export const seek = (renderer: Renderer, seconds: number) =>
  soap(renderer, 'Seek', { Unit: 'REL_TIME', Target: formatHms(seconds) }).then(() => undefined);

/** TV volume 0-100, or null when the answer is unreadable. Needs `renderingControlUrl`. */
export async function getVolume(renderer: Renderer): Promise<number | null> {
  return parseVolume(await soap(renderer, 'GetVolume', { Channel: 'Master' }, 'rendering'));
}

export const setVolume = (renderer: Renderer, level: number) =>
  soap(
    renderer,
    'SetVolume',
    { Channel: 'Master', DesiredVolume: String(Math.min(100, Math.max(0, Math.round(level)))) },
    'rendering',
  ).then(() => undefined);

export async function getMute(renderer: Renderer): Promise<boolean | null> {
  return parseMute(await soap(renderer, 'GetMute', { Channel: 'Master' }, 'rendering'));
}

export const setMute = (renderer: Renderer, muted: boolean) =>
  soap(renderer, 'SetMute', { Channel: 'Master', DesiredMute: muted ? '1' : '0' }, 'rendering').then(() => undefined);

/** PLAYING, PAUSED_PLAYBACK, STOPPED, TRANSITIONING or NO_MEDIA_PRESENT. */
export async function transportState(renderer: Renderer): Promise<string> {
  const text = await soap(renderer, 'GetTransportInfo');
  return /<CurrentTransportState>([^<]*)</.exec(text)?.[1] ?? 'DESCONOCIDO';
}
