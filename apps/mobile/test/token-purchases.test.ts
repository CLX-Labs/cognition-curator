import { beforeEach, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({
  finishTokenTransaction: vi.fn(async () => {}),
  observeTokenTransactions: vi.fn(() => ({ remove: vi.fn() })),
  pendingTokenTransactions: vi.fn(async () => []),
  purchaseTokenSubscription: vi.fn(),
  restoreTokenTransactions: vi.fn(),
}));
vi.mock('../modules/recollect-billing', () => native);
import {
  deliverTokenTransaction,
  purchaseGenerationTokens,
  restoreGenerationTokens,
} from '../src/token-purchases';

const owner = '6b94b364-335b-45b7-9625-c3d11b730fe0';
const proof = {
  transactionId: '100000001',
  appAccountToken: owner,
  signedTransaction: 'signed-jws',
};
beforeEach(() => {
  vi.clearAllMocks();
});

it('finishes only after the API acknowledges the exact transaction', async () => {
  const order: string[] = [];
  const deliver = vi.fn(async () => {
    order.push('api-committed');
    return { transactionId: proof.transactionId };
  });
  native.finishTokenTransaction.mockImplementationOnce(async () => {
    order.push('storekit-finished');
  });
  await expect(deliverTokenTransaction(owner, proof, deliver)).resolves.toBe(true);
  expect(order).toEqual(['api-committed', 'storekit-finished']);
});

it('leaves the transaction unfinished when server delivery fails', async () => {
  const deliver = vi.fn(async () => {
    throw new Error('offline');
  });
  await expect(deliverTokenTransaction(owner, proof, deliver)).rejects.toThrow('offline');
  expect(native.finishTokenTransaction).not.toHaveBeenCalled();
});

it('never sends another Recollect account transaction to the API', async () => {
  const deliver = vi.fn();
  await expect(deliverTokenTransaction('another-owner', proof, deliver)).resolves.toBe(false);
  expect(deliver).not.toHaveBeenCalled();
  expect(native.finishTokenTransaction).not.toHaveBeenCalled();
});

it('does not finish on a mismatched acknowledgement or after the owner logs out', async () => {
  await expect(
    deliverTokenTransaction(owner, proof, async () => ({ transactionId: 'different' })),
  ).rejects.toThrow('different transaction');
  let current = true;
  await expect(
    deliverTokenTransaction(
      owner,
      proof,
      async () => {
        current = false;
        return { transactionId: proof.transactionId };
      },
      () => current,
    ),
  ).resolves.toBe(false);
  expect(native.finishTokenTransaction).not.toHaveBeenCalled();
});

it('deduplicates simultaneous delivery but permits a later revoked JWS for the same ID', async () => {
  const deliver = vi.fn(async () => ({ transactionId: proof.transactionId }));
  await Promise.all([
    deliverTokenTransaction(owner, proof, deliver),
    deliverTokenTransaction(owner, proof, deliver),
  ]);
  expect(deliver).toHaveBeenCalledTimes(1);
  await deliverTokenTransaction(
    owner,
    { ...proof, signedTransaction: 'later-refund-jws' },
    deliver,
  );
  expect(deliver).toHaveBeenCalledTimes(2);
});

it('cancellation and Ask to Buy pending do not send any wallet grant', async () => {
  const deliver = vi.fn();
  native.purchaseTokenSubscription.mockResolvedValueOnce({ status: 'cancelled' });
  await expect(purchaseGenerationTokens(owner, deliver)).resolves.toBe('cancelled');
  native.purchaseTokenSubscription.mockResolvedValueOnce({ status: 'pending' });
  await expect(purchaseGenerationTokens(owner, deliver)).resolves.toBe('pending');
  expect(deliver).not.toHaveBeenCalled();
});

it('reopening the screen joins the same Apple payment sheet and credits only once', async () => {
  let finishPurchase!: (value: { status: 'purchased'; transaction: typeof proof }) => void;
  native.purchaseTokenSubscription.mockReturnValueOnce(
    new Promise((resolve) => {
      finishPurchase = resolve;
    }),
  );
  const deliver = vi.fn(async () => ({ transactionId: proof.transactionId }));
  const first = purchaseGenerationTokens(owner, deliver);
  const reopened = purchaseGenerationTokens(owner, deliver);
  finishPurchase({ status: 'purchased', transaction: proof });
  await expect(Promise.all([first, reopened])).resolves.toEqual(['purchased', 'purchased']);
  expect(native.purchaseTokenSubscription).toHaveBeenCalledTimes(1);
  expect(deliver).toHaveBeenCalledTimes(1);
  expect(native.finishTokenTransaction).toHaveBeenCalledTimes(1);
});

it('does not open another payment sheet after an account switch while a purchase is pending', async () => {
  let finishPurchase!: (value: { status: 'cancelled' }) => void;
  native.purchaseTokenSubscription.mockReturnValueOnce(
    new Promise((resolve) => {
      finishPurchase = resolve;
    }),
  );
  const first = purchaseGenerationTokens(owner, vi.fn());
  await expect(purchaseGenerationTokens('another-account', vi.fn())).rejects.toThrow(
    'another Recollect account',
  );
  finishPurchase({ status: 'cancelled' });
  await first;
  expect(native.purchaseTokenSubscription).toHaveBeenCalledTimes(1);
});

it('a fresh screen can finish shared server delivery after the original screen loses focus', async () => {
  let originalFocused = true;
  let acknowledge!: (value: { transactionId: string }) => void;
  const deliver = vi.fn(
    () =>
      new Promise<{ transactionId: string }>((resolve) => {
        acknowledge = resolve;
      }),
  );
  const original = deliverTokenTransaction(owner, proof, deliver, () => originalFocused);
  originalFocused = false;
  const freshScreen = deliverTokenTransaction(owner, proof, deliver, () => true);
  acknowledge({ transactionId: proof.transactionId });
  await expect(original).resolves.toBe(false);
  await expect(freshScreen).resolves.toBe(true);
  expect(deliver).toHaveBeenCalledTimes(1);
  expect(native.finishTokenTransaction).toHaveBeenCalledTimes(1);
});

it('restores each matching historical period and skips purchases owned by another account', async () => {
  native.restoreTokenTransactions.mockResolvedValue([
    proof,
    { ...proof, transactionId: '100000002', signedTransaction: 'renewal' },
    { ...proof, appAccountToken: 'another-owner' },
  ]);
  const deliver = vi.fn(async (jws: string) => ({
    transactionId: jws === 'renewal' ? '100000002' : proof.transactionId,
  }));
  await expect(restoreGenerationTokens(owner, deliver)).resolves.toEqual({
    restored: 2,
    otherAccount: 1,
  });
  expect(native.finishTokenTransaction).toHaveBeenCalledTimes(2);
});
