export interface WorkerConfig {
  concurrency: number;
  dispatchIntervalMs: number;
  pollingIntervalMs: number;
  recoveryIntervalMs: number;
}

export const defaultWorkerConfig: Readonly<WorkerConfig> = Object.freeze({
  concurrency: 2,
  dispatchIntervalMs: 500,
  pollingIntervalMs: 500,
  recoveryIntervalMs: 30_000,
});

const bounds: Record<keyof WorkerConfig, readonly [number, number]> = {
  concurrency: [1, 8],
  dispatchIntervalMs: [250, 60_000],
  pollingIntervalMs: [500, 60_000],
  recoveryIntervalMs: [5_000, 300_000],
};

const environmentNames: Record<keyof WorkerConfig, string> = {
  concurrency: 'GENERATION_WORKER_CONCURRENCY',
  dispatchIntervalMs: 'GENERATION_DISPATCH_INTERVAL_MS',
  pollingIntervalMs: 'GENERATION_POLL_INTERVAL_MS',
  recoveryIntervalMs: 'GENERATION_RECOVERY_INTERVAL_MS',
};

/** Validate before opening a queue connection or accepting any generation work. */
export function resolveWorkerConfig(overrides: Partial<WorkerConfig> = {}): WorkerConfig {
  const config = { ...defaultWorkerConfig, ...overrides };
  for (const key of Object.keys(bounds) as Array<keyof WorkerConfig>) {
    const [min, max] = bounds[key];
    if (!Number.isSafeInteger(config[key]) || config[key] < min || config[key] > max)
      throw new Error(`${environmentNames[key]} must be an integer between ${min} and ${max}.`);
  }
  return config;
}

export function readWorkerConfig(
  env: Record<string, string | undefined> = process.env,
): WorkerConfig {
  const overrides: Partial<WorkerConfig> = {};
  for (const key of Object.keys(environmentNames) as Array<keyof WorkerConfig>) {
    const value = env[environmentNames[key]];
    if (value !== undefined) overrides[key] = /^\d+$/u.test(value) ? Number(value) : Number.NaN;
  }
  return resolveWorkerConfig(overrides);
}
