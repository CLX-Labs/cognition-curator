import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export async function shareJSON(name: string, value: unknown) {
  const file = new File(
    Paths.document,
    name + '-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json',
  );
  file.create({ intermediates: true, overwrite: false });
  file.write(JSON.stringify(value, null, 2));
  if (await Sharing.isAvailableAsync())
    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/json',
      UTI: 'public.json',
      dialogTitle: 'Export your Recollect library',
    });
  else
    throw new Error('Sharing is unavailable on this device. The export was saved at ' + file.uri);
  return file.uri;
}
export async function shareExistingFile(uri: string) {
  if (!(await Sharing.isAvailableAsync()))
    throw new Error('File sharing is unavailable on this device.');
  await Sharing.shareAsync(uri, { dialogTitle: 'Keep a copy of your original library' });
}
