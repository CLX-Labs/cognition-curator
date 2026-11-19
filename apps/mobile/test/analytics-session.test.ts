import { describe, expect, it, vi } from 'vitest';
import { createAnalyticsSession, type AnalyticsClient } from '../src/analytics-session';

function deferred() {
  let resolve!: () => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function fixture() {
  const calls: string[] = [];
  const events: { owner: string | null; screen: string }[] = [];
  let owner: string | null = null;
  let optedIn = false;
  let recording = false;
  let filter = () => false;
  const client: AnalyticsClient = {
    identify: vi.fn((id: string) => {
      calls.push(`identify:${id}`);
      owner = id;
    }),
    screen: vi.fn((name: string) => {
      calls.push(`screen:${name}`);
      if (filter() && optedIn) events.push({ owner, screen: name });
    }),
    register: vi.fn(),
    reset: vi.fn(() => {
      calls.push('reset');
      owner = null;
    }),
    optIn: vi.fn(async () => {
      calls.push('optIn');
      optedIn = true;
    }),
    optOut: vi.fn(async () => {
      calls.push('optOut');
      optedIn = false;
      recording = false;
    }),
    startSessionRecording: vi.fn(async (resumeCurrent?: boolean) => {
      calls.push(`start:${resumeCurrent}`);
      recording = true;
    }),
    stopSessionRecording: vi.fn(async () => {
      calls.push('stop');
      recording = false;
    }),
    isSessionRecordingActive: vi.fn(async () => recording),
  };
  const factory = vi.fn((canCapture: () => boolean) => {
    filter = canCapture;
    return client;
  });
  const session = createAnalyticsSession(factory);
  return {
    client,
    calls,
    events,
    factory,
    session,
    get recording() { return recording; },
    get optedIn() { return optedIn; },
    get owner() { return owner; },
    acceptsEvent: () => filter() && optedIn,
    setRecording: (value: boolean) => { recording = value; },
    setOptedIn: (value: boolean) => { optedIn = value; },
  };
}

const first = { ownerId: 'account-a', screen: 'library' };
const second = { ownerId: 'account-b', screen: 'settings' };

describe('consented analytics session', () => {
  it('does not construct or contact the SDK before an eligible target exists', async () => {
    const f = fixture();
    expect(f.session.canCapture()).toBe(false);
    await f.session.update(null);
    await f.session.update(null);
    expect(f.factory).not.toHaveBeenCalled();
    expect(f.calls).toEqual([]);

    // An eligibility change withdrawn before reconciliation also needs no SDK.
    const opening = f.session.update(first);
    const withdrawn = f.session.update(null);
    await Promise.all([opening, withdrawn]);
    expect(f.factory).not.toHaveBeenCalled();
  });

  it('identifies once, uses a fresh replay session, and deduplicates the same screen', async () => {
    const f = fixture();
    await f.session.update(first);
    await f.session.update({ ...first });
    expect(f.factory).toHaveBeenCalledTimes(1);
    expect(f.calls).toEqual(['optIn', 'identify:account-a', 'start:false', 'screen:library']);
    expect(f.events).toEqual([{ owner: 'account-a', screen: 'library' }]);
    expect(f.acceptsEvent()).toBe(true);
    expect(f.recording).toBe(true);
  });

  it('changes screens for one account without resetting identity or restarting replay', async () => {
    const f = fixture();
    await f.session.update(first);
    await f.session.update({ ...first, screen: 'review' });
    await f.session.update({ ...first, screen: 'review' });
    expect(f.calls).toEqual([
      'optIn', 'identify:account-a', 'start:false', 'screen:library', 'screen:review',
    ]);
    expect(f.events).toEqual([
      { owner: 'account-a', screen: 'library' },
      { owner: 'account-a', screen: 'review' },
    ]);
  });

  it('requests stop and opt-out immediately when opt-in is pending, then closes it again', async () => {
    const f = fixture();
    const optIn = deferred();
    vi.mocked(f.client.optIn).mockImplementationOnce(async () => {
      f.calls.push('optIn:pending');
      await optIn.promise;
      // Model an old operation completing after the immediate opt-out.
      f.setOptedIn(true);
      f.calls.push('optIn:resolved');
    });
    const opening = f.session.update(first);
    await vi.waitFor(() => expect(f.client.optIn).toHaveBeenCalledTimes(1));
    const withdrawn = f.session.update(null);
    expect(f.session.canCapture()).toBe(false);
    expect(f.client.stopSessionRecording).toHaveBeenCalledTimes(1);
    expect(f.client.optOut).toHaveBeenCalledTimes(1);
    expect(f.client.reset).not.toHaveBeenCalled();
    expect(f.acceptsEvent()).toBe(false);

    optIn.resolve();
    await Promise.all([opening, withdrawn]);
    expect(f.client.identify).not.toHaveBeenCalled();
    expect(f.client.startSessionRecording).not.toHaveBeenCalled();
    expect(f.client.screen).not.toHaveBeenCalled();
    expect(f.calls).toEqual(['optIn:pending', 'stop', 'optOut', 'optIn:resolved', 'stop', 'optOut', 'reset']);
    expect(f.optedIn).toBe(false);
    expect(f.recording).toBe(false);
    expect(f.owner).toBeNull();
  });

  it('requests withdrawal during a pending replay start and stops a late completion before reset', async () => {
    const f = fixture();
    const start = deferred();
    vi.mocked(f.client.startSessionRecording).mockImplementationOnce(async () => {
      f.calls.push('start:pending');
      await start.promise;
      f.setRecording(true);
      f.calls.push('start:resolved');
    });
    const opening = f.session.update(first);
    await vi.waitFor(() => expect(f.client.startSessionRecording).toHaveBeenCalledTimes(1));
    expect(f.session.canCapture()).toBe(true);
    const withdrawn = f.session.update(null);
    expect(f.session.canCapture()).toBe(false);
    expect(f.client.stopSessionRecording).toHaveBeenCalledTimes(1);
    expect(f.client.optOut).toHaveBeenCalledTimes(1);
    expect(f.client.reset).not.toHaveBeenCalled();
    expect(f.acceptsEvent()).toBe(false);

    start.resolve();
    await Promise.all([opening, withdrawn]);
    expect(f.client.screen).not.toHaveBeenCalled();
    expect(f.calls.slice(-4)).toEqual(['start:resolved', 'stop', 'optOut', 'reset']);
    expect(f.recording).toBe(false);
    expect(f.optedIn).toBe(false);
    expect(f.owner).toBeNull();
  });

  it('waits for the old start and cleanup before identifying or starting the next account', async () => {
    const f = fixture();
    const start = deferred();
    const stop = deferred();
    vi.mocked(f.client.startSessionRecording).mockImplementationOnce(async () => {
      f.calls.push('start:a:pending');
      await start.promise;
      f.setRecording(true);
      f.calls.push('start:a:resolved');
    });
    vi.mocked(f.client.stopSessionRecording).mockImplementationOnce(async () => {
      f.calls.push('stop:pending');
      await stop.promise;
      f.setRecording(false);
      f.calls.push('stop:resolved');
    });
    const opening = f.session.update(first);
    await vi.waitFor(() => expect(f.client.startSessionRecording).toHaveBeenCalledTimes(1));
    const switching = f.session.update(second);
    expect(f.session.canCapture()).toBe(false);
    expect(f.client.optOut).toHaveBeenCalledTimes(1);
    expect(f.client.identify).toHaveBeenCalledTimes(1);

    start.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(f.client.identify).toHaveBeenCalledTimes(1);
    expect(f.client.startSessionRecording).toHaveBeenCalledTimes(1);
    stop.resolve();
    await Promise.all([opening, switching]);
    expect(f.factory).toHaveBeenCalledTimes(1);
    expect(f.calls.indexOf('identify:account-b')).toBeGreaterThan(f.calls.indexOf('reset'));
    expect(f.calls.indexOf('reset')).toBeGreaterThan(f.calls.indexOf('stop:resolved'));
    expect(f.events).toEqual([{ owner: 'account-b', screen: 'settings' }]);
    expect(f.owner).toBe('account-b');
    expect(f.session.canCapture()).toBe(true);
    expect(f.recording).toBe(true);
  });

  it.each(['optIn', 'startSessionRecording'] as const)(
    'coalesces same-account routes during pending %s without restarting replay',
    async (pendingOperation) => {
      const f = fixture();
      const pending = deferred();
      vi.mocked(f.client[pendingOperation]).mockImplementationOnce(async () => {
        await pending.promise;
        if (pendingOperation === 'optIn') f.setOptedIn(true);
        else f.setRecording(true);
      });
      const opening = f.session.update(first);
      await vi.waitFor(() => expect(f.client[pendingOperation]).toHaveBeenCalledTimes(1));
      const navigated = f.session.update({ ...first, screen: 'review' });
      pending.resolve();
      await Promise.all([opening, navigated]);
      expect(f.client.identify).toHaveBeenCalledTimes(1);
      expect(f.client.startSessionRecording).toHaveBeenCalledTimes(1);
      expect(f.client.stopSessionRecording).not.toHaveBeenCalled();
      expect(f.client.reset).not.toHaveBeenCalled();
      expect(f.events).toEqual([{ owner: 'account-a', screen: 'review' }]);
    },
  );

  it('closes a failed start without rejecting or retrying on a route change', async () => {
    const f = fixture();
    vi.mocked(f.client.startSessionRecording).mockRejectedValueOnce(new Error('native unavailable'));
    await expect(f.session.update(first)).resolves.toBeUndefined();
    expect(f.session.canCapture()).toBe(false);
    expect(f.client.screen).not.toHaveBeenCalled();
    expect(f.calls.slice(-3)).toEqual(['stop', 'optOut', 'reset']);
    expect(f.recording).toBe(false);
    expect(f.optedIn).toBe(false);
    await expect(f.session.update({ ...first, screen: 'review' })).resolves.toBeUndefined();
    expect(f.client.startSessionRecording).toHaveBeenCalledTimes(1);
    expect(f.client.screen).not.toHaveBeenCalled();

    // A new eligible account can use the safely cleaned client.
    await f.session.update(second);
    expect(f.factory).toHaveBeenCalledTimes(1);
    expect(f.events).toEqual([{ owner: 'account-b', screen: 'settings' }]);
  });

  it('handles asynchronous screen failures and a throwing SDK factory without unhandled rejections', async () => {
    const f = fixture();
    vi.mocked(f.client.screen).mockRejectedValueOnce(new Error('screen unavailable'));
    await expect(f.session.update(first)).resolves.toBeUndefined();
    expect(f.session.canCapture()).toBe(false);
    expect(f.calls.slice(-3)).toEqual(['stop', 'optOut', 'reset']);

    const factory = vi.fn(() => { throw new Error('SDK unavailable'); });
    const session = createAnalyticsSession(factory);
    await expect(session.update(first)).resolves.toBeUndefined();
    await expect(session.update(second)).resolves.toBeUndefined();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(session.canCapture()).toBe(false);
  });

  it('does not reuse native replay when SDK stop and opt-out resolve without stopping it', async () => {
    const f = fixture();
    await f.session.update(first);
    // The real JS SDK can resolve these calls after swallowing a native stop
    // failure. Keep native recording active while the JS opt-out succeeds.
    vi.mocked(f.client.stopSessionRecording).mockResolvedValue(undefined);
    vi.mocked(f.client.optOut).mockImplementation(async () => { f.setOptedIn(false); });
    await expect(f.session.update(second)).resolves.toBeUndefined();
    expect(f.client.isSessionRecordingActive).toHaveBeenCalledTimes(1);
    expect(vi.mocked(f.client.reset).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(f.client.isSessionRecordingActive).mock.invocationCallOrder[0]!,
    );
    expect(f.recording).toBe(true);
    expect(f.session.canCapture()).toBe(false);
    expect(f.client.identify).toHaveBeenCalledTimes(1);
    expect(f.client.startSessionRecording).toHaveBeenCalledTimes(1);
    expect(f.events).toEqual([{ owner: 'account-a', screen: 'library' }]);

    await f.session.update(null);
    await f.session.update(second);
    expect(f.client.identify).toHaveBeenCalledTimes(1);
  });

  it.each(['rejects', 'unknown'] as const)(
    'keeps capture closed when native recording status %s instead of confirming false',
    async (failure) => {
      const f = fixture();
      await f.session.update(first);
      if (failure === 'rejects')
        vi.mocked(f.client.isSessionRecordingActive).mockRejectedValue(new Error('native bridge unavailable'));
      else
        vi.mocked(f.client.isSessionRecordingActive).mockResolvedValue(undefined as unknown as boolean);
      await expect(f.session.update(second)).resolves.toBeUndefined();
      expect(f.session.canCapture()).toBe(false);
      expect(f.client.identify).toHaveBeenCalledTimes(1);
      expect(f.client.startSessionRecording).toHaveBeenCalledTimes(1);
      await f.session.update(null);
      await f.session.update(second);
      expect(f.client.identify).toHaveBeenCalledTimes(1);
    },
  );

  it('awaits native confirmation before a new identity, including a newer owner arriving during the query', async () => {
    const f = fixture();
    await f.session.update(first);
    const confirmation = deferred();
    vi.mocked(f.client.isSessionRecordingActive).mockImplementationOnce(async () => {
      await confirmation.promise;
      return false;
    });
    const switching = f.session.update(second);
    await vi.waitFor(() => expect(f.client.isSessionRecordingActive).toHaveBeenCalledTimes(1));
    expect(f.client.reset).toHaveBeenCalledTimes(1);
    expect(f.client.identify).toHaveBeenCalledTimes(1);
    expect(f.session.canCapture()).toBe(false);
    const newer = f.session.update({ ownerId: 'account-c', screen: 'review' });
    confirmation.resolve();
    await Promise.all([switching, newer]);
    expect(vi.mocked(f.client.identify).mock.calls).toEqual([['account-a'], ['account-c']]);
    expect(f.client.startSessionRecording).toHaveBeenCalledTimes(2);
    expect(f.events).toEqual([
      { owner: 'account-a', screen: 'library' },
      { owner: 'account-c', screen: 'review' },
    ]);
    expect(f.session.canCapture()).toBe(true);
  });

  it('does not revive capture if consent is withdrawn while native status confirmation is pending', async () => {
    const f = fixture();
    await f.session.update(first);
    const confirmation = deferred();
    vi.mocked(f.client.isSessionRecordingActive).mockImplementationOnce(async () => {
      await confirmation.promise;
      return false;
    });
    const switching = f.session.update(second);
    await vi.waitFor(() => expect(f.client.isSessionRecordingActive).toHaveBeenCalledTimes(1));
    const withdrawn = f.session.update(null);
    expect(f.session.canCapture()).toBe(false);
    confirmation.resolve();
    await Promise.all([switching, withdrawn]);
    expect(f.client.identify).toHaveBeenCalledTimes(1);
    expect(f.client.startSessionRecording).toHaveBeenCalledTimes(1);
    expect(f.session.canCapture()).toBe(false);
    expect(f.recording).toBe(false);
    expect(f.optedIn).toBe(false);
  });

  it('keeps later accounts closed if final replay cleanup cannot be confirmed', async () => {
    const f = fixture();
    await f.session.update(first);
    vi.mocked(f.client.stopSessionRecording).mockRejectedValue(new Error('bridge unavailable'));
    await expect(f.session.update(second)).resolves.toBeUndefined();
    expect(f.session.canCapture()).toBe(false);
    expect(f.client.identify).toHaveBeenCalledTimes(1);
    expect(f.client.optOut).toHaveBeenCalled();
    expect(f.client.reset).toHaveBeenCalled();
    await f.session.update(null);
    await f.session.update(second);
    expect(f.client.identify).toHaveBeenCalledTimes(1);
  });
});
