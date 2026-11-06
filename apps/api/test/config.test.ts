import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
describe('configuration fails closed', () => {
  const base = {
    DATABASE_URL: 'postgresql://localhost/test',
    ACCESS_TOKEN_SECRET: 'a'.repeat(40),
    APPLE_BUNDLE_ID: 'test.recollect',
  };
  it('rejects development auth in production', () =>
    expect(() =>
      loadConfig({ ...base, NODE_ENV: 'production', ENABLE_DEV_AUTH: 'true' }),
    ).toThrow());
  it('rejects weak or absent secrets', () =>
    expect(() => loadConfig({ ...base, ACCESS_TOKEN_SECRET: 'weak' })).toThrow());
  it('leaves charging and billing off unless explicitly enabled', () => {
    const config = loadConfig(base);
    expect(config.generationTokensEnabled).toBe(false);
    expect(config.appleBilling?.enabled).toBe(false);
    expect(config.appleBilling?.environment).toBe('Production');
  });
  it('refuses Sandbox purchase credits in production', () => {
    expect(() =>
      loadConfig({ ...base, NODE_ENV: 'production', APPLE_BILLING_ENVIRONMENT: 'Sandbox' }),
    ).toThrow('Sandbox');
    expect(
      loadConfig({ ...base, NODE_ENV: 'test', APPLE_BILLING_ENVIRONMENT: 'Sandbox' }).appleBilling
        ?.environment,
    ).toBe('Sandbox');
  });
  it.each(['NaN', '0', '-1', '100000', '1.5'])('rejects invalid quota %s', (value) =>
    expect(() => loadConfig({ ...base, DAILY_GENERATION_CARDS: value })).toThrow(),
  );
});
