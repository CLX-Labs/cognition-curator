import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createFingerprintAsync } from '@expo/fingerprint';
import { fileURLToPath } from 'node:url';

const file = new URL('../apps/mobile/src/release-info.json', import.meta.url);
const original = await readFile(file, 'utf8');
try {
  const root = fileURLToPath(new URL('../apps/mobile', import.meta.url));
  const before = await createFingerprintAsync(root, { platforms: ['ios'] });
  await writeFile(file, JSON.stringify({ id: 'r999.1-aaaaaaa', commit: 'a'.repeat(40),
    createdAt: '2026-10-11T12:00:00.000Z', runUrl: 'https://github.com/CLX-Labs/cognition-curator/actions/runs/999' }));
  const after = await createFingerprintAsync(root, { platforms: ['ios'] });
  assert.equal(after.hash, before.hash, 'A release stamp must not force a new native runtime.');
  console.log(`Release metadata preserves the iOS native fingerprint: ${after.hash}`);
} finally { await writeFile(file, original); }
