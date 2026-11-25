// Runs even when the app is closed: Android wakes this JS for "headless"
// (data-only) pushes. Chat messages arrive this way so the phone can mark them
// delivered before anyone opens the app, and then show the notification itself.
// Reactions arrive this way too; with the app open the overlay shows them, so
// the notification is only posted when the app is not in the foreground.
// Imported from index.ts so the task exists before the app (or a headless launch) starts.

import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { AppState } from 'react-native';

import { supabase } from '@/lib/supabase';

import { CHANNEL_ID, ensureNotificationChannel } from './channel';
import { parseHeadlessPayload } from './headless-payload';
import { shouldShowHeadlessNotification } from './presentation';

export const BACKGROUND_NOTIFICATION_TASK = 'maylo-background-notification';

TaskManager.defineTask(BACKGROUND_NOTIFICATION_TASK, async ({ data, error }) => {
  if (error) return;
  const payload = parseHeadlessPayload(data);
  if (!payload) return;

  if (payload.kind === 'reaction') {
    if (!shouldShowHeadlessNotification('reaction', AppState.currentState)) return;
    await ensureNotificationChannel().catch(() => undefined);
    await Notifications.scheduleNotificationAsync({
      // kind lets the foreground handler hide it if the app opens before it is shown.
      content: { title: payload.title, body: payload.body, data: { kind: 'reaction' }, sound: 'default' },
      trigger: { channelId: CHANNEL_ID },
    }).catch(() => undefined);
    return;
  }

  await ensureNotificationChannel().catch(() => undefined);
  // Show the notification and stamp delivery independently: one failing must not block the other.
  await Promise.allSettled([
    Notifications.scheduleNotificationAsync({
      content: { title: payload.title, body: payload.body, data: { url: payload.url }, sound: 'default' },
      trigger: { channelId: CHANNEL_ID },
    }),
    supabase.rpc('mark_messages_delivered'),
  ]);
});

Notifications.registerTaskAsync(BACKGROUND_NOTIFICATION_TASK).catch(() => undefined);
