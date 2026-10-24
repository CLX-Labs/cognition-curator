import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import { deckImageSchema, MAX_DECK_IMAGE_LENGTH } from '@recollect/contracts';

/** Redraw one selected photo as a bounded square JPEG without copying its metadata. */
export async function chooseDeckPhoto(): Promise<string | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 1,
    exif: false,
  });
  const asset = result.assets?.[0];
  if (result.canceled || !asset) return null;
  if (
    !Number.isFinite(asset.width) ||
    !Number.isFinite(asset.height) ||
    asset.width < 1 ||
    asset.height < 1
  )
    throw new Error('This image could not be opened. Choose another photo.');
  const width = Math.floor(asset.width),
    height = Math.floor(asset.height);
  const side = Math.min(width, height);
  const context = ImageManipulator.manipulate(asset.uri);
  const files = new Set<string>();
  let rendered: Awaited<ReturnType<typeof context.renderAsync>> | undefined;
  let currentSize = 0;
  try {
    context.crop({
      originX: Math.floor((width - side) / 2),
      originY: Math.floor((height - side) / 2),
      width: side,
      height: side,
    });
    for (const [size, quality] of [
      [512, 0.8],
      [512, 0.6],
      [384, 0.65],
      [256, 0.6],
    ] as const) {
      if (currentSize !== size) {
        rendered?.release();
        rendered = undefined;
        context.resize({ width: size, height: size });
        rendered = await context.renderAsync();
        currentSize = size;
      }
      const image = await rendered!.saveAsync({
        format: SaveFormat.JPEG,
        compress: quality,
        base64: true,
      });
      if (image.uri.startsWith('file:') && image.uri !== asset.uri) files.add(image.uri);
      if (!image.base64) throw new Error('This image could not be prepared. Choose another photo.');
      const dataUrl = 'data:image/jpeg;base64,' + image.base64;
      if (dataUrl.length > MAX_DECK_IMAGE_LENGTH) continue;
      const parsed = deckImageSchema.safeParse(dataUrl);
      if (!parsed.success)
        throw new Error('This image could not be prepared as a deck cover. Choose another photo.');
      return dataUrl;
    }
    throw new Error('This image is too large. Choose a simpler photo.');
  } finally {
    rendered?.release();
    context.release();
    for (const uri of files) {
      try {
        new File(uri).delete();
      } catch {
        /* A temporary image may already have been removed by the system. */
      }
    }
  }
}
