import { Tabs } from 'expo-router';
import { Alert, Pressable, Text } from 'react-native';

import { Accent } from '@/components/ui';
import { supabase } from '@/lib/supabase';

const icon = (emoji: string) =>
  function TabIcon({ focused }: { focused: boolean }) {
    return <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.5 }}>{emoji}</Text>;
  };

function SignOutButton() {
  const confirm = () =>
    Alert.alert('¿Cerrar sesión?', undefined, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Cerrar sesión', style: 'destructive', onPress: () => supabase.auth.signOut() },
    ]);
  return (
    <Pressable onPress={confirm} hitSlop={12} style={{ paddingHorizontal: 16 }}>
      <Text style={{ color: Accent, fontWeight: '600' }}>Salir</Text>
    </Pressable>
  );
}

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: Accent, headerRight: () => <SignOutButton /> }}>
      <Tabs.Screen name="index" options={{ title: 'Pagos', tabBarIcon: icon('💸') }} />
      <Tabs.Screen name="tasks" options={{ title: 'Tareas', tabBarIcon: icon('✅') }} />
      <Tabs.Screen name="shopping" options={{ title: 'Compras', tabBarIcon: icon('🛒') }} />
      <Tabs.Screen name="anniversary" options={{ title: 'Aniversario', tabBarIcon: icon('💞') }} />
    </Tabs>
  );
}
