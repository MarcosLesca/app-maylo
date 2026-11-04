type SwappableKeys = {
  accent: string;
  onAccent: string;
  accentText: string;
  accentSoft: string;
  success: string;
  onSuccess: string;
  /** Readable label color on top of the green fill (used when green is the accent). */
  onSuccessLabel: string;
  successText: string;
  successSoft: string;
};

/**
 * Each member sees the app in their own color:
 *  - mustache (him): orange accent, green for done/paid
 *  - dumbbell (her): green accent, orange for done/paid
 * Signed out (login screen) uses the default palette.
 */
export function paletteFor<P extends SwappableKeys>(palette: P, avatar: 'mustache' | 'dumbbell' | null): P {
  if (avatar !== 'dumbbell') return palette;
  return {
    ...palette,
    accent: palette.success,
    onAccent: palette.onSuccessLabel,
    accentText: palette.successText,
    accentSoft: palette.successSoft,
    success: palette.accent,
    onSuccess: palette.onAccent,
    successText: palette.accentText,
    successSoft: palette.accentSoft,
  };
}
