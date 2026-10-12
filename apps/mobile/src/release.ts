import metadata from './release-info.json';

export const release = metadata as {
  id: string;
  version: string | null;
  commit: string | null;
  createdAt: string | null;
  runUrl: string | null;
};

export function releaseLabel(id: string, development: boolean, version?: string | null) {
  return id === 'local'
    ? development
      ? 'Local development'
      : 'Unversioned release'
    : version
      ? `${version} · ${id}`
      : id;
}

type UpdateClient = {
  checkForUpdateAsync(): Promise<{ isAvailable: boolean; isRollBackToEmbedded: boolean }>;
  fetchUpdateAsync(): Promise<{ isNew: boolean; isRollBackToEmbedded: boolean }>;
};

/** Downloads never change the running label or restart without a user action. */
export async function downloadCompatibleUpdate(
  client: UpdateClient,
): Promise<'ready' | 'none' | 'unchanged'> {
  const check = await client.checkForUpdateAsync();
  if (!check.isAvailable && !check.isRollBackToEmbedded) return 'none';
  const downloaded = await client.fetchUpdateAsync();
  return downloaded.isNew || downloaded.isRollBackToEmbedded ? 'ready' : 'unchanged';
}

/** Foreground, timer and manual checks share one download and a background cooldown. */
export function createUpdateChecker(
  client: UpdateClient,
  now: () => number = Date.now,
  cooldownMs = 60_000,
) {
  let inFlight: ReturnType<typeof downloadCompatibleUpdate> | null = null;
  let lastCheck = -Infinity;
  return {
    check(force = false): ReturnType<typeof downloadCompatibleUpdate> {
      if (inFlight) return inFlight;
      if (!force && now() - lastCheck < cooldownMs) return Promise.resolve('unchanged');
      lastCheck = now();
      inFlight = downloadCompatibleUpdate(client).finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
  };
}
