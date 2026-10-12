import assert from 'node:assert/strict';
import test from 'node:test';
import { validateConfig } from './release-pipeline.mjs';

const env = { EXPO_TOKEN: 'test', API_URL: 'https://api.example.com', GITHUB_SHA: 'a'.repeat(40), ASC_APP_ID: '1234567890' };

test('Expo releases require only app settings, with no Railway credentials or service IDs', () => {
  assert.equal(validateConfig(env), 'https://api.example.com');
  for (const name of Object.keys(env)) assert.throws(() => validateConfig({ ...env, [name]: '' }));
});

test('rejects temporary or credential-bearing API origins in the app configuration', () => {
  for (const url of ['http://api.example.com', 'https://test.trycloudflare.com', 'https://localhost',
    'https://user:password@api.example.com', 'https://api.example.com/api'])
    assert.throws(() => validateConfig({ ...env, API_URL: url }), /stable HTTPS/);
});
