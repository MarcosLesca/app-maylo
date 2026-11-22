import { NativeModule, requireOptionalNativeModule } from 'expo';

/** Blocked requests on the current page of the WebView under `viewTag`; 0 after a new top page. */
export type BlockedCountEvent = { viewTag: number; count: number };

type WebGuardEvents = {
  onBlockedCount: (event: BlockedCountEvent) => void;
};

declare class WebGuardModule extends NativeModule<WebGuardEvents> {
  /**
   * Starts answering ad/tracker requests (every frame, never the top page) of
   * the WebView under `viewTag` (findNodeHandle of a view that contains it) with
   * an empty response. False when unsupported (no WebView yet, Android < 8).
   */
  attachAsync(viewTag: number): Promise<boolean>;
  /** Turns blocking on/off for every guarded WebView (session switch). */
  setEnabled(enabled: boolean): void;
}

/**
 * Null on iOS, web, and on APKs built before this module existed (an OTA update
 * can reach them), so callers must handle its absence instead of crashing.
 */
export default requireOptionalNativeModule<WebGuardModule>('WebGuard');
