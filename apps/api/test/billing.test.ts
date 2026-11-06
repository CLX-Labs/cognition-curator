import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@recollect/db';
import {
  VerificationException,
  VerificationStatus,
  type JWSTransactionDecodedPayload,
} from '@apple/app-store-server-library';
import {
  AppleBillingService,
  APPLE_TOKEN_APP_ID,
  APPLE_TOKEN_BUNDLE_ID,
  APPLE_TOKEN_PRODUCT_ID,
  createAppleBillingVerifier,
  type AppleBillingConfig,
  type AppleBillingVerifier,
} from '../src/billing.js';

const now = new Date('2026-10-28T12:00:00.000Z');
const owner = randomUUID();
const config: AppleBillingConfig = {
  enabled: true,
  environment: 'Production',
  bundleId: APPLE_TOKEN_BUNDLE_ID,
  appAppleId: APPLE_TOKEN_APP_ID,
  productId: APPLE_TOKEN_PRODUCT_ID,
};
const decoded = (): JWSTransactionDecodedPayload => ({
  transactionId: '1000000000001',
  originalTransactionId: '1000000000000',
  bundleId: config.bundleId,
  productId: config.productId,
  environment: 'Production',
  type: 'Auto-Renewable Subscription',
  inAppOwnershipType: 'PURCHASED',
  appAccountToken: owner,
  purchaseDate: now.getTime() - 60_000,
  signedDate: now.getTime(),
  expiresDate: now.getTime() + 30 * 86_400_000,
});
const noDatabase = () =>
  ({
    connect: vi.fn(() => {
      throw new Error('Unexpected database write');
    }),
  }) as unknown as Database;
function service(payload = decoded(), settings = config) {
  const db = noDatabase();
  const verifier: AppleBillingVerifier = {
    verifyAndDecodeTransaction: vi.fn(async () => payload),
    verifyAndDecodeNotification: vi.fn(async () => ({})),
  };
  return {
    db,
    verifier,
    billing: new AppleBillingService(db, settings, { verifier, now: () => now }),
  };
}

describe('Apple purchase trust boundary', () => {
  it('fails closed while billing is disabled without Apple or database calls', async () => {
    const { db, verifier, billing } = service(decoded(), { ...config, enabled: false });
    await expect(billing.purchase(owner, 'untrusted')).rejects.toMatchObject({
      code: 'billing_unavailable',
      statusCode: 503,
    });
    expect(verifier.verifyAndDecodeTransaction).not.toHaveBeenCalled();
    expect(db.connect).not.toHaveBeenCalled();
  });

  it('loads pinned Apple trust anchors and rejects a fabricated unsigned transaction', async () => {
    const verifier = createAppleBillingVerifier(config);
    const fabricated = [
      Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
      Buffer.from(JSON.stringify(decoded())).toString('base64url'),
      '',
    ].join('.');
    await expect(verifier.verifyAndDecodeTransaction(fabricated)).rejects.toBeDefined();
  });

  it.each([
    ['another account', { appAccountToken: randomUUID() }],
    ['missing account binding', { appAccountToken: undefined }],
    ['another bundle', { bundleId: 'another.app' }],
    ['another product', { productId: 'another.product' }],
    ['sandbox on production', { environment: 'Sandbox' }],
    ['local StoreKit test', { environment: 'Xcode' }],
    ['non-subscription', { type: 'Consumable' }],
    ['family sharing', { inAppOwnershipType: 'FAMILY_SHARED' }],
    ['missing transaction identifier', { transactionId: undefined }],
    ['invalid transaction identifier', { transactionId: 'client-generated-id' }],
    ['missing original identifier', { originalTransactionId: undefined }],
    ['invalid dates', { purchaseDate: Number.NaN }],
    ['invalid subscription period', { expiresDate: now.getTime() - 60_000 }],
    ['future purchase', { purchaseDate: now.getTime() + 3_600_000 }],
    ['future signature', { signedDate: now.getTime() + 3_600_000 }],
    ['future refund', { revocationDate: now.getTime() + 3_600_000 }],
    ['unexpected quantity', { quantity: 10 }],
  ])('rejects %s before touching the wallet', async (_label, overrides) => {
    const { db, billing } = service({ ...decoded(), ...overrides });
    await expect(
      billing.purchase(owner, 'signed-but-invalid-for-this-purchase'),
    ).rejects.toMatchObject({ code: 'invalid_apple_purchase' });
    expect(db.connect).not.toHaveBeenCalled();
  });

  it('does not trust an invalid Apple signature', async () => {
    const { verifier, db, billing } = service();
    vi.mocked(verifier.verifyAndDecodeTransaction).mockRejectedValue(
      new VerificationException(VerificationStatus.INVALID_CERTIFICATE),
    );
    await expect(billing.purchase(owner, 'forged')).rejects.toMatchObject({
      code: 'invalid_apple_purchase',
    });
    expect(db.connect).not.toHaveBeenCalled();
  });

  it('makes temporary Apple certificate-check failures retryable', async () => {
    const { verifier, billing } = service();
    vi.mocked(verifier.verifyAndDecodeTransaction).mockRejectedValue(
      new VerificationException(VerificationStatus.RETRYABLE_VERIFICATION_FAILURE),
    );
    await expect(billing.purchase(owner, 'temporarily-unverifiable')).rejects.toMatchObject({
      statusCode: 503,
    });
  });

  it('authenticates notifications before decoding their nested transaction', async () => {
    const { verifier, billing } = service();
    vi.mocked(verifier.verifyAndDecodeNotification).mockRejectedValue(
      new Error('signature invalid'),
    );
    await expect(billing.notification('forged')).rejects.toMatchObject({
      code: 'invalid_apple_purchase',
    });
    expect(verifier.verifyAndDecodeTransaction).not.toHaveBeenCalled();
  });

  it('does not grant from signed renewal-preference or expiration messages', async () => {
    const { verifier, db, billing } = service();
    vi.mocked(verifier.verifyAndDecodeNotification).mockResolvedValue({
      notificationUUID: randomUUID(),
      version: '2.0',
      signedDate: now.getTime(),
      notificationType: 'EXPIRED',
      data: { bundleId: config.bundleId, appAppleId: config.appAppleId, environment: 'Production' },
    });
    await expect(billing.notification('signed')).resolves.toEqual({ received: true });
    expect(verifier.verifyAndDecodeTransaction).not.toHaveBeenCalled();
    expect(db.connect).not.toHaveBeenCalled();
  });

  it('rejects another app or environment in the signed notification envelope', async () => {
    const { verifier, billing } = service();
    vi.mocked(verifier.verifyAndDecodeNotification).mockResolvedValue({
      notificationUUID: randomUUID(),
      version: '2.0',
      signedDate: now.getTime(),
      notificationType: 'DID_RENEW',
      data: {
        bundleId: config.bundleId,
        appAppleId: config.appAppleId,
        environment: 'Sandbox',
        signedTransactionInfo: 'nested',
      },
    });
    await expect(billing.notification('signed')).rejects.toMatchObject({
      code: 'invalid_apple_purchase',
    });
    expect(verifier.verifyAndDecodeTransaction).not.toHaveBeenCalled();
  });
});
