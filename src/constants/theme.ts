/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://unistyl.es/), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

/**
 * Palette: sunset orange (accent, actions) + grass green (done, paid).
 * "on*" colors are the readable foreground for text placed on that fill.
 * This is his palette; hers swaps accent and success (see lib/palette.ts).
 */
export const Colors = {
  light: {
    text: '#1F1A17',
    textSecondary: '#6B6058',
    background: '#FFF9F4',
    backgroundElement: '#F6EEE6',
    backgroundSelected: '#ECE1D6',
    accent: '#F26B3A',
    onAccent: '#2B1206',
    accentText: '#A23D14',
    accentSoft: '#FFE3D3',
    success: '#4E9F3D',
    onSuccess: '#FFFFFF',
    onSuccessLabel: '#0E1A0A',
    successText: '#2F6B22',
    successSoft: '#E3F2DC',
    danger: '#D64545',
    sunsetTop: '#FFB25B',
    sunsetBottom: '#F26B3A',
  },
  dark: {
    text: '#F7F1EC',
    textSecondary: '#B9ACA2',
    background: '#15110F',
    backgroundElement: '#221C18',
    backgroundSelected: '#2F2621',
    accent: '#FF8A57',
    onAccent: '#2B1206',
    accentText: '#FF9E72',
    accentSoft: '#3A2216',
    success: '#6CC24A',
    onSuccess: '#0E1A0A',
    onSuccessLabel: '#0E1A0A',
    successText: '#8FD86F',
    successSoft: '#1E2C18',
    danger: '#FF6B6B',
    sunsetTop: '#C9622E',
    sunsetBottom: '#7A2E1C',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
