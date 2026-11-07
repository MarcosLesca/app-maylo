// Downloads a new APK inside the app and opens Android's installer, so updating
// does not need a browser. Android still asks the user to confirm the install
// (and, the first time, to allow MayLo to install apps).

import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';

type DownloadState = { version: string; written: number; expected: number } | null;

// Tiny store so the progress UI can follow the download (useSyncExternalStore).
let state: DownloadState = null;
const listeners = new Set<() => void>();

function setState(next: DownloadState) {
  state = next;
  listeners.forEach((listener) => listener());
}

export const downloadStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  get: () => state,
};

const FLAG_GRANT_READ_URI_PERMISSION = 1;

/** Downloads the APK with progress and launches the installer. Throws on failure. */
export async function downloadAndInstall(url: string, version: string) {
  if (state) return; // already downloading
  const target = `${FileSystem.cacheDirectory}maylo-${version}.apk`;
  setState({ version, written: 0, expected: -1 });

  try {
    await FileSystem.deleteAsync(target, { idempotent: true });
    const download = FileSystem.createDownloadResumable(url, target, {}, (progress) =>
      setState({
        version,
        written: progress.totalBytesWritten,
        expected: progress.totalBytesExpectedToWrite,
      }),
    );
    const result = await download.downloadAsync();
    if (!result || result.status !== 200) throw new Error(`La descarga falló (${result?.status ?? 'sin respuesta'})`);

    // The installer needs a content:// URI it is allowed to read.
    const contentUri = await FileSystem.getContentUriAsync(result.uri);
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      data: contentUri,
      type: 'application/vnd.android.package-archive',
      flags: FLAG_GRANT_READ_URI_PERMISSION,
    });
  } finally {
    setState(null);
  }
}
