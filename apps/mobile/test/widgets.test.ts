import { describe, expect, it, vi } from 'vitest';
import { WidgetCoordinator } from '../src/widget-coordinator';
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
const snapshot = (ownerId: string) => ({
  ownerId,
  dueCount: 2,
  hasCards: true,
  updatedAt: '2026-10-11T12:00:00.000Z',
  topCard: null,
});

describe('widget owner lifecycle', () => {
  it('does not reload native widgets for timestamp-only background refreshes', async () => {
    const native = {
      setWidgetOwner: vi.fn(async () => {}),
      publishWidget: vi.fn(async () => {}),
    };
    const coordinator = new WidgetCoordinator(native);
    await coordinator.setOwner('owner-a');
    await coordinator.publish(snapshot('owner-a'));
    await coordinator.publish({ ...snapshot('owner-a'), updatedAt: '2026-10-13T00:00:00Z' });
    expect(native.publishWidget).toHaveBeenCalledTimes(1);
    await coordinator.publish({ ...snapshot('owner-a'), dueCount: 3 });
    expect(native.publishWidget).toHaveBeenCalledTimes(2);
  });
  it('retries unchanged widget content after a failed publish', async () => {
    const native = {
      setWidgetOwner: vi.fn(async () => {}),
      publishWidget: vi.fn(async () => {}).mockRejectedValueOnce(new Error('Native failure')),
    };
    const coordinator = new WidgetCoordinator(native);
    await coordinator.setOwner('owner-a');
    await expect(coordinator.publish(snapshot('owner-a'))).rejects.toThrow('Native failure');
    await coordinator.publish(snapshot('owner-a'));
    expect(native.publishWidget).toHaveBeenCalledTimes(2);
  });
  it('drops queued old-owner content before sign-out and finishes by clearing native state', async () => {
    const pending = deferred();
    const native = {
      setWidgetOwner: vi.fn(() => pending.promise),
      publishWidget: vi.fn(async () => undefined),
    };
    const coordinator = new WidgetCoordinator(native);
    const setup = coordinator.setOwner('owner-a');
    await Promise.resolve();
    await Promise.resolve();
    const stale = coordinator.publish(snapshot('owner-a'));
    const logout = coordinator.setOwner(null);
    pending.resolve();
    await Promise.all([setup, stale, logout]);
    expect(native.publishWidget.mock.calls).toEqual([[null]]);
  });
  it('never publishes a stale account snapshot after switching owners', async () => {
    const native = {
      setWidgetOwner: vi.fn(async () => undefined),
      publishWidget: vi.fn(async () => undefined),
    };
    const coordinator = new WidgetCoordinator(native);
    await coordinator.setOwner('owner-a');
    const stale = coordinator.publish(snapshot('owner-a'));
    const nextOwner = coordinator.setOwner('owner-b');
    await Promise.all([stale, nextOwner]);
    await coordinator.publish(snapshot('owner-a'));
    await coordinator.publish(snapshot('owner-b'));
    expect(native.publishWidget.mock.calls).toEqual([[snapshot('owner-b')]]);
  });
  it('continues to process later owner changes after a native failure', async () => {
    const native = {
      setWidgetOwner: vi.fn(async () => undefined),
      publishWidget: vi
        .fn(async () => undefined)
        .mockRejectedValueOnce(new Error('Container unavailable')),
    };
    const coordinator = new WidgetCoordinator(native);
    await expect(coordinator.setOwner(null)).rejects.toThrow('Container unavailable');
    await coordinator.setOwner('owner-b');
    await coordinator.publish(snapshot('owner-b'));
    expect(native.publishWidget).toHaveBeenLastCalledWith(snapshot('owner-b'));
  });
});
