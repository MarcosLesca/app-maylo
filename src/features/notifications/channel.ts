import { AndroidImportance, setNotificationChannelAsync } from 'expo-notifications';
import { Platform } from 'react-native';

/** Must match the channelId the database sends ('default'). Safe to call repeatedly. */
export const CHANNEL_ID = 'default';

export async function ensureNotificationChannel() {
  if (Platform.OS !== 'android') return;
  await setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Novedades',
    importance: AndroidImportance.HIGH,
    vibrationPattern: [0, 200, 100, 200],
    lightColor: '#F26B3A',
  });
}
