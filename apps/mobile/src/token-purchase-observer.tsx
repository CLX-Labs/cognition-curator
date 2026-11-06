import { useEffect, useRef } from 'react';
import { useStore } from './store';
import { useAppActive } from './polling';
import { fetchTokenWallet, verifyTokenPurchase } from './tokens';

/** Finish interrupted purchases only after the API has acknowledged their credits. */
export default function TokenPurchaseObserver() {
  const { repository } = useStore();
  const owner = repository?.ownerId;
  const active = useAppActive();
  const liveOwner = useRef(owner);
  liveOwner.current = owner;
  useEffect(() => {
    if (!owner || !active) return;
    let current = true;
    let stop: (() => void) | undefined;
    void (async () => {
      const native = await import('../modules/recollect-billing');
      if (!current || !native.isTokenBillingNativeAvailable()) return;
      const wallet = await fetchTokenWallet(owner);
      if (!current || !wallet.enabled || !wallet.billing.available) return;
      const billing = await import('./token-purchases');
      if (!current) return;
      stop = billing.observeGenerationTokenPurchases({
        ownerId: owner,
        deliver: (signed) => verifyTokenPurchase(owner, signed),
        isCurrentOwner: () => current && liveOwner.current === owner,
      });
    })().catch(() => {
      // Unfinished StoreKit transactions remain recoverable; Tokens offers an explicit retry.
    });
    return () => {
      current = false;
      stop?.();
    };
  }, [owner, active]);
  return null;
}
