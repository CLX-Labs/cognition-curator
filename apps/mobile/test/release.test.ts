import { describe, expect, it, vi } from 'vitest';
import { downloadCompatibleUpdate, releaseLabel } from '../src/release';

describe('running release and manual OTA application', () => {
  it('distinguishes development, unstamped builds and versioned releases', () => {
    expect(releaseLabel('local', true)).toBe('Local development');
    expect(releaseLabel('local', false)).toBe('Unversioned release');
    expect(releaseLabel('r14.1-80ce215', false)).toBe('r14.1-80ce215');
  });
  it('does not download when there is no compatible update', async () => {
    const fetchUpdateAsync = vi.fn();
    expect(
      await downloadCompatibleUpdate({
        checkForUpdateAsync: async () => ({ isAvailable: false, isRollBackToEmbedded: false }),
        fetchUpdateAsync,
      }),
    ).toBe('none');
    expect(fetchUpdateAsync).not.toHaveBeenCalled();
  });
  it.each([
    { isAvailable: true, isRollBackToEmbedded: false },
    { isAvailable: false, isRollBackToEmbedded: true },
  ])(
    'downloads a compatible update or rollback, leaving restart to the user',
    async (check) => {
      const reloadAsync = vi.fn();
      const client = {
        checkForUpdateAsync: async () => check,
        fetchUpdateAsync: async () => ({
          isNew: check.isAvailable,
          isRollBackToEmbedded: check.isRollBackToEmbedded,
        }),
        reloadAsync,
      };
      expect(await downloadCompatibleUpdate(client)).toBe('ready');
      expect(reloadAsync).not.toHaveBeenCalled();
    },
  );
  it('does not report readiness after a failed download or connection', async () => {
    const checkForUpdateAsync = async () => ({
      isAvailable: true,
      isRollBackToEmbedded: false,
    });
    expect(
      await downloadCompatibleUpdate({
        checkForUpdateAsync,
        fetchUpdateAsync: async () => ({ isNew: false, isRollBackToEmbedded: false }),
      }),
    ).toBe('unchanged');
    await expect(
      downloadCompatibleUpdate({
        checkForUpdateAsync,
        fetchUpdateAsync: async () => {
          throw new Error('Offline');
        },
      }),
    ).rejects.toThrow('Offline');
  });
});
