import { NativeModule, requireOptionalNativeModule } from 'expo';

/** `kind` is missing on APKs that predate ssdpSearchAsync (they only return search replies). */
export type SsdpReply = { address: string; response: string; kind?: 'response' | 'notify' };

/** One SSDP search and the Wi-Fi link it used; empty strings when the Wi-Fi was not found. */
export type SsdpSearchResult = {
  packets: SsdpReply[];
  interfaceName: string;
  localAddress: string;
  /** True when Android reported a Wi-Fi network; the search socket is bound to it when the OS allows. */
  wifiNetwork: boolean;
  /** True when the passive NOTIFY listener got port 1900 (multicast searches only). */
  listening: boolean;
  /** Last error sending an M-SEARCH, when any. */
  sendError?: string;
};

/** `baseUrl` is `http://<phone Wi-Fi IP>:<port>`; videos are served under `/s/<sessionId>/...`. */
export type ProxySession = { baseUrl: string; sessionId: string };

/** Where the TV browser receiver is served: `url` is `http://<address>:<port>/tv/<key>`. */
export type ReceiverInfo = { url: string; port: number; address: string };

/** What the receiver page last reported. */
export type ReceiverState = {
  /** True when the page posted its state within the last 5 s. */
  connected: boolean;
  /** IPv4 of the TV that posted it; '' before the first state. */
  address: string;
  /** Epoch ms of the last state; 0 before the first one. */
  lastSeenMs: number;
  /** The last JSON body the page posted; '' before the first one. */
  state: string;
};

/**
 * What the background media session shows (S5). `subtitle` is who sent the video;
 * `positionMs`/`durationMs` are whole milliseconds, omitted when unknown.
 */
export type MediaSessionState = {
  title?: string;
  subtitle?: string;
  playing?: boolean;
  positionMs?: number;
  durationMs?: number;
};

/**
 * A control pressed outside the app: notification, lock screen, headset, or the phone's
 * volume buttons (`volume`, `direction` 1 up / -1 down). `seekBy` carries `seconds`
 * (±10 from the buttons, any delta from the system seek bar).
 */
export type MediaActionEvent = {
  action: 'play' | 'pause' | 'seekBy' | 'stop' | 'volume';
  seconds?: number;
  direction?: 1 | -1;
};

type TvCastEvents = {
  onMediaAction(event: MediaActionEvent): void;
};

declare class TvCastModule extends NativeModule<TvCastEvents> {
  discoverAsync(timeoutMs: number): Promise<SsdpReply[]>;
  /**
   * Multicast M-SEARCH through the Wi-Fi network plus the NOTIFYs heard meanwhile,
   * or a unicast M-SEARCH to `host`:1900 (an IPv4) when given. Missing on older APKs.
   */
  ssdpSearchAsync?(timeoutMs: number, host: string | null): Promise<SsdpSearchResult>;
  /**
   * New cast session for `target` with the page headers; it revokes the previous
   * one and serves only `target`, the exact `extraTargets` (at most 4, http(s);
   * e.g. a YouTube video's audio) and the URIs of the playlists it rewrites.
   * ERR_BAD_TARGET for anything else. Missing on APKs built before the proxy
   * existed; APKs built before extraTargets reject a third argument.
   */
  startProxyAsync?(headers: Record<string, string>, target: string, extraTargets?: string[]): Promise<ProxySession>;
  /** Revokes the cast session; the server keeps running while the receiver is started. */
  stopProxyAsync?(): Promise<void>;
  /**
   * Starts the server if needed (port 8765, else the next free one up to 8775)
   * and serves `html` at `GET /tv/<key>` and the vendored hls.js at
   * `GET /tv/<key>/hls.js`. `key` is 6 ASCII letters/digits (ERR_BAD_KEY otherwise);
   * ERR_NO_WIFI / ERR_NO_PORT when it cannot listen. Calling it again replaces `html`.
   * Every `/tv` and `/s` response answers CORS (`Access-Control-Allow-Origin: *`) and
   * OPTIONS there is a 204 preflight, so the page served by the other member's phone
   * can use this one (APKs from 1.6.0). Missing on older APKs.
   */
  startReceiverAsync?(key: string, html: string): Promise<ReceiverInfo>;
  /**
   * Queues `command` (a JSON object text) for `GET /tv/<key>/commands?after=<id>`,
   * which answers `{"commands":[{"id":n, ...command}]}` (the last 50, ids increasing).
   * ERR_BAD_COMMAND when not a JSON object, ERR_RECEIVER_STOPPED when not started.
   */
  pushReceiverCommandAsync?(command: string): Promise<void>;
  getReceiverStateAsync?(): Promise<ReceiverState>;
  /** Stops the receiver (pending commands and state are dropped), and the server when no cast session is active. */
  stopReceiverAsync?(): Promise<void>;
  /**
   * Runs `script` at document start in every frame (iframes included) of the
   * WebView whose native view tag is `viewTag` (findNodeHandle of a view that
   * contains it). False when unsupported; missing on older APKs.
   */
  addDocumentStartScriptAsync?(viewTag: number, script: string): Promise<boolean>;
  /**
   * Starts (or restarts with `state`) the media-playback foreground service: a media
   * notification visible on the lock screen (−10 s, play/pause, +10 s, stop), a partial
   * wake lock and a Wi-Fi lock so the proxy keeps serving with the screen off, and remote
   * volume so the volume buttons send `onMediaAction` `volume`. ERR_FGS_NOT_ALLOWED when
   * Android refuses to start it (app in background). Missing on APKs built before it existed.
   */
  startMediaSession?(state: MediaSessionState): Promise<void>;
  /** Merges `state` into the shown one; ignored when the session is not active. */
  updateMediaSession?(state: MediaSessionState): Promise<void>;
  /** Ends the session, removes the notification and releases the locks; idempotent. */
  stopMediaSession?(): Promise<void>;
}

/**
 * Null on iOS, web, and on APKs built before this module existed (an OTA update
 * can reach them), so callers must handle its absence instead of crashing.
 */
export default requireOptionalNativeModule<TvCastModule>('TvCast');
