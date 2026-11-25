// Pure presentation rules for pushes (no React Native imports, so node:test runs them).

export type HeadlessKind = 'message' | 'reaction';

/** App state as reported by React Native's AppState (null/unknown in a headless launch). */
export type AppStateLike = string | null | undefined;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/**
 * Pushes the in-app overlay already shows while the app is open: reactions.
 * The foreground handler hides their banner instead of showing them twice.
 */
export function isOverlayOnly(data: unknown): boolean {
  return isRecord(data) && data.kind === 'reaction';
}

/**
 * Whether the background task should post a local notification. It also runs
 * with the app open: chat messages keep notifying as before, reactions only
 * when the app is not in the foreground (the overlay covers the open app).
 */
export function shouldShowHeadlessNotification(kind: HeadlessKind, appState: AppStateLike): boolean {
  if (kind === 'reaction') return appState !== 'active';
  return true;
}
