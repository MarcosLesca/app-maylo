import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { router, type Href } from 'expo-router';
import { useEffect } from 'react';

import { supabase } from '@/lib/supabase';

import { ensureNotificationChannel } from './channel';

// Show pushes even while the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

let registeredToken: string | null = null;

async function getExpoPushToken(): Promise<string | null> {
  await ensureNotificationChannel();

  let { granted } = await Notifications.getPermissionsAsync();
  if (!granted) ({ granted } = await Notifications.requestPermissionsAsync());
  if (!granted) return null;

  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return null;
  const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
  return data;
}

/** Saves this device's token so the other member's actions notify it. */
async function registerPushToken(userId: string) {
  const token = await getExpoPushToken();
  if (!token) return;
  const { error } = await supabase
    .from('push_tokens')
    // headless: this build handles data-only message pushes in the background task.
    .upsert({ token, user_id: userId, headless: true, updated_at: new Date().toISOString() }, { onConflict: 'token' });
  if (!error) registeredToken = token;
}

/** Stops notifications to this device. Call before signing out. */
export async function unregisterPushToken() {
  if (!registeredToken) return;
  await supabase.from('push_tokens').delete().eq('token', registeredToken);
  registeredToken = null;
}

/**
 * Registers the device while signed in and opens the right tab when a
 * notification is tapped (also when the tap launched the app).
 */
export function usePushNotifications(userId: string | undefined) {
  const lastResponse = Notifications.useLastNotificationResponse();

  useEffect(() => {
    if (!userId) return;
    // Permission denied or no network: the app keeps working without pushes.
    registerPushToken(userId).catch(() => undefined);
  }, [userId]);

  useEffect(() => {
    if (!lastResponse || lastResponse.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const url = lastResponse.notification.request.content.data?.url;
    if (typeof url === 'string' && url.startsWith('/')) router.navigate(url as Href);
  }, [lastResponse]);
}
