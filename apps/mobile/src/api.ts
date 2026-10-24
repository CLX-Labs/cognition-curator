import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import {
  ALGORITHM_VERSION,
  appleChallengeSchema,
  accountDeletionReceiptSchema,
  sessionSchema,
  type AccountDeletionReceipt,
  type Session,
} from '@recollect/contracts';
import { release } from './release';

const SESSION_KEY = 'recollect.session.v2';
const DELETION_KEY = 'recollect.accountDeletion.v1';
export type AccountDeletionRecovery = {
  ownerId: string;
  operationId: string;
  receipt?: AccountDeletionReceipt;
  localCleared: boolean;
};
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}
type Listener = (session: Session | null) => void;
export const developmentAuthEnabled = __DEV__ && process.env.EXPO_PUBLIC_ENABLE_DEV_AUTH === 'true';

function baseUrl() {
  // Pin installed releases to the origin stamped by CI, independent of which
  // EAS environment or local dotenv file the bundler happened to load.
  const value = ((!__DEV__ && release.apiUrl) || process.env.EXPO_PUBLIC_API_URL)?.replace(
    /\/$/,
    '',
  );
  if (!value)
    throw new Error('The API address is not configured. Set EXPO_PUBLIC_API_URL for this build.');
  const url = new URL(value);
  if (
    (url.protocol !== 'https:' && !(__DEV__ && url.protocol === 'http:')) ||
    url.username ||
    url.password
  ) {
    throw new Error('A secure HTTPS API address is required.');
  }
  return value;
}
async function responseBody(response: Response) {
  if (response.status === 204) return null;
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const data = body as { error?: { message?: string; code?: string }; message?: string } | null;
    throw new ApiError(
      data?.error?.message ?? data?.message ?? 'The request could not be completed.',
      response.status,
      data?.error?.code,
    );
  }
  return body;
}

export class ApiClient {
  session: Session | null = null;
  private listeners = new Set<Listener>();
  private refreshFlight: Promise<Session> | null = null;
  private epoch = 0;
  private storageTail: Promise<unknown> = Promise.resolve();
  private deletionRecoveries: AccountDeletionRecovery[] = [];
  deletionRecovery(ownerId?: string) {
    return ownerId
      ? (this.deletionRecoveries.find((item) => item.ownerId === ownerId) ?? null)
      : (this.deletionRecoveries.find((item) => !item.localCleared) ??
          this.deletionRecoveries.at(-1) ??
          null);
  }
  private async saveDeletionRecovery(record: AccountDeletionRecovery) {
    await this.store(async () => {
      const next = [
        ...this.deletionRecoveries.filter((item) => item.ownerId !== record.ownerId),
        record,
      ];
      await SecureStore.setItemAsync(DELETION_KEY, JSON.stringify(next), {
        keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
      });
      this.deletionRecoveries = next;
    });
  }
  private store<T>(work: () => Promise<T>) {
    const next = this.storageTail.then(work);
    this.storageTail = next.catch(() => undefined);
    return next;
  }
  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private emit() {
    for (const listener of this.listeners) listener(this.session);
  }
  async initialize() {
    const generation = this.epoch;
    const deletionRaw = await SecureStore.getItemAsync(DELETION_KEY);
    if (deletionRaw) {
      const records: unknown = JSON.parse(deletionRaw);
      if (!Array.isArray(records))
        throw new Error('Account deletion recovery could not be read. Contact support.');
      this.deletionRecoveries = records.map((record: unknown) => {
        const value = record as AccountDeletionRecovery;
        if (
          !value ||
          !/^[0-9a-f-]{36}$/i.test(value.ownerId) ||
          !/^[0-9a-f-]{36}$/i.test(value.operationId) ||
          typeof value.localCleared !== 'boolean'
        )
          throw new Error('Account deletion recovery could not be read. Contact support.');
        return {
          ownerId: value.ownerId,
          operationId: value.operationId,
          localCleared: value.localCleared,
          ...(value.receipt ? { receipt: accountDeletionReceiptSchema.parse(value.receipt) } : {}),
        };
      });
      if (this.deletionRecoveries.some((record) => !record.localCleared)) return null;
    }
    const raw = await SecureStore.getItemAsync(SESSION_KEY);
    if (generation !== this.epoch) return this.session;
    if (!raw) return null;
    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch {
      decoded = null;
    }
    const parsed = sessionSchema.safeParse(decoded);
    if (!parsed.success) {
      await this.store(() => SecureStore.deleteItemAsync(SESSION_KEY));
      return null;
    }
    this.session = parsed.data;
    this.emit();
    return this.session;
  }
  private async requestRaw(
    path: string,
    options: { method?: string; body?: unknown; token?: string } = {},
  ) {
    if (!path.startsWith('/v1/')) throw new Error('Invalid API route.');
    const origin = baseUrl();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);
    try {
      const response = await fetch(origin + path, {
        method: options.method ?? 'GET',
        headers: {
          Accept: 'application/json',
          'X-Recollect-Scheduler': ALGORITHM_VERSION,
          'X-Recollect-Deck-Images': '1',
          ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(options.token ? { Authorization: 'Bearer ' + options.token } : {}),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      }).catch(() => {
        const code = controller.signal.aborted ? 'request_timeout' : 'network_unavailable';
        console.warn('[Recollect API]', {
          code,
          host: new URL(origin).hostname,
          route: path.split('?')[0],
        });
        throw new ApiError(
          code === 'request_timeout'
            ? 'Recollect took too long to respond. Your request is saved; try again.'
            : 'Cannot connect to Recollect. Your request is saved. Check your connection and try again.',
          0,
          code,
        );
      });
      return await responseBody(response);
    } finally {
      clearTimeout(timeout);
    }
  }
  private async saveSession(session: Session, expectedEpoch?: number) {
    return this.store(async () => {
      if (expectedEpoch !== undefined && expectedEpoch !== this.epoch)
        throw new Error('The signed-in account changed.');
      await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session), {
        keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
      });
      if (expectedEpoch !== undefined && expectedEpoch !== this.epoch)
        throw new Error('The signed-in account changed.');
      this.session = session;
      this.emit();
      return session;
    });
  }
  async signInApple() {
    const generation = ++this.epoch;
    const challenge = appleChallengeSchema.parse(
      await this.requestRaw('/v1/auth/apple/challenge', { method: 'POST' }),
    );
    const nonce = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      challenge.nonce,
    );
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce,
    });
    if (!credential.identityToken)
      throw new Error('Apple did not return an identity token. Please try again.');
    const displayName = [credential.fullName?.givenName, credential.fullName?.familyName]
      .filter(Boolean)
      .join(' ');
    const session = sessionSchema.parse(
      await this.requestRaw('/v1/auth/apple', {
        method: 'POST',
        body: {
          challengeId: challenge.challengeId,
          identityToken: credential.identityToken,
          ...(displayName ? { displayName } : {}),
        },
      }),
    );
    return this.saveSession(session, generation);
  }
  async signInDevelopment(email: string) {
    if (!developmentAuthEnabled) throw new Error('Development authentication is disabled.');
    const generation = ++this.epoch;
    const session = sessionSchema.parse(
      await this.requestRaw('/v1/auth/development', { method: 'POST', body: { email } }),
    );
    return this.saveSession(session, generation);
  }
  async refresh(): Promise<Session> {
    if (this.refreshFlight) return this.refreshFlight;
    const previous = this.session;
    const generation = this.epoch;
    if (!previous) throw new ApiError('Sign in to synchronize your cards.', 401);
    const flight = (async () => {
      try {
        const next = sessionSchema.parse(
          await this.requestRaw('/v1/auth/refresh', {
            method: 'POST',
            body: { refreshToken: previous.refreshToken },
          }),
        );
        if (next.user.id !== previous.user.id)
          throw new Error('The refreshed session has a different account.');
        return await this.saveSession(next, generation);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401 && this.epoch === generation) {
          ++this.epoch;
          this.session = null;
          this.emit();
          await this.store(() => SecureStore.deleteItemAsync(SESSION_KEY));
        }
        throw error;
      }
    })();
    this.refreshFlight = flight;
    try {
      return await flight;
    } finally {
      if (this.refreshFlight === flight) this.refreshFlight = null;
    }
  }
  async request(path: string, options: { method?: string; body?: unknown; ownerId?: string } = {}) {
    const generation = this.epoch;
    const ownerId = this.session?.user.id;
    if (!ownerId) throw new ApiError('Sign in to synchronize your cards.', 401);
    if (options.ownerId !== undefined && options.ownerId !== ownerId)
      throw new Error('The signed-in account changed.');
    const assertOwner = (candidate?: Session) => {
      if (
        generation !== this.epoch ||
        this.session?.user.id !== ownerId ||
        (candidate && candidate.user.id !== ownerId)
      ) {
        throw new Error('The signed-in account changed.');
      }
    };
    let session = this.session!;
    if (new Date(session.expiresAt).getTime() < Date.now() + 60_000) session = await this.refresh();
    assertOwner(session);
    let result: unknown;
    try {
      result = await this.requestRaw(path, { ...options, token: session.accessToken });
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
      // A fresh Apple assertion is required; rotating the refresh token cannot
      // satisfy this step-up authentication boundary.
      if (error.code === 'reauthentication_required') throw error;
      assertOwner();
      const renewed = await this.refresh();
      assertOwner(renewed);
      result = await this.requestRaw(path, { ...options, token: renewed.accessToken });
    }
    assertOwner();
    return result;
  }
  async logout() {
    const previous = this.session;
    ++this.epoch;
    this.session = null;
    this.refreshFlight = null;
    this.emit();
    await this.store(() => SecureStore.deleteItemAsync(SESSION_KEY));
    if (previous) {
      // Local sign-out succeeds offline. Tokens are never replayed as another owner.
      await this.requestRaw('/v1/auth/logout', {
        method: 'POST',
        token: previous.accessToken,
      }).catch(() => undefined);
    }
  }
  async requestAccountDeletion(
    ownerId: string,
    operationId: string,
    prepared: (record: AccountDeletionRecovery) => void,
  ) {
    const generation = this.epoch;
    if (this.session && this.session.user.id !== ownerId)
      throw new Error('Sign out of the other account before continuing this deletion request.');
    const challenge = appleChallengeSchema.parse(
      await this.requestRaw('/v1/auth/apple/challenge', { method: 'POST' }),
    );
    const nonce = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      challenge.nonce,
    );
    const credential = await AppleAuthentication.signInAsync({ requestedScopes: [], nonce });
    if (!credential.identityToken)
      throw new Error('Apple did not return an identity token. Please try again.');
    if (generation !== this.epoch || (this.session && this.session.user.id !== ownerId))
      throw new Error('The signed-in account changed. The deletion request was not sent.');
    // The server verifies that the fresh Apple proof matches ownerId. This method
    // never installs a session for a different Apple account.
    const previous = this.deletionRecovery(ownerId);
    const marker: AccountDeletionRecovery = {
      ...(previous ?? {}),
      ownerId,
      operationId,
      localCleared: previous?.localCleared ?? false,
    };
    await this.saveDeletionRecovery(marker);
    prepared(marker);
    let receipt: AccountDeletionReceipt;
    try {
      receipt = accountDeletionReceiptSchema.parse(
        await this.requestRaw('/v1/account/deletion', {
          method: 'POST',
          body: {
            ownerId,
            operationId,
            challengeId: challenge.challengeId,
            identityToken: credential.identityToken,
            ...(credential.authorizationCode
              ? { authorizationCode: credential.authorizationCode }
              : {}),
          },
        }),
      );
    } catch (cause) {
      if (!previous && cause instanceof ApiError && cause.status >= 400 && cause.status < 500) {
        await this.store(async () => {
          const next = this.deletionRecoveries.filter((item) => item.ownerId !== ownerId);
          await SecureStore.setItemAsync(DELETION_KEY, JSON.stringify(next));
          this.deletionRecoveries = next;
        });
      }
      throw cause;
    }
    if (receipt.ownerId !== ownerId)
      throw new Error('The deletion receipt belongs to a different account. Contact support.');
    await this.saveDeletionRecovery({ ...marker, receipt });
    return receipt;
  }
  async forgetDeletedAccount(ownerId: string) {
    await this.assertDeletionOwner(ownerId);
    ++this.epoch;
    await this.store(async () => {
      const raw = await SecureStore.getItemAsync(SESSION_KEY);
      if (raw) {
        let decoded: unknown;
        try {
          decoded = JSON.parse(raw);
        } catch {
          decoded = null;
        }
        const saved = sessionSchema.safeParse(decoded);
        if (saved.success && saved.data.user.id !== ownerId)
          throw new Error(
            'Another account’s sign-in was preserved. Sign out before finishing this deletion.',
          );
        await SecureStore.deleteItemAsync(SESSION_KEY);
      }
      this.session = null;
      this.refreshFlight = null;
      this.emit();
    });
  }
  async assertDeletionOwner(ownerId: string) {
    if (this.session && this.session.user.id !== ownerId)
      throw new Error('The signed-in account changed. Its data has not been removed.');
    const raw = await SecureStore.getItemAsync(SESSION_KEY);
    if (this.session && this.session.user.id !== ownerId)
      throw new Error('The signed-in account changed. Its data has not been removed.');
    if (!raw) return;
    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch {
      decoded = null;
    }
    const saved = sessionSchema.safeParse(decoded);
    if (saved.success && saved.data.user.id !== ownerId)
      throw new Error('Another account is signed in. Its data has not been changed.');
  }
  async finishDeletionRecovery(ownerId: string) {
    const record = this.deletionRecovery(ownerId);
    if (!record?.receipt)
      throw new Error('Confirm the deletion request before clearing local recovery.');
    await this.saveDeletionRecovery({ ...record, localCleared: true });
  }
}
export const api = new ApiClient();
