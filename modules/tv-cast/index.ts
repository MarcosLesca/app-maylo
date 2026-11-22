import { NativeModule, requireOptionalNativeModule } from 'expo';

export type SsdpReply = { address: string; response: string };

/** `baseUrl` is `http://<phone Wi-Fi IP>:<port>`; videos are served under `/s/<sessionId>/...`. */
export type ProxySession = { baseUrl: string; sessionId: string };

declare class TvCastModule extends NativeModule {
  discoverAsync(timeoutMs: number): Promise<SsdpReply[]>;
  /**
   * New cast session for `target` with the page headers; it revokes the previous
   * one and serves only `target` and the URIs of the playlists it rewrites.
   * Missing on APKs built before the proxy existed.
   */
  startProxyAsync?(headers: Record<string, string>, target: string): Promise<ProxySession>;
  stopProxyAsync?(): Promise<void>;
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
