import { randomUUID } from 'node:crypto';
import { DomainError, type Transaction } from './index.js';
import type { TokenBalance } from '@recollect/contracts';
export type { TokenBalance } from '@recollect/contracts';

export const FREE_MONTHLY_TOKENS = 10;
export const PAID_MONTHLY_TOKENS = 100;
const HOLD_MS = 24 * 60 * 60 * 1000;

export interface VerifiedTokenPurchase {
  transactionId: string;
  originalTransactionId: string;
  productId: string;
  purchasedAt: Date | string;
  expiresAt: Date | string;
  environment?: string;
  signedAt?: Date | string;
  revokedAt?: Date | string | null;
  /** Set only from the verified REFUND/REVOKE notification envelope. */
  refundEventSignedAt?: Date | string;
}

/**
 * Helpers serialize the wallet through lockTokenOwner, never through sync_heads.
 * Callers needing lockOwner must acquire it BEFORE invoking any wallet helper;
 * never acquire a sync-head lock after acquiring a wallet lock. Marketplace can
 * hold its recipient sync-head then lock the publisher wallet without locking
 * the publisher sync-head. Helpers never acquire another owner's wallet lock.
 * Inputs describing purchases/downloads must come from verified server records.
 */
export async function lockTokenOwner(tx: Transaction, owner: string): Promise<void> {
  const account = await tx.query<{ is_active: boolean }>(
    'SELECT is_active FROM recollect.users WHERE id=$1 FOR SHARE',
    [owner],
  );
  if (!account.rows[0]?.is_active)
    throw new DomainError('account_inactive', 'This account is no longer active.', 401);
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('recollect.tokens:' || $1,0))", [
    owner,
  ]);
}

function instant(value: Date | string): Date {
  const result = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(result.getTime())) throw new Error('Invalid token ledger timestamp');
  return result;
}

function month(now: Date) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { key: start.toISOString().slice(0, 10), end };
}

async function subscription(tx: Transaction, owner: string, now: Date) {
  const result = await tx.query<{ product_id: string; expires_at: Date }>(
    `SELECT product_id,expires_at FROM recollect.token_purchases
     WHERE owner_id=$1 AND revoked_at IS NULL AND purchased_at <= $2 AND expires_at > $2
     ORDER BY expires_at DESC,transaction_id LIMIT 1`,
    [owner, now],
  );
  const purchase = result.rows[0];
  return {
    active: Boolean(purchase),
    productId: purchase?.product_id ?? null,
    renewsAt: purchase?.expires_at.toISOString() ?? null,
  };
}

async function reconcile(tx: Transaction, owner: string, now: Date) {
  // Captured rows are permanent charge receipts; only unspent reservations expire.
  await tx.query(
    `UPDATE recollect.token_generation_holds h SET state='released',updated_at=$2
     FROM recollect.token_grants g,recollect.generation_jobs j
     WHERE h.owner_id=$1 AND h.state='reserved' AND g.id=h.grant_id AND j.id=h.job_id
       AND (h.expires_at <= $2 OR g.revoked_at IS NOT NULL OR g.expires_at <= $2
         OR j.status IN ('failed','canceled'))`,
    [owner, now],
  );
  const current = await subscription(tx, owner, now);
  const period = month(now);
  if (!current.active)
    await tx.query(
      `INSERT INTO recollect.token_grants(id,owner_id,source,grant_key,amount,expires_at,created_at)
       VALUES($1,$2,'free',$3,$4,$5,$6) ON CONFLICT(grant_key) DO NOTHING`,
      [randomUUID(), owner, `free:${owner}:${period.key}`, FREE_MONTHLY_TOKENS, period.end, now],
    );
  return { current, period };
}

export async function tokenBalance(
  tx: Transaction,
  owner: string,
  now = new Date(),
): Promise<TokenBalance> {
  await lockTokenOwner(tx, owner);
  const { current, period } = await reconcile(tx, owner, instant(now));
  const result = await tx.query<{
    source: 'free' | 'paid' | 'earned';
    available: string;
    reserved: string;
  }>(
    `SELECT g.source,SUM(g.amount-g.consumed-COALESCE(h.reserved,0))::text AS available,
       SUM(COALESCE(h.reserved,0))::text AS reserved
     FROM recollect.token_grants g LEFT JOIN (
       SELECT grant_id,COUNT(*) AS reserved FROM recollect.token_generation_holds
       WHERE owner_id=$1 AND state='reserved' GROUP BY grant_id
     ) h ON h.grant_id=g.id
     WHERE g.owner_id=$1 AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > $2)
     GROUP BY g.source`,
    [owner, now],
  );
  const balances = { free: 0, paid: 0, earned: 0 };
  let reserved = 0;
  for (const row of result.rows) {
    balances[row.source] = Number(row.available);
    reserved += Number(row.reserved);
  }
  return {
    available: balances.free + balances.paid + balances.earned,
    reserved,
    ...balances,
    freeMonthlyAllowance: FREE_MONTHLY_TOKENS,
    freeResetsAt: period.end.toISOString(),
    subscription: current,
  };
}

export async function reserveGenerationToken(
  tx: Transaction,
  owner: string,
  jobId: string,
  now = new Date(),
): Promise<void> {
  await lockTokenOwner(tx, owner);
  await reconcile(tx, owner, instant(now));
  const hold = await tx.query<{ state: string }>(
    'SELECT state FROM recollect.token_generation_holds WHERE job_id=$1 AND owner_id=$2',
    [jobId, owner],
  );
  if (hold.rows[0]?.state === 'captured' || hold.rows[0]?.state === 'reserved') return;
  const grant = (
    await tx.query<{ id: string; expires_at: Date | null }>(
      `SELECT g.id,g.expires_at FROM recollect.token_grants g
       WHERE g.owner_id=$1 AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > $2)
         AND g.amount-g.consumed > (SELECT COUNT(*) FROM recollect.token_generation_holds h
           WHERE h.grant_id=g.id AND h.state='reserved')
       ORDER BY g.expires_at ASC NULLS LAST,CASE g.source WHEN 'earned' THEN 1 ELSE 0 END,g.created_at,g.id
       LIMIT 1 FOR UPDATE OF g`,
      [owner, now],
    )
  ).rows[0];
  if (!grant)
    throw new DomainError('tokens_exhausted', 'You have no generation tokens available.', 402);
  const expiresAt = new Date(
    Math.min(now.getTime() + HOLD_MS, grant.expires_at?.getTime() ?? Infinity),
  );
  await tx.query(
    `INSERT INTO recollect.token_generation_holds(job_id,owner_id,grant_id,state,expires_at,created_at,updated_at)
     VALUES($1,$2,$3,'reserved',$4,$5,$5)
     ON CONFLICT(job_id) DO UPDATE SET grant_id=EXCLUDED.grant_id,state='reserved',
       expires_at=EXCLUDED.expires_at,updated_at=EXCLUDED.updated_at
     WHERE recollect.token_generation_holds.owner_id=EXCLUDED.owner_id
       AND recollect.token_generation_holds.state='released'`,
    [jobId, owner, grant.id, expiresAt, now],
  );
}

/** True only for the first acceptance; a successful batch costs one token total. */
export async function captureGenerationToken(
  tx: Transaction,
  owner: string,
  jobId: string,
  now = new Date(),
): Promise<boolean> {
  await reserveGenerationToken(tx, owner, jobId, now);
  const hold = (
    await tx.query<{ grant_id: string; state: string }>(
      'SELECT grant_id,state FROM recollect.token_generation_holds WHERE job_id=$1 AND owner_id=$2 FOR UPDATE',
      [jobId, owner],
    )
  ).rows[0];
  if (hold?.state === 'captured') return false;
  if (!hold || hold.state !== 'reserved') throw new Error('Generation token reservation missing');
  const captured = await tx.query(
    `UPDATE recollect.token_grants SET consumed=consumed+1
     WHERE id=$1 AND owner_id=$2 AND consumed < amount AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > $3)`,
    [hold.grant_id, owner, now],
  );
  if (!captured.rowCount) throw new Error('Generation token reservation is no longer spendable');
  await tx.query(
    "UPDATE recollect.token_generation_holds SET state='captured',updated_at=$3 WHERE job_id=$1 AND owner_id=$2",
    [jobId, owner, now],
  );
  return true;
}

export async function releaseGenerationToken(
  tx: Transaction,
  owner: string,
  jobId: string,
  now = new Date(),
): Promise<void> {
  await lockTokenOwner(tx, owner);
  await tx.query(
    `UPDATE recollect.token_generation_holds SET state='released',updated_at=$3
     WHERE job_id=$1 AND owner_id=$2 AND state='reserved'`,
    [jobId, owner, now],
  );
}

/** Only call with a verified App Store transaction, never client-supplied fields. */
export async function grantPurchasedTokens(
  tx: Transaction,
  owner: string,
  purchase: VerifiedTokenPurchase,
  now = new Date(),
): Promise<boolean> {
  await lockTokenOwner(tx, owner);
  const purchasedAt = instant(purchase.purchasedAt),
    expiresAt = instant(purchase.expiresAt);
  const signedAt = instant(purchase.signedAt ?? now);
  const revokedAt = purchase.revokedAt ? instant(purchase.revokedAt) : null;
  const refundEventAt = revokedAt ? instant(purchase.refundEventSignedAt ?? revokedAt) : null;
  if (
    !purchase.transactionId ||
    !purchase.originalTransactionId ||
    !purchase.productId ||
    expiresAt <= purchasedAt
  )
    throw new Error('Invalid verified subscription transaction');
  await tx.query(
    `INSERT INTO recollect.token_subscription_owners(original_transaction_id,owner_id)
     VALUES($1,$2) ON CONFLICT(original_transaction_id) DO NOTHING`,
    [purchase.originalTransactionId, owner],
  );
  const chain = await tx.query<{ owner_id: string }>(
    'SELECT owner_id FROM recollect.token_subscription_owners WHERE original_transaction_id=$1',
    [purchase.originalTransactionId],
  );
  if (chain.rows[0]?.owner_id !== owner)
    throw new DomainError(
      'subscription_owner_mismatch',
      'This subscription belongs to another account.',
      409,
    );
  const previous = await tx.query<{
    owner_id: string;
    original_transaction_id: string;
    product_id: string;
    environment: string;
  }>(
    'SELECT owner_id,original_transaction_id,product_id,environment FROM recollect.token_purchases WHERE transaction_id=$1',
    [purchase.transactionId],
  );
  const existing = previous.rows[0];
  const environment = purchase.environment ?? 'Production';
  if (
    existing &&
    (existing.owner_id !== owner ||
      existing.original_transaction_id !== purchase.originalTransactionId ||
      existing.product_id !== purchase.productId ||
      existing.environment !== environment)
  )
    throw new DomainError(
      'subscription_transaction_conflict',
      'This subscription transaction cannot be reused.',
      409,
    );
  const saved = await tx.query(
    `INSERT INTO recollect.token_purchases(transaction_id,owner_id,original_transaction_id,product_id,environment,purchased_at,expires_at,signed_at,revoked_at,refund_event_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT(transaction_id) DO UPDATE SET
       expires_at=CASE WHEN EXCLUDED.signed_at >= recollect.token_purchases.signed_at THEN EXCLUDED.expires_at ELSE recollect.token_purchases.expires_at END,
       signed_at=GREATEST(EXCLUDED.signed_at,recollect.token_purchases.signed_at),
       revoked_at=CASE WHEN EXCLUDED.revoked_at IS NOT NULL AND
         (recollect.token_purchases.refund_event_at IS NULL OR EXCLUDED.refund_event_at >= recollect.token_purchases.refund_event_at)
         THEN EXCLUDED.revoked_at ELSE recollect.token_purchases.revoked_at END,
       refund_event_at=CASE WHEN EXCLUDED.revoked_at IS NOT NULL AND
         (recollect.token_purchases.refund_event_at IS NULL OR EXCLUDED.refund_event_at >= recollect.token_purchases.refund_event_at)
         THEN EXCLUDED.refund_event_at ELSE recollect.token_purchases.refund_event_at END
     WHERE recollect.token_purchases.owner_id=EXCLUDED.owner_id
       AND recollect.token_purchases.original_transaction_id=EXCLUDED.original_transaction_id
       AND recollect.token_purchases.product_id=EXCLUDED.product_id
       AND recollect.token_purchases.environment=EXCLUDED.environment
     RETURNING transaction_id`,
    [
      purchase.transactionId,
      owner,
      purchase.originalTransactionId,
      purchase.productId,
      environment,
      purchasedAt,
      expiresAt,
      signedAt,
      revokedAt,
      refundEventAt,
    ],
  );
  if (!saved.rowCount)
    throw new DomainError(
      'subscription_transaction_conflict',
      'This subscription transaction cannot be reused.',
      409,
    );
  const effective = await tx.query<{ revoked_at: Date | null }>(
    'SELECT revoked_at FROM recollect.token_purchases WHERE transaction_id=$1',
    [purchase.transactionId],
  );
  if (effective.rows[0]?.revoked_at) {
    await retirePurchasedGrant(tx, owner, purchase.transactionId, now);
    return false;
  }
  const created = await tx.query(
    `INSERT INTO recollect.token_grants(id,owner_id,source,grant_key,amount,created_at)
     VALUES($1,$2,'paid',$3,$4,$5) ON CONFLICT(grant_key) DO NOTHING`,
    [randomUUID(), owner, `apple:${purchase.transactionId}`, PAID_MONTHLY_TOKENS, now],
  );
  if ((await subscription(tx, owner, now)).active) {
    // The paid allowance replaces this month's unspent free allowance. Existing
    // acceptance receipts remain intact; no later replay can mint it again.
    await tx.query(
      `UPDATE recollect.token_grants SET revoked_at=$2 WHERE owner_id=$1 AND source='free'
       AND revoked_at IS NULL AND expires_at > $2`,
      [owner, now],
    );
    await reconcile(tx, owner, now);
  }
  return Boolean(created.rowCount);
}

export async function revokePurchasedTokens(
  tx: Transaction,
  owner: string,
  transactionId: string,
  now = new Date(),
): Promise<void> {
  await lockTokenOwner(tx, owner);
  await tx.query(
    `UPDATE recollect.token_purchases SET revoked_at=$3,refund_event_at=$3
     WHERE transaction_id=$1 AND owner_id=$2 AND (refund_event_at IS NULL OR refund_event_at <= $3)`,
    [transactionId, owner, now],
  );
  const current = await tx.query<{ revoked_at: Date | null }>(
    'SELECT revoked_at FROM recollect.token_purchases WHERE transaction_id=$1 AND owner_id=$2',
    [transactionId, owner],
  );
  if (current.rows[0]?.revoked_at) await retirePurchasedGrant(tx, owner, transactionId, now);
}

async function retirePurchasedGrant(
  tx: Transaction,
  owner: string,
  transactionId: string,
  now: Date,
) {
  await tx.query(
    `UPDATE recollect.token_grants SET revoked_at=COALESCE(revoked_at,$3)
     WHERE grant_key=$1 AND owner_id=$2`,
    [`apple:${transactionId}`, owner, now],
  );
  await reconcile(tx, owner, now);
}

/**
 * Only a verified REFUND_REVERSED server notification may call this helper.
 * Ordinary restored/client transactions never clear a refund. The separate
 * event clock prevents delivery order from replacing newer refund state.
 */
export async function reversePurchasedTokenRefund(
  tx: Transaction,
  owner: string,
  purchase: VerifiedTokenPurchase,
  event: { notificationSignedAt: Date | string },
  now = new Date(),
): Promise<boolean> {
  await lockTokenOwner(tx, owner);
  const eventAt = instant(event.notificationSignedAt);
  const restored = { ...purchase, revokedAt: null, refundEventSignedAt: undefined };
  // Bind/validate owner, chain and original transaction before changing state.
  // If the original paid delivery is missing, this creates that single grant;
  // a currently refunded transaction remains blocked until the clock advances.
  await grantPurchasedTokens(tx, owner, restored, now);
  const applied = await tx.query(
    `UPDATE recollect.token_purchases SET revoked_at=NULL,refund_event_at=$3
     WHERE transaction_id=$1 AND owner_id=$2 AND (refund_event_at IS NULL OR refund_event_at < $3)
     RETURNING transaction_id`,
    [purchase.transactionId, owner, eventAt],
  );
  if (!applied.rowCount) return false;
  // Restore the original grant's remaining amount: never reset consumed or
  // issue a second grant. Released reservations must reserve again normally.
  await tx.query(
    'UPDATE recollect.token_grants SET revoked_at=NULL WHERE owner_id=$1 AND grant_key=$2',
    [owner, `apple:${purchase.transactionId}`],
  );
  await grantPurchasedTokens(tx, owner, restored, now);
  return true;
}

/** One reward per other learner/source deck, independent of listing lifecycle. */
export async function rewardMarketplaceDownload(
  tx: Transaction,
  publisher: string,
  recipient: string,
  sourceDeckId: string,
  listingId: string,
  downloadId: string,
  now = new Date(),
): Promise<boolean> {
  if (publisher === recipient) return false;
  await lockTokenOwner(tx, publisher);
  const receipt = await tx.query(
    `INSERT INTO recollect.token_marketplace_rewards(publisher_id,recipient_id,source_deck_id,listing_id,download_id,created_at)
     VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(publisher_id,recipient_id,source_deck_id) DO NOTHING`,
    [publisher, recipient, sourceDeckId, listingId, downloadId, now],
  );
  if (!receipt.rowCount) return false;
  const granted = await tx.query(
    `INSERT INTO recollect.token_grants(id,owner_id,source,grant_key,amount,created_at)
     VALUES($1,$2,'earned',$3,1,$4) ON CONFLICT(grant_key) DO NOTHING`,
    [randomUUID(), publisher, `marketplace:${publisher}:${sourceDeckId}:${recipient}`, now],
  );
  return Boolean(granted.rowCount);
}
