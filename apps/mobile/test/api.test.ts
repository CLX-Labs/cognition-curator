import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Session } from '@recollect/contracts';
import * as AppleAuthentication from 'expo-apple-authentication';

const store = vi.hoisted(() => ({
  value: null as string | null,
  deletions: null as string | null,
}));
const releaseStamp = vi.hoisted(() => ({ apiUrl: null as string | null }));
vi.mock('../src/release', () => ({ release: releaseStamp }));
vi.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'device-only',
  getItemAsync: vi.fn(async (key: string) =>
    key === 'recollect.accountDeletion.v1' ? store.deletions : store.value,
  ),
  setItemAsync: vi.fn(async (key: string, value: string) => {
    if (key === 'recollect.accountDeletion.v1') store.deletions = value;
    else store.value = value;
  }),
  deleteItemAsync: vi.fn(async () => {
    store.value = null;
  }),
}));
vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA256' },
  digestStringAsync: vi.fn(async () => 'digest'),
}));
vi.mock('expo-apple-authentication', () => ({
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
  signInAsync: vi.fn(),
}));
let ApiClient: typeof import('../src/api').ApiClient;
beforeAll(async () => {
  vi.stubGlobal('__DEV__', true);
  process.env.EXPO_PUBLIC_API_URL = 'https://test.recollect.invalid';
  process.env.EXPO_PUBLIC_ENABLE_DEV_AUTH = 'true';
  ApiClient = (await import('../src/api')).ApiClient;
});
beforeEach(() => {
  store.value = null;
  store.deletions = null;
  releaseStamp.apiUrl = null;
  process.env.EXPO_PUBLIC_API_URL = 'https://test.recollect.invalid';
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal('__DEV__', true);
});
const session = (id = randomUUID(), token = 'access', expired = false): Session => ({
  user: { id, name: 'Learner', email: 'learner@example.test' },
  accessToken: token,
  refreshToken: 'r'.repeat(40) + token,
  expiresAt: new Date(Date.now() + (expired ? -1000 : 3600_000)).toISOString(),
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

describe('rotating authentication and account race boundaries', () => {
  it('uses the stamped release API even when the bundled environment still names a preview tunnel', async () => {
    vi.stubGlobal('__DEV__', false);
    releaseStamp.apiUrl = 'https://cognition-curator-production.up.railway.app';
    process.env.EXPO_PUBLIC_API_URL = 'https://expired-preview.trycloudflare.com';
    const client = new ApiClient();
    client.session = session();
    const fetcher = vi.fn(async () => json({ okay: true }));
    vi.stubGlobal('fetch', fetcher);
    await client.request('/v1/generations', { method: 'POST', body: { prompt: 'question' } });
    expect(fetcher.mock.calls[0][0]).toBe(
      'https://cognition-curator-production.up.railway.app/v1/generations',
    );
  });
  it('turns a native hostname error into a retryable connection error without losing the session', async () => {
    const client = new ApiClient();
    const original = session();
    client.session = original;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error(
          'fetch failed: UnexpectedException: A server with the specified hostname could not be found.',
        );
      }),
    );
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(client.request('/v1/generations')).rejects.toMatchObject({
        status: 0,
        code: 'network_unavailable',
        message: expect.stringContaining('Your request is saved'),
      });
      expect(client.session).toBe(original);
      expect(warning).toHaveBeenCalledWith('[Recollect API]', {
        code: 'network_unavailable',
        host: 'test.recollect.invalid',
        route: '/v1/generations',
      });
    } finally {
      warning.mockRestore();
    }
  });
  it('uses one refresh for simultaneous expired requests and persists rotation', async () => {
    const client = new ApiClient();
    const old = session(randomUUID(), 'old', true);
    const renewed = session(old.user.id, 'new');
    client.session = old;
    const flight = deferred<Response>();
    const fetcher = vi.fn((url: string) =>
      url.endsWith('/auth/refresh') ? flight.promise : Promise.resolve(json({ okay: true })),
    );
    vi.stubGlobal('fetch', fetcher);
    const first = client.request('/v1/sync/pull');
    const second = client.request('/v1/sync/pull');
    flight.resolve(json(renewed));
    await Promise.all([first, second]);
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/auth/refresh'))).toHaveLength(1);
    expect(JSON.parse(store.value!).refreshToken).toBe(renewed.refreshToken);
  });
  it('never retries an old owner payload with a new account after a delayed 401', async () => {
    const client = new ApiClient();
    const old = session();
    const next = session();
    client.session = old;
    const pending = deferred<Response>();
    const fetcher = vi.fn((url: string) =>
      url.endsWith('/auth/development') ? Promise.resolve(json(next)) : pending.promise,
    );
    vi.stubGlobal('fetch', fetcher);
    const request = client.request('/v1/sync/push', {
      method: 'POST',
      body: { privateOwnerData: old.user.id },
      ownerId: old.user.id,
    });
    const assertion = expect(request).rejects.toThrow('account changed');
    await client.signInDevelopment('other@example.test');
    pending.resolve(json({ error: { message: 'Expired' } }, 401));
    await assertion;
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/sync/push'))).toHaveLength(1);
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/auth/refresh'))).toHaveLength(0);
  });
  it('blocks a request before sending when its repository belongs to a previous owner', async () => {
    const client = new ApiClient();
    client.session = session();
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(
      client.request('/v1/sync/push', { method: 'POST', body: {}, ownerId: randomUUID() }),
    ).rejects.toThrow('account changed');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not send an old request when refresh completes after account switch', async () => {
    const client = new ApiClient();
    const old = session(randomUUID(), 'old', true);
    const next = session();
    client.session = old;
    const pending = deferred<Response>();
    const fetcher = vi.fn((url: string) =>
      url.endsWith('/auth/refresh') ? pending.promise : Promise.resolve(json(next)),
    );
    vi.stubGlobal('fetch', fetcher);
    const request = client.request('/v1/generations', {
      method: 'POST',
      body: { prompt: 'old owner notes' },
      ownerId: old.user.id,
    });
    const assertion = expect(request).rejects.toThrow('account changed');
    await client.signInDevelopment('other@example.test');
    pending.resolve(json(session(old.user.id, 'old-rotated')));
    await assertion;
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('/generations'))).toBe(false);
    expect(client.session?.user.id).toBe(next.user.id);
    expect(JSON.parse(store.value!).user.id).toBe(next.user.id);
  });
  it('does not restore a logged-out account after an in-flight refresh', async () => {
    const client = new ApiClient();
    const old = session();
    client.session = old;
    const pending = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        url.endsWith('/auth/refresh')
          ? pending.promise
          : Promise.resolve(new Response(null, { status: 204 })),
      ),
    );
    const refresh = client.refresh();
    const assertion = expect(refresh).rejects.toThrow('account changed');
    await client.logout();
    pending.resolve(json(session(old.user.id, 'new')));
    await assertion;
    expect(client.session).toBeNull();
    expect(store.value).toBeNull();
  });
  it('treats a corrupt credential as signed out without touching local library data', async () => {
    store.value = '{invalid json';
    const client = new ApiClient();
    expect(await client.initialize()).toBeNull();
    expect(store.value).toBeNull();
  });
  it('preserves a fresh-Apple-auth requirement without attempting token refresh', async () => {
    const client = new ApiClient();
    client.session = session();
    const fetcher = vi.fn(async () =>
      json(
        { error: { code: 'reauthentication_required', message: 'Confirm Apple sign-in again.' } },
        401,
      ),
    );
    vi.stubGlobal('fetch', fetcher);
    await expect(client.request('/v1/imports', { method: 'POST', body: {} })).rejects.toMatchObject(
      { code: 'reauthentication_required' },
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(client.session).not.toBeNull();
  });
});

describe('recoverable account deletion', () => {
  function appleProof() {
    vi.mocked(AppleAuthentication.signInAsync).mockResolvedValue({
      identityToken: 'fresh-identity-token'.repeat(2),
      authorizationCode: 'fresh-authorization-code',
    } as AppleAuthentication.AppleAuthenticationCredential);
  }
  const challenge = () => ({
    challengeId: randomUUID(),
    nonce: 'n'.repeat(40),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  it('retains an ambiguous request after a rejected retry and gates session hydration on restart', async () => {
    const owner = session();
    const operationId = randomUUID();
    store.value = JSON.stringify(owner);
    const client = new ApiClient();
    client.session = owner;
    appleProof();
    let attempt = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/challenge')) return json(challenge());
        if (++attempt === 1) throw new Error('response lost after server accepted');
        return json(
          { error: { code: 'wrong_apple_owner', message: 'Confirm the original Apple account.' } },
          403,
        );
      }),
    );
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(
      client.requestAccountDeletion(owner.user.id, operationId, () => {}),
    ).rejects.toMatchObject({ status: 0 });
    await expect(
      client.requestAccountDeletion(owner.user.id, operationId, () => {}),
    ).rejects.toMatchObject({ status: 403 });
    expect(client.deletionRecovery()?.operationId).toBe(operationId);
    const restarted = new ApiClient();
    expect(await restarted.initialize()).toBeNull();
    expect(restarted.deletionRecovery()?.ownerId).toBe(owner.user.id);
    expect(store.value).toBe(JSON.stringify(owner));
  });
  it('sends fresh Apple authorization, preserves the original retry ID, and distinguishes pending from completed', async () => {
    const owner = session();
    const operationId = randomUUID();
    const receiptId = randomUUID();
    const client = new ApiClient();
    client.session = owner;
    store.value = JSON.stringify(owner);
    appleProof();
    const receipt = {
      requestId: receiptId,
      ownerId: owner.user.id,
      status: 'pending',
      requestedAt: new Date().toISOString(),
      completedAt: null,
      estimatedCompletionDays: null,
      actionRequired: 'none',
    };
    const fetcher = vi.fn(async (url: string) =>
      json(url.endsWith('/challenge') ? challenge() : receipt),
    );
    vi.stubGlobal('fetch', fetcher);
    expect((await client.requestAccountDeletion(owner.user.id, operationId, () => {})).status).toBe(
      'pending',
    );
    expect(client.deletionRecovery()?.operationId).toBe(operationId);
    expect(client.deletionRecovery()?.localCleared).toBe(false);
    expect(client.session).toBe(owner);
    const posted = fetcher.mock.calls.find(([url]) => url.endsWith('/account/deletion'));
    expect(posted).toBeDefined();
    // The public deletion endpoint must not replace an existing session with a different Apple identity.
    const rawCalls = vi.mocked(globalThis.fetch).mock.calls;
    expect(
      JSON.parse(
        String(rawCalls.find(([url]) => String(url).endsWith('/account/deletion'))?.[1]?.body),
      ),
    ).toMatchObject({
      operationId,
      ownerId: owner.user.id,
      authorizationCode: 'fresh-authorization-code',
    });
  });
  it('refuses to clear another account’s saved credentials', async () => {
    const deleted = session();
    const other = session();
    const client = new ApiClient();
    store.value = JSON.stringify(other);
    await expect(client.forgetDeletedAccount(deleted.user.id)).rejects.toThrow('Another account');
    expect(store.value).toBe(JSON.stringify(other));
  });
});
