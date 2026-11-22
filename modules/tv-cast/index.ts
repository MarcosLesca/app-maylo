import { NativeModule, requireOptionalNativeModule } from 'expo';

export type SsdpReply = { address: string; response: string };

declare class TvCastModule extends NativeModule {
  discoverAsync(timeoutMs: number): Promise<SsdpReply[]>;
}

/**
 * Null on iOS, web, and on APKs built before this module existed (an OTA update
 * can reach them), so callers must handle its absence instead of crashing.
 */
export default requireOptionalNativeModule<TvCastModule>('TvCast');
