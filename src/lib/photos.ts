import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

export type PhotoSource = 'camera' | 'gallery';

export type Photo = {
  uri: string;
  width: number;
  height: number;
  mimeType: 'image/jpeg';
  extension: 'jpg';
};

const MAX_IMAGE_WIDTH = 1600;
const JPEG_QUALITY = 0.6;

/** Shrinks photos to ~200 KB so 1 GB of free storage lasts for years. */
async function compressPhoto(uri: string): Promise<Photo> {
  const context = ImageManipulator.manipulate(uri);
  context.resize({ width: MAX_IMAGE_WIDTH, height: null });
  const image = await context.renderAsync();
  const result = await image.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY });
  return { uri: result.uri, width: result.width, height: result.height, mimeType: 'image/jpeg', extension: 'jpg' };
}

/** Takes or picks a photo and compresses it. Resolves to null when the user cancels. */
export async function pickPhoto(source: PhotoSource): Promise<Photo | null> {
  const photos = await pickPhotos(source, false);
  return photos[0] ?? null;
}

/**
 * Takes one photo, or picks one or more from the gallery when `multiple` is set,
 * and compresses them in selection order. Resolves to [] when the user cancels.
 */
export async function pickPhotos(source: PhotoSource, multiple: boolean): Promise<Photo[]> {
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new Error('Se denegó el permiso de cámara.');
  }

  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1 };
  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync({
          ...options,
          allowsMultipleSelection: multiple,
          orderedSelection: multiple,
        });
  if (result.canceled) return [];
  const photos: Photo[] = [];
  for (const asset of result.assets) photos.push(await compressPhoto(asset.uri));
  return photos;
}

export function randomId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
