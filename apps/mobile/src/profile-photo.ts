import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import { profilePhotoSchema } from '@recollect/contracts';

export async function chooseProfilePhoto(): Promise<string | null> {
  // The system photo picker grants access to only the selected image. Do not
  // request broad library, camera, or microphone access for a profile photo.
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 1,
    exif: false,
  });
  const asset = result.assets?.[0];
  if (result.canceled || !asset) return null;
  const side = Math.min(asset.width, asset.height);
  if (!side) throw new Error('This photo could not be opened. Choose another image.');
  const context = ImageManipulator.manipulate(asset.uri);
  let rendered: Awaited<ReturnType<typeof context.renderAsync>> | undefined;
  let resizedUri: string | undefined;
  try {
    context.crop({
      originX: Math.floor((asset.width - side) / 2),
      originY: Math.floor((asset.height - side) / 2),
      width: side,
      height: side,
    });
    context.resize({ width: 512, height: 512 });
    rendered = await context.renderAsync();
    const image = await rendered.saveAsync({
      format: SaveFormat.JPEG,
      compress: 0.75,
      base64: true,
    });
    resizedUri = image.uri;
    const dataUrl = 'data:image/jpeg;base64,' + (image.base64 ?? '');
    if (!profilePhotoSchema.safeParse(dataUrl).success)
      throw new Error('This photo is too large. Try a different photo.');
    return dataUrl;
  } finally {
    rendered?.release();
    context.release();
    if (resizedUri?.startsWith('file:')) {
      try {
        new File(resizedUri).delete();
      } catch {
        /* A cache file may already be gone. */
      }
    }
  }
}
