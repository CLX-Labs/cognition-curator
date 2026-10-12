import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createFingerprintAsync } from '@expo/fingerprint';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../apps/mobile', import.meta.url));
if (process.argv.includes('--hash')) {
  console.log((await createFingerprintAsync(root, { platforms: ['ios'] })).hash);
} else {
  // Separate processes ensure dynamic config does not reuse a cached JSON import.
  const exec = promisify(execFile);
  const fingerprint = async () => (await exec(process.execPath, [fileURLToPath(import.meta.url), '--hash'])).stdout.trim();
  const file = new URL('../apps/mobile/src/release-info.json', import.meta.url);
  const nativeFile = new URL('../apps/mobile/native-version.json', import.meta.url);
  const original = await readFile(file, 'utf8');
  const originalNative = await readFile(nativeFile, 'utf8');
  try {
    const before = await fingerprint();
    await writeFile(file, JSON.stringify({ id: 'r999.1-aaaaaaa', version: '2.1.0', commit: 'a'.repeat(40),
      createdAt: '2026-10-11T12:00:00.000Z', runUrl: 'https://github.com/CLX-Labs/cognition-curator/actions/runs/999' }));
    const after = await fingerprint();
    assert.equal(after, before, 'An OTA minor version must preserve the native runtime.');
    console.log(`OTA release metadata preserves the iOS native fingerprint: ${after}`);
    const currentMajor = Number(JSON.parse(originalNative).version.split('.')[0]);
    await writeFile(nativeFile, JSON.stringify({ version: `${currentMajor + 1}.0.0` }));
    const native = await fingerprint();
    assert.notEqual(native, before, 'A native major release must have a distinct runtime.');
    console.log(`A native major release changes the iOS runtime: ${native}`);
  } finally {
    await writeFile(file, original);
    await writeFile(nativeFile, originalNative);
  }
}
