import { describe, expect, it } from 'vitest';
import type { Database } from '@recollect/db';
import { defaultWorkerConfig, readWorkerConfig, resolveWorkerConfig } from '../src/config.js';
import { startWorker } from '../src/worker.js';

describe('bounded generation worker configuration', () => {
  it('uses two providers and fast delivery with a separate recovery cadence', () => {
    expect(readWorkerConfig({})).toEqual({
      concurrency: 2,
      dispatchIntervalMs: 500,
      pollingIntervalMs: 500,
      recoveryIntervalMs: 30_000,
    });
    expect(resolveWorkerConfig()).toEqual(defaultWorkerConfig);
  });

  it('accepts explicit operational overrides without changing defaults', () => {
    expect(
      readWorkerConfig({
        GENERATION_WORKER_CONCURRENCY: '4',
        GENERATION_DISPATCH_INTERVAL_MS: '1000',
        GENERATION_POLL_INTERVAL_MS: '2000',
        GENERATION_RECOVERY_INTERVAL_MS: '60000',
      }),
    ).toEqual({
      concurrency: 4,
      dispatchIntervalMs: 1000,
      pollingIntervalMs: 2000,
      recoveryIntervalMs: 60_000,
    });
    expect(resolveWorkerConfig({ concurrency: 1 }).dispatchIntervalMs).toBe(500);
    expect(defaultWorkerConfig.concurrency).toBe(2);
  });

  it.each([
    ['GENERATION_WORKER_CONCURRENCY', '0'],
    ['GENERATION_WORKER_CONCURRENCY', '9'],
    ['GENERATION_WORKER_CONCURRENCY', '1.5'],
    ['GENERATION_WORKER_CONCURRENCY', '2e0'],
    ['GENERATION_WORKER_CONCURRENCY', ''],
    ['GENERATION_DISPATCH_INTERVAL_MS', '249'],
    ['GENERATION_DISPATCH_INTERVAL_MS', '60001'],
    ['GENERATION_POLL_INTERVAL_MS', '499'],
    ['GENERATION_POLL_INTERVAL_MS', '60001'],
    ['GENERATION_RECOVERY_INTERVAL_MS', '4999'],
    ['GENERATION_RECOVERY_INTERVAL_MS', '300001'],
    ['GENERATION_RECOVERY_INTERVAL_MS', 'oops'],
  ])('rejects invalid %s without exposing the supplied value', (name, value) => {
    expect(() => readWorkerConfig({ [name]: value })).toThrow(name);
  });

  it.each([
    { concurrency: Number.NaN },
    { concurrency: Number.POSITIVE_INFINITY },
    { dispatchIntervalMs: 250.5 },
    { pollingIntervalMs: undefined },
  ])('validates programmatic options before attempting any connection (%j)', async (options) => {
    await expect(
      startWorker(
        {} as Database,
        'not a database URL',
        {
          generate: async () => {
            throw new Error('Provider must not be called');
          },
        },
        options,
      ),
    ).rejects.toThrow('must be an integer');
  });
});
