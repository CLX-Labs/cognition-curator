import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, tokenBalance, transaction, type Database } from '@recollect/db';
import { migrate } from '@recollect/db/migrate';
import type {
  JWSTransactionDecodedPayload,
  ResponseBodyV2DecodedPayload,
} from '@apple/app-store-server-library';
import {
  AppleBillingService,
  APPLE_TOKEN_APP_ID,
  APPLE_TOKEN_BUNDLE_ID,
  APPLE_TOKEN_PRODUCT_ID,
} from '../src/billing.js';

describe.skipIf(!process.env.TEST_DATABASE_URL)('verified Apple billing ledger delivery', () => {
  let db: Database;
  const now = new Date('2026-10-28T12:00:00.000Z');
  let decoded: JWSTransactionDecodedPayload;
  let notification: ResponseBodyV2DecodedPayload;
  let billing: AppleBillingService;
  const config = {
    enabled: true,
    environment: 'Production' as const,
    bundleId: APPLE_TOKEN_BUNDLE_ID,
    appAppleId: APPLE_TOKEN_APP_ID,
    productId: APPLE_TOKEN_PRODUCT_ID,
  };
  beforeAll(async () => {
    db = createDatabase(process.env.TEST_DATABASE_URL!);
    await db.query('DROP SCHEMA IF EXISTS recollect CASCADE');
    await migrate(db);
  });
  beforeEach(async () => {
    await db.query('TRUNCATE recollect.users CASCADE');
    decoded = {
      transactionId: '1000000000001',
      originalTransactionId: '1000000000000',
      bundleId: config.bundleId,
      productId: config.productId,
      environment: config.environment,
      type: 'Auto-Renewable Subscription',
      inAppOwnershipType: 'PURCHASED',
      purchaseDate: now.getTime() - 60_000,
      signedDate: now.getTime(),
      expiresDate: now.getTime() + 30 * 86_400_000,
    };
    notification = {
      notificationUUID: randomUUID(),
      version: '2.0',
      signedDate: now.getTime(),
      notificationType: 'DID_RENEW',
      data: {
        bundleId: config.bundleId,
        appAppleId: config.appAppleId,
        environment: config.environment,
        signedTransactionInfo: 'verified-nested-jws',
      },
    };
    billing = new AppleBillingService(db, config, {
      now: () => now,
      verifier: {
        verifyAndDecodeTransaction: async () => ({ ...decoded }),
        verifyAndDecodeNotification: async () => ({ ...notification }),
      },
    });
  });
  afterAll(async () => {
    await db?.end();
  });
  async function user() {
    const owner = randomUUID();
    await db.query("INSERT INTO recollect.users(id,name) VALUES($1,'Billing test learner')", [
      owner,
    ]);
    decoded.appAccountToken = owner;
    return owner;
  }
  const wallet = (owner: string) => transaction(db, (tx) => tokenBalance(tx, owner, now));

  it('credits one hundred once across a purchase, restore and concurrent notification', async () => {
    const owner = await user();
    const results = await Promise.all([
      billing.purchase(owner, 'verified'),
      billing.purchase(owner, 'restored'),
      billing.notification('notification'),
    ]);
    expect(results).toHaveLength(3);
    expect(await wallet(owner)).toMatchObject({
      available: 100,
      paid: 100,
      free: 0,
      subscription: { active: true },
    });
    expect(await billing.purchase(owner, 'again')).toEqual({
      transactionId: decoded.transactionId,
      credited: false,
    });
  });

  it('grants a distinct verified renewal once', async () => {
    const owner = await user();
    await billing.purchase(owner, 'first');
    decoded.transactionId = '1000000000002';
    await billing.notification('renewal');
    await billing.notification('renewal-retry');
    expect(await wallet(owner)).toMatchObject({ paid: 200, available: 200 });
  });

  it('restores missed historical paid periods without expiring their unused tokens', async () => {
    const owner = await user();
    decoded.purchaseDate = new Date('2026-08-01T00:00:00Z').getTime();
    decoded.expiresDate = new Date('2026-09-01T00:00:00Z').getTime();
    await billing.purchase(owner, 'historical-paid');
    expect(await wallet(owner)).toMatchObject({
      paid: 100,
      available: 110,
      subscription: { active: false },
    });
  });

  it('cannot credit the same subscription chain to another Recollect account', async () => {
    const first = await user();
    await billing.purchase(first, 'first');
    const other = await user();
    decoded.transactionId = '1000000000002';
    await expect(billing.purchase(other, 'rebound-chain')).rejects.toMatchObject({
      code: 'subscription_owner_mismatch',
    });
    expect(await wallet(other)).toMatchObject({ paid: 0, available: 10 });
  });

  it('refunds before or after delivery never grant or revive purchased tokens', async () => {
    const owner = await user();
    await billing.purchase(owner, 'first');
    decoded.revocationDate = now.getTime();
    notification.notificationType = 'REFUND';
    await billing.notification('refund');
    expect(await wallet(owner)).toMatchObject({ paid: 0, subscription: { active: false } });
    decoded.revocationDate = undefined;
    await billing.purchase(owner, 'old-unrevoked-replay');
    expect(await wallet(owner)).toMatchObject({ paid: 0 });
    decoded.transactionId = '1000000000002';
    decoded.revocationDate = now.getTime();
    await billing.notification('refund-arrives-first');
    decoded.revocationDate = undefined;
    await billing.purchase(owner, 'late-original');
    expect(await wallet(owner)).toMatchObject({ paid: 0 });
  });

  it('does not reactivate a deleted account on a delayed renewal', async () => {
    const owner = await user();
    await db.query('DELETE FROM recollect.users WHERE id=$1', [owner]);
    await expect(billing.notification('late-renewal')).resolves.toEqual({ received: true });
    expect(
      (await db.query('SELECT COUNT(*)::int AS n FROM recollect.token_grants')).rows[0].n,
    ).toBe(0);
  });

  it('restores a reversed refund once and ignores older refund deliveries and client replays', async () => {
    const owner = await user();
    await billing.purchase(owner, 'purchase');
    const refundedAt = now.getTime() - 30_000;
    const reversedAt = now.getTime() - 10_000;
    decoded.revocationDate = refundedAt;
    decoded.signedDate = refundedAt;
    notification.notificationType = 'REFUND';
    notification.signedDate = refundedAt;
    await billing.notification('refund');
    expect(await wallet(owner)).toMatchObject({ paid: 0 });
    decoded.revocationDate = undefined;
    decoded.signedDate = reversedAt;
    notification.notificationType = 'REFUND_REVERSED';
    notification.signedDate = reversedAt;
    await billing.notification('reversal');
    await billing.notification('reversal-retry');
    expect(await wallet(owner)).toMatchObject({ paid: 100, available: 100 });
    decoded.revocationDate = refundedAt;
    decoded.signedDate = refundedAt;
    notification.notificationType = 'REFUND';
    notification.signedDate = refundedAt;
    await billing.notification('old-refund-retry');
    await billing.purchase(owner, 'old-refunded-client-restore');
    expect(await wallet(owner)).toMatchObject({ paid: 100, available: 100 });
  });

  it('handles a refund reversal delivered before the original purchase and refund', async () => {
    const owner = await user();
    notification.notificationType = 'REFUND_REVERSED';
    notification.signedDate = now.getTime() - 10_000;
    await billing.notification('reversal-first');
    expect(await wallet(owner)).toMatchObject({ paid: 100 });
    notification.notificationType = 'REFUND';
    notification.signedDate = now.getTime() - 30_000;
    decoded.revocationDate = now.getTime() - 30_000;
    await billing.notification('old-refund-later');
    decoded.revocationDate = undefined;
    await billing.purchase(owner, 'original-purchase-later');
    expect(await wallet(owner)).toMatchObject({ paid: 100 });
  });
});
