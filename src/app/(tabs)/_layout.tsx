import { Tabs } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { Dumbbell, Mustache } from '@/components/brand';
import { Icon, type IconName } from '@/components/icon';
import { useAuth } from '@/features/auth/auth-provider';
import { useDeliveryReceipts } from '@/features/messages/use-delivery-receipts';
import { unregisterPushToken, usePushNotifications } from '@/features/notifications/push';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';
import { showDialog } from '@/components/dialog';

const tabIcon = (name: IconName) =>
  function TabIcon({ focused }: { focused: boolean }) {
    const theme = useTheme();
    return <Icon name={name} color={focused ? theme.accentText : theme.textSecondary} size={22} />;
  };

function SignOutButton() {
  const theme = useTheme();
  const confirm = () =>
    showDialog('¿Cerrar sesión?', undefined, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Cerrar sesión',
        style: 'destructive',
        onPress: async () => {
          // Stop pushes to this phone before the session (and its RLS access) ends.
          await unregisterPushToken().catch(() => undefined);
          await supabase.auth.signOut();
        },
      },
    ]);
  return (
    <Pressable onPress={confirm} hitSlop={12} style={{ paddingHorizontal: 16 }}>
      <Text style={{ color: theme.accentText, fontWeight: '600' }}>Salir</Text>
    </Pressable>
  );
}

/** Top-left mark of whoever is signed in: mustache for him, dumbbell for her. */
function HeaderMark() {
  const { member } = useAuth();
  return (
    <View style={{ paddingHorizontal: 16 }}>
      {member?.avatar === 'dumbbell' ? (
        <Dumbbell size={34} />
      ) : (
        <Mustache size={34} />
      )}
    </View>
  );
}

export default function TabsLayout() {
  const theme = useTheme();
  const { session } = useAuth();
  usePushNotifications(session?.user.id);
  useDeliveryReceipts(session?.user.id);
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
      <Tabs.Screen name="index" options={{ title: 'Pagos', tabBarIcon: tabIcon('cash') }} />
      <Tabs.Screen
        name="messages"
        options={{ title: 'Mensajes', tabBarIcon: tabIcon('chat'), tabBarHideOnKeyboard: true }}
      />
      <Tabs.Screen name="tasks" options={{ title: 'Tareas', tabBarIcon: tabIcon('checklist') }} />
      <Tabs.Screen name="shopping" options={{ title: 'Compras', tabBarIcon: tabIcon('cart') }} />
      <Tabs.Screen name="anniversary" options={{ title: 'Aniversario', tabBarIcon: tabIcon('heart') }} />
      <Tabs.Screen name="bulk" options={{ title: 'Bulk', tabBarIcon: tabIcon('activity') }} />
    </Tabs>
  );
}
