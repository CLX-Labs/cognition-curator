import { requireOptionalNativeModule } from 'expo-modules-core';

export const tokenSubscriptionProductId = 'collect.software.recollect.tokens.monthly';

export interface TokenSubscriptionProduct {
  productId: string;
  displayName: string;
  description: string;
  displayPrice: string;
  subscriptionPeriod: 'month';
}

export interface AppleTransactionProof {
  transactionId: string;
  appAccountToken: string;
  signedTransaction: string;
}

export type TokenPurchaseResult =
  { status: 'cancelled' | 'pending' } | { status: 'purchased'; transaction: AppleTransactionProof };

export interface BillingSubscription {
  remove(): void;
}

interface BillingNativeModule {
  getAvailability(): Promise<boolean>;
  getProduct(): Promise<TokenSubscriptionProduct | null>;
  purchase(appAccountToken: string): Promise<TokenPurchaseResult>;
  restore(): Promise<AppleTransactionProof[]>;
  pendingTransactions(): Promise<AppleTransactionProof[]>;
  finish(transactionId: string): Promise<void>;
  addListener(
    event: 'onTransaction',
    listener: (proof: AppleTransactionProof) => void,
  ): BillingSubscription;
}

// Older installed binaries, Expo Go, Android and web render a safe unavailable state.
const native = requireOptionalNativeModule<BillingNativeModule>('RecollectBilling');
export const isTokenBillingNativeAvailable = (): boolean => native !== null;

function requireBilling(): BillingNativeModule {
  if (!native) throw new Error('Install the next iOS build to use token subscriptions.');
  return native;
}

export async function canPurchaseTokens(): Promise<boolean> {
  return native ? native.getAvailability() : false;
}

export async function getTokenSubscriptionProduct(): Promise<TokenSubscriptionProduct | null> {
  return native ? native.getProduct() : null;
}

export async function purchaseTokenSubscription(ownerId: string): Promise<TokenPurchaseResult> {
  return requireBilling().purchase(ownerId);
}

/** Call only for the user's explicit Restore Purchases action; Apple may ask for sign-in. */
export async function restoreTokenTransactions(): Promise<AppleTransactionProof[]> {
  return requireBilling().restore();
}

export async function pendingTokenTransactions(): Promise<AppleTransactionProof[]> {
  return native ? native.pendingTransactions() : [];
}

/** Call only after the API has acknowledged the exact signed transaction. */
export async function finishTokenTransaction(transactionId: string): Promise<void> {
  await requireBilling().finish(transactionId);
}

export function observeTokenTransactions(
  listener: (proof: AppleTransactionProof) => void,
): BillingSubscription {
  return native?.addListener('onTransaction', listener) ?? { remove() {} };
}
