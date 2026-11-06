import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import * as Linking from 'expo-linking';
import { useIsFocused } from 'expo-router/react-navigation';
import type { TokenSubscriptionProduct } from '../modules/recollect-billing';
import { Back, Button, Panel, Screen, s, Text } from '../src/ui';
import { useTokenWallet } from '../src/tokens-ui';
import { useStore } from '../src/store';
import { verifyTokenPurchase } from '../src/tokens';

export default function TokensScreen() {
  const { wallet, loading, error, refresh } = useTokenWallet();
  if (!wallet?.enabled)
    return (
      <Screen title="Generation" leading={<Back />}>
        <Panel>
          <Text style={s.body}>
            {wallet
              ? 'AI card and deck generation is included. You can keep creating as usual.'
              : error
                ? 'Connect to check generation options.'
                : 'Checking generation options…'}
          </Text>
          {error && (
            <Button
              title="Try again"
              variant="secondary"
              loading={loading}
              onPress={refresh}
            />
          )}
        </Panel>
      </Screen>
    );
  return (
    <Screen
      title="Room for curiosity"
      eyebrow="YOUR TOKENS"
      leading={<Back />}
      subtitle="A little help turning what interests you into what you know."
    >
      <Panel tint>
        <Text style={[s.sectionTitle, { fontSize: 56 }]}>{wallet?.available ?? '—'}</Text>
        <Text style={s.label}>tokens available</Text>
        <View style={s.row}>
          {(['free', 'paid', 'earned'] as const).map((source) => (
            <View key={source} style={{ flex: 1, gap: 4 }}>
              <Text style={s.sectionTitle}>{wallet?.[source] ?? '—'}</Text>
              <Text style={s.caption}>
                {source === 'free' ? 'Free this month' : source === 'paid' ? 'Purchased' : 'Earned'}
              </Text>
            </View>
          ))}
        </View>
        {!!wallet?.reserved && (
          <Text style={s.caption}>
            {wallet.reserved} reserved for suggestions you’re reviewing.
          </Text>
        )}
        {error && (
          <Text style={s.caption}>Your balance could not refresh. Connect and try again.</Text>
        )}
        <Button
          title="Refresh balance"
          variant="ghost"
          size="compact"
          loading={loading}
          onPress={refresh}
        />
      </Panel>
      <Panel>
        <Text style={s.sectionTitle}>Keep the useful bits</Text>
        <Text style={s.body}>
          One token pays for one accepted generation: a set of cards, or an answer you choose to
          use. Reviewing suggestions is free. So are failed and dismissed generations.
        </Text>
        <Text style={s.caption}>
          Writing your own cards, editing them, and practicing never uses tokens.
        </Text>
      </Panel>
      <Panel>
        <Text style={s.sectionTitle}>10, on us</Text>
        <Text style={s.body}>
          Your free plan includes ten tokens each calendar month. Unused free tokens reset at the
          start of the next month.
        </Text>
        {wallet && (
          <Text style={s.caption}>
            Next reset:{' '}
            {new Date(wallet.freeResetsAt).toLocaleDateString(undefined, {
              month: 'long',
              day: 'numeric',
              timeZone: 'UTC',
            })}{' '}
            (UTC).
          </Text>
        )}
      </Panel>
      <TokenSubscriptionPanel wallet={wallet} onChange={refresh} />
      <Panel>
        <Text style={s.sectionTitle}>Share something worth learning</Text>
        <Text style={s.body}>
          Earn a token when someone new downloads your Marketplace deck. One reward per person, per
          deck. Your own downloads and repeat downloads don’t count.
        </Text>
        <Text style={s.caption}>
          Earned tokens stay yours until you use them. Sharing download counts or practice activity
          is optional and does not affect rewards.
        </Text>
      </Panel>
    </Screen>
  );
}

function TokenSubscriptionPanel({
  wallet,
  onChange,
}: {
  wallet: ReturnType<typeof useTokenWallet>['wallet'];
  onChange(): void;
}) {
  const { repository } = useStore();
  const owner = repository?.ownerId;
  const focused = useIsFocused();
  const liveOwner = useRef(owner);
  liveOwner.current = owner;
  const [product, setProduct] = useState<TokenSubscriptionProduct | null>(null);
  const [nativeAvailable, setNativeAvailable] = useState(false);
  const [purchasesAllowed, setPurchasesAllowed] = useState(false);
  const [storeRevision, setStoreRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false);
  const epoch = useRef(0);
  const enabled = Boolean(wallet?.enabled && wallet.billing.available);
  useEffect(() => {
    const scope = ++epoch.current;
    setProduct(null);
    setNativeAvailable(false);
    setPurchasesAllowed(false);
    setMessage(null);
    setBusy(false);
    inFlight.current = false;
    if (!owner || !enabled || !focused) return;
    void (async () => {
      const native = await import('../modules/recollect-billing');
      if (scope !== epoch.current || !native.isTokenBillingNativeAvailable()) return;
      setNativeAvailable(true);
      const [allowed, next] = await Promise.all([
        native.canPurchaseTokens(),
        native.getTokenSubscriptionProduct(),
      ]);
      if (scope === epoch.current) {
        setPurchasesAllowed(allowed);
        if (next?.productId === wallet?.billing.productId) setProduct(next);
      }
    })().catch(() => {
      if (scope === epoch.current)
        setMessage('The App Store could not load this subscription. Try again shortly.');
    });
    return () => {
      ++epoch.current;
    };
  }, [owner, enabled, focused, wallet?.billing.productId, storeRevision]);

  async function run(restore: boolean) {
    if (
      !owner ||
      !enabled ||
      !nativeAvailable ||
      (!restore && (!product || !purchasesAllowed)) ||
      inFlight.current
    )
      return;
    const account = owner;
    const scope = epoch.current;
    const current = () => scope === epoch.current && liveOwner.current === account;
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const billing = await import('../src/token-purchases');
      const deliver = (signed: string) => verifyTokenPurchase(account, signed);
      if (restore) {
        const restored = await billing.restoreGenerationTokens(account, deliver, current);
        if (current())
          setMessage(
            restored.otherAccount
              ? 'Some purchases belong to another Recollect account. Sign in to that account to restore them.'
              : restored.restored
                ? 'Your purchases are restored. Each monthly payment is credited once.'
                : 'No purchases were found for this account.',
          );
      } else {
        const result = await billing.purchaseGenerationTokens(account, deliver, current);
        if (current())
          setMessage(
            result === 'purchased'
              ? 'Your tokens are ready.'
              : result === 'pending'
                ? 'Apple is processing this purchase. Your tokens will appear after it is approved.'
                : null,
          );
      }
      if (current()) onChange();
    } catch (cause) {
      if (current())
        setMessage(
          cause instanceof Error
            ? cause.message
            : 'The purchase could not finish. Restore purchases to try again.',
        );
    } finally {
      if (current()) {
        setBusy(false);
        inFlight.current = false;
      }
    }
  }
  return (
    <Panel>
      <Text style={s.sectionTitle}>
        {wallet?.subscription.active ? 'More room to learn' : 'A hundred new possibilities'}
      </Text>
      <Text style={s.body}>
        100 tokens each month with a subscription. Purchased tokens roll over, even if you cancel.
        The paid allowance replaces the ten-token free allowance.
      </Text>
      {wallet?.subscription.active ? (
        <>
          <Text style={s.caption}>
            Your subscription is active. Monthly tokens arrive when Apple confirms each payment.
          </Text>
          <Button
            title="Manage subscription"
            variant="secondary"
            size="compact"
            onPress={() => void Linking.openURL('https://apps.apple.com/account/subscriptions')}
          />
        </>
      ) : product ? (
        <>
          <Text style={s.label}>{product.displayPrice} / month · 100 tokens</Text>
          <Text style={s.caption}>
            Auto-renews monthly until canceled. Manage or cancel in your Apple account settings.
          </Text>
          {!purchasesAllowed && (
            <Text style={s.caption}>
              Purchases are disabled on this device. You can still restore previous purchases.
            </Text>
          )}
          <Button
            title={'Subscribe · ' + product.displayPrice + ' / month'}
            disabled={!purchasesAllowed}
            loading={busy}
            onPress={() => void run(false)}
          />
        </>
      ) : (
        <Text style={s.caption}>
          {enabled
            ? 'This subscription is not available in this version or storefront.'
            : 'Subscriptions aren’t available yet.'}
        </Text>
      )}
      {enabled && nativeAvailable && (
        <>
          <Button
            title="Restore purchases"
            variant="ghost"
            size="compact"
            loading={busy}
            onPress={() => void run(true)}
          />
          <Button
            title="Retry App Store"
            variant="ghost"
            size="compact"
            disabled={busy}
            onPress={() => setStoreRevision((value) => value + 1)}
          />
        </>
      )}
      {message && (
        <Text style={s.caption} accessibilityLiveRegion="polite">
          {message}
        </Text>
      )}
      <View style={s.row}>
        <Button
          title="Privacy"
          variant="ghost"
          size="compact"
          onPress={() => void Linking.openURL('https://recollect-ai.netlify.app/privacy/')}
        />
        <Button
          title="Terms"
          variant="ghost"
          size="compact"
          onPress={() =>
            void Linking.openURL(
              'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/',
            )
          }
        />
      </View>
    </Panel>
  );
}
