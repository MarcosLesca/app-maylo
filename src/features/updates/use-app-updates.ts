import * as Application from 'expo-application';
import * as Updates from 'expo-updates';
import { useEffect } from 'react';
import { Alert, Linking, Platform } from 'react-native';

import { isNewerVersion } from './version';

const RELEASES_REPO = process.env.EXPO_PUBLIC_RELEASES_REPO; // "owner/repo", must be public

type GithubRelease = {
  tag_name: string;
  assets: { name: string; browser_download_url: string }[];
};

/**
 * Two update channels:
 *  1. JS/UI changes ship over the air with `eas update` and apply on the spot.
 *  2. Native changes need a new APK, published as a GitHub Release.
 *     The user still confirms the install (Android never installs silently).
 */
async function checkOverTheAir() {
  if (__DEV__ || !Updates.isEnabled) return;
  const result = await Updates.checkForUpdateAsync();
  if (!result.isAvailable) return;
  await Updates.fetchUpdateAsync();
  Alert.alert('Update ready', 'A new version was downloaded. Restart now?', [
    { text: 'Later', style: 'cancel' },
    { text: 'Restart', onPress: () => Updates.reloadAsync() },
  ]);
}

async function checkNewApk() {
  if (__DEV__ || Platform.OS !== 'android' || !RELEASES_REPO) return;
  const installed = Application.nativeApplicationVersion;
  if (!installed) return;

  const response = await fetch(`https://api.github.com/repos/${RELEASES_REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!response.ok) return;
  const release = (await response.json()) as GithubRelease;
  const apk = release.assets.find((a) => a.name.endsWith('.apk'));
  if (!apk || !isNewerVersion(release.tag_name, installed)) return;

  Alert.alert(
    'New app version',
    `Version ${release.tag_name} is available (you have ${installed}). Download and install it?`,
    [
      { text: 'Later', style: 'cancel' },
      { text: 'Download', onPress: () => Linking.openURL(apk.browser_download_url) },
    ],
  );
}

export function useAppUpdates() {
  useEffect(() => {
    // A new APK wins over an OTA update: OTA updates only target the installed runtime.
    checkNewApk()
      .then(checkOverTheAir)
      .catch(() => {
        // Update checks must never break the app (offline, rate limits, etc.).
      });
  }, []);
}
