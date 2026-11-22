import TvCast from '../../../modules/tv-cast';
import {
  AV_TRANSPORT,
  buildDidlLite,
  buildSoapEnvelope,
  describeDevice,
  type DiscoveryReport,
  type FollowUp,
  followUpHosts,
  type LocationCandidate,
  type LocationOutcome,
  type LocationReport,
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
  const info = describeDevice(response.text);
  return renderer
    ? { renderer, outcome: { kind: 'ok', name: renderer.name, info } }
    : { renderer: null, outcome: { kind: 'not-a-renderer', info } };
}

type Inspection = Awaited<ReturnType<typeof inspect>>;

/** Window of each unicast follow-up to a sender that gave no renderer. */
const FOLLOW_UP_MS = 2000;

/**
 * Every TV on the Wi-Fi that can play a URL (DLNA MediaRenderer with AVTransport),
 * plus a report of what the search saw. With `host` (an IPv4 the user typed) only
 * that device is asked, through a unicast M-SEARCH; its replies follow the same rules.
 */
export async function discoverRenderers(options: { timeoutMs?: number; host?: string } = {}): Promise<Discovery> {
  if (!TvCast) throw new Error('Esta versión de la app no puede buscar televisores.');
  const timeoutMs = options.timeoutMs ?? 5000;
  const target = options.host == null ? null : parseIpv4(options.host);
  if (options.host != null && !target) throw new Error(INVALID_IP_MESSAGE);

  const native = TvCast;
  let packets: SsdpPacket[];
  let localAddress = '';
  let report: Omit<DiscoveryReport, 'responses' | 'notifies' | 'locations'>;
  if (native.ssdpSearchAsync) {
    const result = await native.ssdpSearchAsync(timeoutMs, target);
    packets = result.packets;
    localAddress = result.localAddress;
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

  // Each description is read once, also when a follow-up repeats its Location.
  const inspections = new Map<string, Promise<Inspection>>();
  const inspectAll = async (candidates: LocationCandidate[]) => {
    const inspected = await Promise.all(
      candidates.map((candidate) => {
        const key = `${candidate.hostMatches}|${candidate.location}`;
        let pending = inspections.get(key);
        if (!pending) {
          pending = inspect(candidate);
          inspections.set(key, pending);
        }
        return pending;
      }),
    );
    return candidates.map(
      (candidate, index): LocationReport & Inspection => ({
        location: candidate.location,
        sender: candidate.sender,
        ...inspected[index],
      }),
    );
  };

  const multicast = summarizeSsdp(packets);
  let summary = multicast;
  let inspected = await inspectAll(summary.candidates);
  const followUps: FollowUp[] = [];
  const search = native.ssdpSearchAsync;
  if (!target && search) {
    // A sender that answered only for DIAL/other services may still answer a direct M-SEARCH (S8 d).
    const hosts = followUpHosts(summary.senders, inspected, [localAddress]).filter((host) => parseIpv4(host) === host);
    const results = await Promise.all(
      hosts.map(async (host): Promise<{ host: string; packets: SsdpPacket[]; error?: string }> => {
        try {
          return { host, packets: (await search.call(native, FOLLOW_UP_MS, host)).packets };
        } catch (error) {
          return { host, packets: [], error: error instanceof Error ? error.message : String(error) };
        }
      }),
    );
    for (const { host, packets: replies, error } of results) {
      followUps.push({ host, responses: summarizeSsdp(replies).responses, ...(error ? { error } : {}) });
    }
    if (results.some((result) => result.packets.length)) {
      summary = summarizeSsdp([...packets, ...results.flatMap((result) => result.packets)]);
      inspected = await inspectAll(summary.candidates);
    }
  }

  const unique = new Map<string, Renderer>();
  for (const { renderer } of inspected) if (renderer) unique.set(renderer.controlUrl, renderer);
  return {
    renderers: [...unique.values()],
    report: {
      ...report,
      // The headline counts are the multicast search's; follow-ups report their own.
      responses: multicast.responses,
      notifies: multicast.notifies,
      senders: summary.senders,
      locations: inspected.map(({ location, sender, outcome }) => ({ location, sender, outcome })),
      ...(followUps.length ? { followUps } : {}),
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
