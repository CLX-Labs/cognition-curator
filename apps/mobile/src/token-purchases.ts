import {
  finishTokenTransaction,
  observeTokenTransactions,
  pendingTokenTransactions,
  purchaseTokenSubscription,
  restoreTokenTransactions,
  type AppleTransactionProof,
  type TokenPurchaseResult,
} from '../modules/recollect-billing';

export type DeliverTokenPurchase = (
  signedTransaction: string,
) => Promise<{ transactionId: string }>;
export type IsCurrentTokenOwner = () => boolean;
const deliveries = new Map<
  string,
  {
    acknowledgement: Promise<{ transactionId: string }>;
    finish?: Promise<void>;
    callers: number;
  }
>();
let purchaseFlight: {
  ownerId: string;
  result: Promise<TokenPurchaseResult>;
  callers: number;
} | null = null;

/** StoreKit completion follows durable server acknowledgement, including idempotent replays. */
export async function deliverTokenTransaction(
  ownerId: string,
  proof: AppleTransactionProof,
  deliver: DeliverTokenPurchase,
  isCurrentOwner: IsCurrentTokenOwner = () => true,
): Promise<boolean> {
  if (proof.appAccountToken.toLowerCase() !== ownerId.toLowerCase() || !isCurrentOwner())
    return false;
  // A later refund JWS for the same transaction must be delivered independently.
  const key = `${ownerId}:${proof.transactionId}:${proof.signedTransaction}`;
  const flight = deliveries.get(key) ?? {
    acknowledgement: deliver(proof.signedTransaction),
    callers: 0,
  };
  deliveries.set(key, flight);
  flight.callers++;
  try {
    const acknowledged = await flight.acknowledgement;
    if (acknowledged.transactionId !== proof.transactionId)
      throw new Error('Apple returned a different transaction. Restore purchases and try again.');
    if (!isCurrentOwner()) return false;
    flight.finish ??= finishTokenTransaction(proof.transactionId);
    await flight.finish;
    return true;
  } finally {
    flight.callers--;
    if (flight.callers === 0 && deliveries.get(key) === flight) deliveries.delete(key);
  }
}

export async function purchaseGenerationTokens(
  ownerId: string,
  deliver: DeliverTokenPurchase,
  isCurrentOwner: IsCurrentTokenOwner = () => true,
): Promise<'purchased' | 'cancelled' | 'pending'> {
  if (!isCurrentOwner()) throw new Error('Sign in again before subscribing.');
  if (purchaseFlight && purchaseFlight.ownerId !== ownerId.toLowerCase())
    throw new Error(
      'A purchase is still finishing for another Recollect account. Return to that account before trying again.',
    );
  // A screen can lose focus while Apple's purchase sheet is open. Reopening it
  // must join the same purchase rather than present a second payment sheet.
  const flight = purchaseFlight ?? {
    ownerId: ownerId.toLowerCase(),
    result: purchaseTokenSubscription(ownerId),
    callers: 0,
  };
  purchaseFlight = flight;
  flight.callers++;
  try {
    const result = await flight.result;
    if (result.status !== 'purchased') return result.status;
    const delivered = await deliverTokenTransaction(
      ownerId,
      result.transaction,
      deliver,
      isCurrentOwner,
    );
    if (!delivered)
      throw new Error(
        'Sign in to the Recollect account used for this subscription to receive its tokens.',
      );
    return 'purchased';
  } finally {
    flight.callers--;
    if (flight.callers === 0 && purchaseFlight === flight) purchaseFlight = null;
  }
}

async function deliverTransactions(
  ownerId: string,
  proofs: AppleTransactionProof[],
  deliver: DeliverTokenPurchase,
  isCurrentOwner: IsCurrentTokenOwner,
) {
  let restored = 0;
  let otherAccount = 0;
  const failures: unknown[] = [];
  for (const proof of proofs) {
    if (!isCurrentOwner()) break;
    if (proof.appAccountToken.toLowerCase() !== ownerId.toLowerCase()) {
      otherAccount++;
      continue;
    }
    try {
      if (await deliverTokenTransaction(ownerId, proof, deliver, isCurrentOwner)) restored++;
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length) throw failures[0];
  return { restored, otherAccount };
}

/** Explicit user action. StoreKit may show an Apple sign-in sheet. */
export async function restoreGenerationTokens(
  ownerId: string,
  deliver: DeliverTokenPurchase,
  isCurrentOwner: IsCurrentTokenOwner = () => true,
): Promise<{ restored: number; otherAccount: number }> {
  if (!isCurrentOwner()) throw new Error('Sign in again before restoring purchases.');
  return deliverTransactions(ownerId, await restoreTokenTransactions(), deliver, isCurrentOwner);
}

/** Start after authenticated session restoration, only when server billing is enabled. */
export function observeGenerationTokenPurchases(options: {
  ownerId: string;
  deliver: DeliverTokenPurchase;
  onDelivered?: () => void;
  onError?: (error: unknown) => void;
  isCurrentOwner?: IsCurrentTokenOwner;
}): () => void {
  let active = true;
  const current = () => active && (options.isCurrentOwner?.() ?? true);
  const subscription = observeTokenTransactions((proof) => {
    void deliverTokenTransaction(options.ownerId, proof, options.deliver, current)
      .then((delivered) => {
        if (delivered && current()) options.onDelivered?.();
      })
      .catch((error) => {
        if (current()) options.onError?.(error);
      });
  });
  void pendingTokenTransactions()
    .then((proofs) => deliverTransactions(options.ownerId, proofs, options.deliver, current))
    .then(({ restored }) => {
      if (restored > 0 && current()) options.onDelivered?.();
    })
    .catch((error) => {
      if (current()) options.onError?.(error);
    });
  return () => {
    active = false;
    subscription.remove();
  };
}
