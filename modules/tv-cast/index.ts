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

declare class TvCastModule extends NativeModule {
  discoverAsync(timeoutMs: number): Promise<SsdpReply[]>;
  /**
   * Multicast M-SEARCH through the Wi-Fi network plus the NOTIFYs heard meanwhile,
   * or a unicast M-SEARCH to `host`:1900 (an IPv4) when given. Missing on older APKs.
   */
  ssdpSearchAsync?(timeoutMs: number, host: string | null): Promise<SsdpSearchResult>;
  /**
   * New cast session for `target` with the page headers; it revokes the previous
   * one and serves only `target` and the URIs of the playlists it rewrites.
   * Missing on APKs built before the proxy existed.
   */
  startProxyAsync?(headers: Record<string, string>, target: string): Promise<ProxySession>;
  /** Revokes the cast session; the server keeps running while the receiver is started. */
  stopProxyAsync?(): Promise<void>;
  /**
   * Starts the server if needed (port 8765, else the next free one up to 8775)
   * and serves `html` at `GET /tv/<key>` and the vendored hls.js at
   * `GET /tv/<key>/hls.js`. `key` is 6 ASCII letters/digits (ERR_BAD_KEY otherwise);
   * ERR_NO_WIFI / ERR_NO_PORT when it cannot listen. Missing on older APKs.
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
}

/**
 * Null on iOS, web, and on APKs built before this module existed (an OTA update
 * can reach them), so callers must handle its absence instead of crashing.
 */
export default requireOptionalNativeModule<TvCastModule>('TvCast');
