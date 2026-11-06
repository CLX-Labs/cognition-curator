import { tokenWalletSchema, type TokenWallet } from '@recollect/contracts';
import { api } from './api';

const walletListeners = new Set<(ownerId: string) => void>();
export function onTokenWalletChanged(listener: (ownerId: string) => void) {
  walletListeners.add(listener);
  return () => {
    walletListeners.delete(listener);
  };
}
export function notifyTokenWalletChanged(ownerId: string) {
  for (const listener of walletListeners) listener(ownerId);
}

/** Balances are read from the authenticated API, never calculated from local cards. */
export async function fetchTokenWallet(ownerId: string): Promise<TokenWallet> {
  return tokenWalletSchema.parse(await api.request('/v1/tokens', { ownerId }));
}

export async function verifyTokenPurchase(ownerId: string, signedTransaction: string) {
  const { appleTokenPurchaseResponseSchema } = await import('@recollect/contracts');
  const result = appleTokenPurchaseResponseSchema.parse(
    await api.request('/v1/billing/apple/transactions', {
      ownerId,
      method: 'POST',
      body: { signedTransaction },
    }),
  );
  notifyTokenWalletChanged(ownerId);
  return result;
}
