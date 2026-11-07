import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { DialogHost } from '@/components/dialog';
import { AuthProvider, useAuth } from '@/features/auth/auth-provider';
import { UpdateProgress } from '@/features/updates/update-progress';
import { useAppUpdates } from '@/features/updates/use-app-updates';
import { useTheme } from '@/hooks/use-theme';

SplashScreen.preventAutoHideAsync();

function RootNavigator() {
  const { session, loading } = useAuth();
  useAppUpdates();

  useEffect(() => {
    if (!loading) SplashScreen.hideAsync();
  }, [loading]);

  if (loading) return null;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={session != null}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="bills" options={{ headerShown: true, title: 'Gastos fijos', presentation: 'modal' }} />
        <Stack.Screen name="receipt" options={{ headerShown: true, title: 'Comprobante', presentation: 'modal' }} />
      </Stack.Protected>
      <Stack.Protected guard={session == null}>
        <Stack.Screen name="login" />
      </Stack.Protected>
    </Stack>
  );
}

/** Navigation colors follow the signed-in member's palette, so it lives inside AuthProvider. */
function ThemedNavigation() {
  const isDark = useColorScheme() === 'dark';
  const base = isDark ? DarkTheme : DefaultTheme;
  const colors = useTheme();
  const navigationTheme = {
    ...base,
    colors: {
      ...base.colors,
      primary: colors.accent,
      background: colors.background,
      card: colors.background,
      text: colors.text,
      border: colors.backgroundSelected,
    },
  };

  return (
    <ThemeProvider value={navigationTheme}>
      <RootNavigator />
      <DialogHost />
      <UpdateProgress />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <ThemedNavigation />
    </AuthProvider>
  );
}
