import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  captureGenerationToken,
  createDatabase,
  grantPurchasedTokens,
  releaseGenerationToken,
  reserveGenerationToken,
  revokePurchasedTokens,
  reversePurchasedTokenRefund,
  rewardMarketplaceDownload,
  tokenBalance,
  transaction,
  type Database,
  type Transaction,
} from '../src/index.js';
import { migrate } from '../src/migrate.js';

describe.skipIf(!process.env.TEST_DATABASE_URL)('transactional generation token ledger', () => {
  let db: Database;
  const now = new Date('2026-10-28T12:00:00.000Z');
  const purchase = (suffix = '1') => ({
    transactionId: `verified-transaction-${suffix}`,
    originalTransactionId: 'verified-subscription-chain',
    productId: 'collect.software.recollect.tokens.monthly',
    environment: 'Production',
    purchasedAt: '2026-10-28T00:00:00.000Z',
    expiresAt: '2026-11-28T00:00:00.000Z',
    signedAt: '2026-10-28T00:01:00.000Z',
  });
  beforeAll(async () => {
    db = createDatabase(process.env.TEST_DATABASE_URL!);
    await db.query('DROP SCHEMA IF EXISTS recollect CASCADE');
    await migrate(db);
  });
  beforeEach(async () => {
    await db.query('TRUNCATE recollect.users CASCADE');
  });
  afterAll(async () => {
    await db?.end();
  });
  async function user() {
    const id = randomUUID();
    await db.query("INSERT INTO recollect.users(id,name) VALUES($1,'Token test learner')", [id]);
    return id;
  }
  async function job(owner: string, status = 'succeeded') {
    const id = randomUUID(),
      deckId = randomUUID();
    await db.query("INSERT INTO recollect.decks(owner_id,id,data) VALUES($1,$2,'{}')", [
      owner,
      deckId,
    ]);
    await db.query(
      `INSERT INTO recollect.generation_jobs(id,owner_id,deck_id,operation_id,payload_hash,prompt,card_count,status)
       VALUES($1,$2,$3,$4,'test-hash','Subject',5,$5)`,
      [id, owner, deckId, randomUUID(), status],
    );
    return id;
  }
  const wallet = (owner: string, at = now) => transaction(db, (tx) => tokenBalance(tx, owner, at));
  const work = <T>(fn: (tx: Transaction) => Promise<T>) => transaction(db, fn);

  it('grants exactly ten once per UTC calendar month without rolling unused free tokens', async () => {
    const owner = await user();
    const october = await wallet(owner, new Date('2026-10-31T23:59:59.999Z'));
    expect(october).toMatchObject({
      available: 10,
      free: 10,
      reserved: 0,
      freeResetsAt: '2026-11-01T00:00:00.000Z',
    });
    expect(await wallet(owner, new Date('2026-11-01T00:00:00.000Z'))).toMatchObject({
      available: 10,
      free: 10,
    });
    expect(await wallet(owner, new Date('2026-11-15T00:00:00.000Z'))).toMatchObject({
      available: 10,
      free: 10,
    });
    expect(
      (await db.query('SELECT COUNT(*)::int AS n FROM recollect.token_grants')).rows[0].n,
    ).toBe(2);
  });

  it('reserves at generation, charges once for the entire accepted job, and never refunds a charge', async () => {
    const owner = await user(),
      id = await job(owner);
    await work(async (tx) => {
      await reserveGenerationToken(tx, owner, id, now);
      await reserveGenerationToken(tx, owner, id, now);
    });
    expect(await wallet(owner)).toMatchObject({ available: 9, reserved: 1 });
    expect(await work((tx) => captureGenerationToken(tx, owner, id, now))).toBe(true);
    expect(await work((tx) => captureGenerationToken(tx, owner, id, now))).toBe(false);
    await work((tx) => releaseGenerationToken(tx, owner, id, now));
    expect(await wallet(owner)).toMatchObject({ available: 9, reserved: 0 });
    expect((await db.query('SELECT consumed FROM recollect.token_grants')).rows[0].consumed).toBe(
      1,
    );
  });

  it('rolls back a failed acceptance together with its token capture', async () => {
    const owner = await user(),
      id = await job(owner);
    await work((tx) => reserveGenerationToken(tx, owner, id, now));
    await expect(
      work(async (tx) => {
        await captureGenerationToken(tx, owner, id, now);
        throw new Error('card insert failed');
      }),
    ).rejects.toThrow('card insert failed');
    expect(await wallet(owner)).toMatchObject({ available: 9, reserved: 1 });
    expect(await work((tx) => captureGenerationToken(tx, owner, id, now))).toBe(true);
  });

  it('refuses an eleventh reservation and database constraints prevent negative spend bounds', async () => {
    const owner = await user();
    for (let i = 0; i < 10; i++) {
      const id = await job(owner);
      await work((tx) => reserveGenerationToken(tx, owner, id, now));
    }
    const extra = await job(owner);
    await expect(work((tx) => reserveGenerationToken(tx, owner, extra, now))).rejects.toMatchObject(
      { code: 'tokens_exhausted', statusCode: 402 },
    );
    expect(await wallet(owner)).toMatchObject({ available: 0, reserved: 10 });
    await expect(db.query('UPDATE recollect.token_grants SET consumed=-1')).rejects.toThrow();
    await expect(db.query('UPDATE recollect.token_grants SET consumed=amount+1')).rejects.toThrow();
  });

  it.skipIf(process.env.RECOLLECT_EMBEDDED_TEST === 'true')(
    'serializes concurrent wallet reservations across independent connections',
    async () => {
      const owner = await user();
      const ids = await Promise.all(Array.from({ length: 12 }, () => job(owner)));
      const results = await Promise.allSettled(
        ids.map((id) => work((tx) => reserveGenerationToken(tx, owner, id, now))),
      );
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(10);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(2);
      expect(await wallet(owner)).toMatchObject({ available: 0, reserved: 10 });
    },
  );

  it('releases failed and canceled jobs, and abandoned reservations expire after one day', async () => {
    const owner = await user(),
      failed = await job(owner, 'running'),
      canceled = await job(owner),
      old = await job(owner);
    await work(async (tx) => {
      await reserveGenerationToken(tx, owner, failed, now);
      await reserveGenerationToken(tx, owner, canceled, now);
      await reserveGenerationToken(tx, owner, old, now);
    });
    await db.query("UPDATE recollect.generation_jobs SET status='failed' WHERE id=$1", [failed]);
    await db.query("UPDATE recollect.generation_jobs SET status='canceled' WHERE id=$1", [
      canceled,
    ]);
    expect(await wallet(owner)).toMatchObject({ available: 9, reserved: 1 });
    const later = new Date(now.getTime() + 24 * 3600_000);
    expect(await wallet(owner, later)).toMatchObject({ available: 10, reserved: 0 });
    expect(await work((tx) => captureGenerationToken(tx, owner, old, later))).toBe(true);
    expect(await wallet(owner, later)).toMatchObject({ available: 9, reserved: 0 });
  });

  it('expires old free holds at UTC reset and charges an old draft from the new allowance', async () => {
    const owner = await user(),
      id = await job(owner);
    const end = new Date('2026-10-31T23:59:59.000Z'),
      next = new Date('2026-11-01T00:00:00.000Z');
    await work((tx) => reserveGenerationToken(tx, owner, id, end));
    expect(await wallet(owner, end)).toMatchObject({ available: 9, reserved: 1 });
    expect(await work((tx) => captureGenerationToken(tx, owner, id, next))).toBe(true);
    expect(await wallet(owner, next)).toMatchObject({ available: 9, reserved: 0 });
    const grants = (
      await db.query('SELECT consumed FROM recollect.token_grants ORDER BY created_at')
    ).rows;
    expect(grants.map((grant) => grant.consumed)).toEqual([0, 1]);
  });

  it('paid allowances replace unused free tokens, grant once per transaction, and never expire', async () => {
    const owner = await user(),
      id = await job(owner);
    await work((tx) => reserveGenerationToken(tx, owner, id, now));
    expect(await work((tx) => grantPurchasedTokens(tx, owner, purchase(), now))).toBe(true);
    expect(await work((tx) => grantPurchasedTokens(tx, owner, purchase(), now))).toBe(false);
    expect(await wallet(owner)).toMatchObject({
      available: 100,
      paid: 100,
      free: 0,
      reserved: 0,
      subscription: { active: true },
    });
    expect(await wallet(owner, new Date('2026-11-01T00:00:00.000Z'))).toMatchObject({
      available: 100,
      free: 0,
    });
    expect(await wallet(owner, new Date('2026-11-28T00:00:00.000Z'))).toMatchObject({
      available: 110,
      paid: 100,
      free: 10,
      subscription: { active: false },
    });
    const renewal = {
      ...purchase('2'),
      purchasedAt: '2026-11-28T00:00:00.000Z',
      expiresAt: '2026-12-28T00:00:00.000Z',
    };
    await work((tx) =>
      grantPurchasedTokens(tx, owner, renewal, new Date('2026-11-28T00:00:00.000Z')),
    );
    expect(await wallet(owner, new Date('2026-11-28T00:00:00.000Z'))).toMatchObject({
      available: 200,
      paid: 200,
      free: 0,
    });
  });

  it('binds all transactions in a subscription chain to one account', async () => {
    const owner = await user(),
      other = await user();
    await work((tx) => grantPurchasedTokens(tx, owner, purchase(), now));
    await expect(
      work((tx) => grantPurchasedTokens(tx, other, purchase('2'), now)),
    ).rejects.toMatchObject({ code: 'subscription_owner_mismatch' });
    expect(await wallet(other)).toMatchObject({ available: 10, paid: 0 });
  });

  it('refunds retire unused credits without negative balances and stale replay cannot restore them', async () => {
    const owner = await user(),
      id = await job(owner);
    await work((tx) => grantPurchasedTokens(tx, owner, purchase(), now));
    await work((tx) => captureGenerationToken(tx, owner, id, now));
    await work((tx) => revokePurchasedTokens(tx, owner, purchase().transactionId, now));
    expect(await wallet(owner)).toMatchObject({ available: 10, paid: 0, reserved: 0 });
    expect(await work((tx) => grantPurchasedTokens(tx, owner, purchase(), now))).toBe(false);
    expect(await wallet(owner)).toMatchObject({ paid: 0 });
    expect(
      (await db.query("SELECT consumed FROM recollect.token_grants WHERE source='paid'")).rows[0]
        .consumed,
    ).toBe(1);
  });

  it('records a refund-before-purchase tombstone and never grants on later delivery', async () => {
    const owner = await user();
    await work((tx) => grantPurchasedTokens(tx, owner, { ...purchase(), revokedAt: now }, now));
    await work((tx) => grantPurchasedTokens(tx, owner, purchase(), now));
    expect(await wallet(owner)).toMatchObject({ available: 10, paid: 0 });
  });

  it('verified refund reversals restore only unspent original credits and order later events', async () => {
    const owner = await user();
    await work((tx) => grantPurchasedTokens(tx, owner, purchase(), now));
    for (let count = 0; count < 3; count++) {
      const id = await job(owner);
      await work((tx) => captureGenerationToken(tx, owner, id, now));
    }
    const refund = {
      ...purchase(),
      revokedAt: '2026-10-28T11:00:00.000Z',
      refundEventSignedAt: '2026-10-28T11:01:00.000Z',
    };
    await work((tx) => grantPurchasedTokens(tx, owner, refund, now));
    expect(await wallet(owner)).toMatchObject({ paid: 0 });
    const reversedAt = '2026-10-28T11:20:00.000Z';
    expect(
      await work((tx) =>
        reversePurchasedTokenRefund(
          tx,
          owner,
          purchase(),
          { notificationSignedAt: reversedAt },
          now,
        ),
      ),
    ).toBe(true);
    expect(await wallet(owner)).toMatchObject({ paid: 97 });
    expect(
      await work((tx) =>
        reversePurchasedTokenRefund(
          tx,
          owner,
          purchase(),
          { notificationSignedAt: reversedAt },
          now,
        ),
      ),
    ).toBe(false);
    await work((tx) => grantPurchasedTokens(tx, owner, refund, now));
    await work((tx) =>
      grantPurchasedTokens(tx, owner, { ...purchase(), revokedAt: refund.revokedAt }, now),
    );
    expect(await wallet(owner)).toMatchObject({ paid: 97 });

    const secondRefund = {
      ...refund,
      revokedAt: '2026-10-28T11:30:00.000Z',
      refundEventSignedAt: '2026-10-28T11:31:00.000Z',
    };
    await work((tx) => grantPurchasedTokens(tx, owner, secondRefund, now));
    expect(await wallet(owner)).toMatchObject({ paid: 0 });
    expect(
      await work((tx) =>
        reversePurchasedTokenRefund(
          tx,
          owner,
          purchase(),
          { notificationSignedAt: reversedAt },
          now,
        ),
      ),
    ).toBe(false);
    expect(await wallet(owner)).toMatchObject({ paid: 0 });
    expect(
      await work((tx) =>
        reversePurchasedTokenRefund(
          tx,
          owner,
          purchase(),
          { notificationSignedAt: '2026-10-28T11:40:00.000Z' },
          now,
        ),
      ),
    ).toBe(true);
    expect(await wallet(owner)).toMatchObject({ paid: 97 });
    const grants = (
      await db.query("SELECT amount,consumed FROM recollect.token_grants WHERE source='paid'")
    ).rows;
    expect(grants).toEqual([{ amount: 100, consumed: 3 }]);
  });

  it('a reversal delivered first preserves its tombstone against the original refunded receipt', async () => {
    const owner = await user();
    await work((tx) =>
      reversePurchasedTokenRefund(
        tx,
        owner,
        purchase(),
        { notificationSignedAt: '2026-10-28T11:20:00.000Z' },
        now,
      ),
    );
    await work((tx) =>
      grantPurchasedTokens(
        tx,
        owner,
        {
          ...purchase(),
          revokedAt: '2026-10-28T11:00:00.000Z',
          refundEventSignedAt: '2026-10-28T11:01:00.000Z',
        },
        now,
      ),
    );
    expect(await wallet(owner)).toMatchObject({ paid: 100, available: 100 });
    expect(
      (await db.query("SELECT COUNT(*)::int AS n FROM recollect.token_grants WHERE source='paid'"))
        .rows[0].n,
    ).toBe(1);
  });

  it('refund wins equal timestamps regardless of notification delivery order', async () => {
    const owner = await user(),
      event = '2026-10-28T11:20:00.000Z';
    await work((tx) =>
      reversePurchasedTokenRefund(tx, owner, purchase(), { notificationSignedAt: event }, now),
    );
    await work((tx) =>
      grantPurchasedTokens(
        tx,
        owner,
        { ...purchase(), revokedAt: event, refundEventSignedAt: event },
        now,
      ),
    );
    expect(
      await work((tx) =>
        reversePurchasedTokenRefund(tx, owner, purchase(), { notificationSignedAt: event }, now),
      ),
    ).toBe(false);
    expect(await wallet(owner)).toMatchObject({ paid: 0 });
  });

  it('rewards only one other-account download per source deck across new listings and copy removal', async () => {
    const owner = await user(),
      recipient = await user(),
      source = randomUUID();
    expect(
      await work((tx) =>
        rewardMarketplaceDownload(tx, owner, owner, source, randomUUID(), randomUUID(), now),
      ),
    ).toBe(false);
    expect(
      await work((tx) =>
        rewardMarketplaceDownload(tx, owner, recipient, source, randomUUID(), randomUUID(), now),
      ),
    ).toBe(true);
    expect(
      await work((tx) =>
        rewardMarketplaceDownload(tx, owner, recipient, source, randomUUID(), randomUUID(), now),
      ),
    ).toBe(false);
    expect(await wallet(owner)).toMatchObject({ available: 11, earned: 1 });
    expect(await wallet(owner, new Date('2026-11-01T00:00:00.000Z'))).toMatchObject({
      available: 11,
      earned: 1,
    });
    await db.query('DELETE FROM recollect.users WHERE id=$1', [recipient]);
    expect(await wallet(owner)).toMatchObject({ earned: 1 });
  });

  it('rejects inactive and erased accounts without creating free grants', async () => {
    const owner = await user();
    await db.query('UPDATE recollect.users SET is_active=false WHERE id=$1', [owner]);
    await expect(wallet(owner)).rejects.toMatchObject({ code: 'account_inactive' });
    await expect(wallet(randomUUID())).rejects.toMatchObject({ code: 'account_inactive' });
    expect(
      (await db.query('SELECT COUNT(*)::int AS n FROM recollect.token_grants')).rows[0].n,
    ).toBe(0);
  });
});
