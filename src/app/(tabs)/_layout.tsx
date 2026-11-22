import { router, Tabs } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { Dumbbell, Mustache } from '@/components/brand';
import { Icon, type IconName } from '@/components/icon';
import { useAuth } from '@/features/auth/auth-provider';
import { castSupported } from '@/features/cast/dlna-client';
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

function HeaderActions() {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {/* Hidden on APKs built before the native cast module (an OTA update can reach them). */}
      {castSupported ? (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Transmitir a la TV"
        onPress={() => router.push('/cast')}
        hitSlop={12}
        style={{ paddingLeft: 16 }}>
        <Icon name="tv" color={theme.accentText} size={22} />
      </Pressable>
      ) : null}
      <SignOutButton />
    </View>
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
        headerRight: () => <HeaderActions />,
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
