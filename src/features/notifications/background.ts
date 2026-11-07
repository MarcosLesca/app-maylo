// Runs even when the app is closed: Android wakes this JS for "headless"
// (data-only) pushes. Chat messages arrive this way so the phone can mark them
// delivered before anyone opens the app, and then show the notification itself.
// Imported from index.ts so the task exists before the app (or a headless launch) starts.

import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';

import { supabase } from '@/lib/supabase';

import { CHANNEL_ID, ensureNotificationChannel } from './channel';
import { parseHeadlessPayload } from './headless-payload';

export const BACKGROUND_NOTIFICATION_TASK = 'maylo-background-notification';

TaskManager.defineTask(BACKGROUND_NOTIFICATION_TASK, async ({ data, error }) => {
  if (error) return;
  const message = parseHeadlessPayload(data);
  if (!message) return;

  await ensureNotificationChannel().catch(() => undefined);
  // Show the notification and stamp delivery independently: one failing must not block the other.
  await Promise.allSettled([
    Notifications.scheduleNotificationAsync({
      content: { title: message.title, body: message.body, data: { url: message.url }, sound: 'default' },
      trigger: { channelId: CHANNEL_ID },
    }),
    supabase.rpc('mark_messages_delivered'),
  ]);
});

Notifications.registerTaskAsync(BACKGROUND_NOTIFICATION_TASK).catch(() => undefined);
