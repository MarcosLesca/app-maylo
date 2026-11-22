import { NativeModule, requireOptionalNativeModule } from 'expo';

export type SsdpReply = { address: string; response: string };

/** `baseUrl` is `http://<phone Wi-Fi IP>:<port>`; videos are served under `/s/<sessionId>/...`. */
export type ProxySession = { baseUrl: string; sessionId: string };

declare class TvCastModule extends NativeModule {
  discoverAsync(timeoutMs: number): Promise<SsdpReply[]>;
  /** Missing on APKs built before the proxy existed. */
  startProxyAsync?(headers: Record<string, string>): Promise<ProxySession>;
  stopProxyAsync?(): Promise<void>;
}

/**
 * Null on iOS, web, and on APKs built before this module existed (an OTA update
 * can reach them), so callers must handle its absence instead of crashing.
 */
export default requireOptionalNativeModule<TvCastModule>('TvCast');
