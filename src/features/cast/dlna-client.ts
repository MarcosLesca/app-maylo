import TvCast from '../../../modules/tv-cast';
import {
  AV_TRANSPORT,
  buildDidlLite,
  buildSoapEnvelope,
  parseDeviceDescription,
  parseMute,
  parseVolume,
  RENDERING_CONTROL,
  rendererLocations,
  type Renderer,
} from './dlna';
import { formatHms, parsePositionInfo } from './time';

export type { Renderer } from './dlna';

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

/** Every TV on the Wi-Fi that can play a URL (DLNA MediaRenderer with AVTransport). */
export async function discoverRenderers(timeoutMs = 3000): Promise<Renderer[]> {
  if (!TvCast) throw new Error('Esta versión de la app no puede buscar televisores.');
  const replies = await TvCast.discoverAsync(timeoutMs);
  const found = await Promise.all(
    rendererLocations(replies).map(async (location) => {
      try {
        const response = await fetchText(location);
        return response.ok ? parseDeviceDescription(response.text, location) : null;
      } catch {
        return null;
      }
    }),
  );
  const unique = new Map<string, Renderer>();
  for (const renderer of found) if (renderer) unique.set(renderer.controlUrl, renderer);
  return [...unique.values()];
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
