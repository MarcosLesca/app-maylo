import { Tabs } from 'expo-router';
import { Alert, Pressable, Text, View } from 'react-native';

import { Dumbbell, Mustache } from '@/components/brand';
import { useAuth } from '@/features/auth/auth-provider';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';

const icon = (emoji: string) =>
  function TabIcon({ focused }: { focused: boolean }) {
    return <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.5 }}>{emoji}</Text>;
  };

function SignOutButton() {
  const theme = useTheme();
  const confirm = () =>
    Alert.alert('¿Cerrar sesión?', undefined, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Cerrar sesión', style: 'destructive', onPress: () => supabase.auth.signOut() },
    ]);
  return (
    <Pressable onPress={confirm} hitSlop={12} style={{ paddingHorizontal: 16 }}>
      <Text style={{ color: theme.accentText, fontWeight: '600' }}>Salir</Text>
    </Pressable>
  );
}

/** Top-left mark of whoever is signed in: mustache for him, dumbbell for her. */
function HeaderMark() {
  const theme = useTheme();
  const { member } = useAuth();
  return (
    <View style={{ paddingHorizontal: 16 }}>
      {member?.avatar === 'dumbbell' ? (
        <Dumbbell size={34} color={theme.success} />
      ) : (
        <Mustache size={34} color={theme.accent} />
      )}
    </View>
  );
}

export default function TabsLayout() {
  const theme = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: theme.background },
        headerTintColor: theme.text,
        headerShadowVisible: false,
        headerLeft: () => <HeaderMark />,
        headerRight: () => <SignOutButton />,
        tabBarActiveTintColor: theme.accentText,
        tabBarInactiveTintColor: theme.textSecondary,
        tabBarStyle: { backgroundColor: theme.background, borderTopColor: theme.backgroundSelected },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Pagos', tabBarIcon: icon('💸') }} />
      <Tabs.Screen name="tasks" options={{ title: 'Tareas', tabBarIcon: icon('✅') }} />
      <Tabs.Screen name="shopping" options={{ title: 'Compras', tabBarIcon: icon('🛒') }} />
      <Tabs.Screen name="anniversary" options={{ title: 'Aniversario', tabBarIcon: icon('💞') }} />
    </Tabs>
  );
}
