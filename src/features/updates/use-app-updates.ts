import * as Application from 'expo-application';
import * as Updates from 'expo-updates';
import { useEffect } from 'react';
import { Linking, Platform } from 'react-native';

import { showDialog } from '@/components/dialog';
import { errorMessage } from '@/lib/use-query';

import { downloadAndInstall } from './apk-installer';
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
  showDialog('Actualización lista', 'Se descargó una nueva versión. ¿Reiniciar ahora?', [
    { text: 'Más tarde', style: 'cancel' },
    { text: 'Reiniciar', onPress: () => Updates.reloadAsync() },
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

  showDialog(
    'Nueva versión de la app',
    `Está disponible la versión ${release.tag_name} (instalada: ${installed}). ¿Descargarla e instalarla?`,
    [
      { text: 'Más tarde', style: 'cancel' },
      { text: 'Actualizar', onPress: () => installApk(apk.browser_download_url, release.tag_name) },
    ],
  );
}

/** Downloads and installs inside the app; offers the browser only if that fails. */
async function installApk(url: string, tag: string) {
  try {
    await downloadAndInstall(url, tag.replace(/^v/i, ''));
  } catch (error) {
    showDialog('No se pudo actualizar desde la app', errorMessage(error), [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Abrir en el navegador', onPress: () => Linking.openURL(url) },
    ]);
  }
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
