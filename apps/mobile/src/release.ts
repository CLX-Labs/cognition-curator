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
