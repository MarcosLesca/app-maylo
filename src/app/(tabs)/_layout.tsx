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
    Alert.alert('Sign out?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => supabase.auth.signOut() },
    ]);
  return (
    <Pressable onPress={confirm} hitSlop={12} style={{ paddingHorizontal: 16 }}>
      <Text style={{ color: Accent, fontWeight: '600' }}>Sign out</Text>
    </Pressable>
  );
}

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: Accent, headerRight: () => <SignOutButton /> }}>
      <Tabs.Screen name="index" options={{ title: 'Bills', tabBarIcon: icon('💸') }} />
      <Tabs.Screen name="tasks" options={{ title: 'Tasks', tabBarIcon: icon('✅') }} />
      <Tabs.Screen name="shopping" options={{ title: 'Shopping', tabBarIcon: icon('🛒') }} />
      <Tabs.Screen name="anniversary" options={{ title: 'Anniversary', tabBarIcon: icon('💞') }} />
    </Tabs>
  );
}
