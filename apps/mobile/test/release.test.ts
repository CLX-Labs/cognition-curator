import { describe, expect, it, vi } from 'vitest';
import { createUpdateChecker, downloadCompatibleUpdate, releaseLabel } from '../src/release';

describe('running release and manual OTA application', () => {
  it('distinguishes development, unstamped builds and versioned releases', () => {
    expect(releaseLabel('local', true)).toBe('Local development');
    expect(releaseLabel('local', false)).toBe('Unversioned release');
    expect(releaseLabel('r14.1-80ce215', false)).toBe('r14.1-80ce215');
    expect(releaseLabel('r14.1-80ce215', false, '2.1.0')).toBe('2.1.0 · r14.1-80ce215');
    expect(releaseLabel('local', true, '2.1.0')).toBe('Local development');
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

describe('foreground and manual update checks', () => {
  it('shares an in-flight download across foreground, timer and manual requests', async () => {
    let complete!: (value: { isAvailable: boolean; isRollBackToEmbedded: boolean }) => void;
    const checkForUpdateAsync = vi.fn(
      () =>
        new Promise<{ isAvailable: boolean; isRollBackToEmbedded: boolean }>((resolve) => {
          complete = resolve;
        }),
    );
    const fetchUpdateAsync = vi.fn(async () => ({ isNew: true, isRollBackToEmbedded: false }));
    const checker = createUpdateChecker({ checkForUpdateAsync, fetchUpdateAsync });
    const foreground = checker.check();
    const manual = checker.check(true);
    expect(manual).toBe(foreground);
    complete({ isAvailable: true, isRollBackToEmbedded: false });
    expect(await manual).toBe('ready');
    expect(checkForUpdateAsync).toHaveBeenCalledTimes(1);
    expect(fetchUpdateAsync).toHaveBeenCalledTimes(1);
  });
  it('backs off automatic checks while permitting an explicit manual retry', async () => {
    let time = 0;
    const checkForUpdateAsync = vi.fn(async () => ({
      isAvailable: false,
      isRollBackToEmbedded: false,
    }));
    const checker = createUpdateChecker(
      { checkForUpdateAsync, fetchUpdateAsync: vi.fn() },
      () => time,
    );
    await checker.check();
    time = 30_000;
    await checker.check();
    expect(checkForUpdateAsync).toHaveBeenCalledTimes(1);
    await checker.check(true);
    expect(checkForUpdateAsync).toHaveBeenCalledTimes(2);
    time = 90_000;
    await checker.check();
    expect(checkForUpdateAsync).toHaveBeenCalledTimes(3);
  });
  it('an offline check releases the shared request so a later retry can succeed', async () => {
    const checkForUpdateAsync = vi
      .fn()
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValue({ isAvailable: true, isRollBackToEmbedded: false });
    const checker = createUpdateChecker({
      checkForUpdateAsync,
      fetchUpdateAsync: async () => ({ isNew: true, isRollBackToEmbedded: false }),
    });
    await expect(checker.check()).rejects.toThrow('Offline');
    expect(await checker.check(true)).toBe('ready');
  });
});
