/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { Colors } from '@/constants/theme';
import { useAuth } from '@/features/auth/auth-provider';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { paletteFor } from '@/lib/palette';

/** Light/dark palette only, the same for everyone (brand marks, login). */
export function useBaseTheme() {
  const scheme = useColorScheme();
  return Colors[scheme === 'dark' ? 'dark' : 'light'];
}

/** The palette of whoever is signed in: orange accent for him, green for her. */
export function useTheme() {
  const base = useBaseTheme();
  const { member } = useAuth();
  return paletteFor(base, member?.avatar ?? null);
}
