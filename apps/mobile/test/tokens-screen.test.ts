import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { TokenWallet } from '@recollect/contracts';

const rig = vi.hoisted(() => ({
  owner: '3a486ffe-1530-4223-872b-b93448af706c',
  wallet: null as TokenWallet | null,
  loading: false,
  error: null as string | null,
  focused: true,
  refresh: vi.fn(),
  canPurchase: vi.fn(),
  product: vi.fn(),
  nativeAvailable: vi.fn(),
  purchase: vi.fn(),
  restore: vi.fn(),
  verify: vi.fn(),
}));
vi.mock('react-native', () => ({
  View: ({ children }: { children: React.ReactNode }) => React.createElement('view', {}, children),
}));
vi.mock('expo-linking', () => ({ openURL: vi.fn() }));
vi.mock('expo-router/react-navigation', () => ({ useIsFocused: () => rig.focused }));
vi.mock('../src/store', () => ({ useStore: () => ({ repository: { ownerId: rig.owner } }) }));
vi.mock('../src/tokens-ui', () => ({
  useTokenWallet: () => ({
    wallet: rig.wallet,
    loading: rig.loading,
    error: rig.error,
    refresh: rig.refresh,
  }),
}));
vi.mock('../src/tokens', () => ({ verifyTokenPurchase: rig.verify }));
vi.mock('../modules/recollect-billing', () => ({
  canPurchaseTokens: rig.canPurchase,
  getTokenSubscriptionProduct: rig.product,
  isTokenBillingNativeAvailable: rig.nativeAvailable,
}));
vi.mock('../src/token-purchases', () => ({
  purchaseGenerationTokens: rig.purchase,
  restoreGenerationTokens: rig.restore,
}));
vi.mock('../src/ui', () => ({
  Text: ({ children }: { children: React.ReactNode }) => React.createElement('text', {}, children),
  Screen: ({ children }: { children: React.ReactNode }) =>
    React.createElement('screen', {}, children),
  Panel: ({ children }: { children: React.ReactNode }) =>
    React.createElement('panel', {}, children),
  Button: (props: object) => React.createElement('button', props),
  Back: () => null,
  s: {},
}));
import TokensScreen from '../app/tokens';

const product = {
  productId: 'collect.software.recollect.tokens.monthly',
  displayName: 'Recollect Tokens',
  description: '100 monthly generation tokens',
  displayPrice: '€3,99',
  subscriptionPeriod: 'month' as const,
};
let renderer: ReactTestRenderer | null = null;
function buttons() {
  return renderer!.root.findAllByType('button');
}
function button(title: string | RegExp) {
  return buttons().find((node) =>
    typeof title === 'string' ? node.props.title === title : title.test(node.props.title),
  );
}
function content() {
  return JSON.stringify(renderer!.toJSON());
}
async function mount() {
  await act(async () => {
    renderer = create(React.createElement(TokensScreen));
  });
}
async function press(title: string | RegExp) {
  const target = button(title);
  expect(target).toBeDefined();
  await act(async () => {
    await target!.props.onPress();
  });
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  rig.owner = '3a486ffe-1530-4223-872b-b93448af706c';
  rig.focused = true;
  rig.loading = false;
  rig.error = null;
  rig.wallet = {
    enabled: true,
    available: 10,
    free: 10,
    paid: 0,
    earned: 0,
    reserved: 0,
    freeMonthlyAllowance: 10,
    freeResetsAt: '2026-11-01T00:00:00.000Z',
    subscription: { active: false, productId: null, renewsAt: null },
    billing: { available: true, productId: product.productId, monthlyTokens: 100, priceUsd: 3.99 },
  };
  rig.canPurchase.mockReset().mockResolvedValue(true);
  rig.product.mockReset().mockResolvedValue(product);
  rig.nativeAvailable.mockReset().mockReturnValue(true);
  rig.purchase.mockReset().mockResolvedValue('purchased');
  rig.restore.mockReset().mockResolvedValue({ restored: 1, otherAccount: 0 });
});
afterEach(async () => {
  await act(async () => {
    renderer?.unmount();
  });
  renderer = null;
  vi.unstubAllGlobals();
});

it('offers no payment or restore action until token charging is enabled', async () => {
  rig.wallet!.enabled = false;
  await mount();
  expect(content()).toContain('AI card and deck generation is included.');
  expect(content()).not.toContain('tokens');
  expect(button(/^Subscribe/)).toBeUndefined();
  expect(button('Restore purchases')).toBeUndefined();
  expect(rig.purchase).not.toHaveBeenCalled();
  expect(rig.canPurchase).not.toHaveBeenCalled();
  expect(rig.nativeAvailable).not.toHaveBeenCalled();
});

it('keeps a direct token link free of offers while availability loads or cannot be checked', async () => {
  rig.wallet = null;
  rig.loading = true;
  await mount();
  expect(content()).toContain('Checking generation options');
  expect(content()).not.toContain('tokens');
  expect(button(/^Subscribe/)).toBeUndefined();
  expect(rig.nativeAvailable).not.toHaveBeenCalled();
  rig.loading = false;
  rig.error = 'offline';
  await act(async () => renderer!.update(React.createElement(TokensScreen)));
  expect(content()).toContain('Connect to check generation options.');
  expect(content()).not.toContain('tokens');
  await press('Try again');
  expect(rig.refresh).toHaveBeenCalledTimes(1);
  expect(rig.nativeAvailable).not.toHaveBeenCalled();
});

it('uses the localized StoreKit price and keeps the displayed allowance at 100 tokens', async () => {
  await mount();
  expect(content()).toContain('€3,99 / month');
  expect(content()).toContain('100 tokens');
  expect(button('Subscribe · €3,99 / month')).toBeDefined();
  expect(content()).not.toContain('$3.99');
  await press('Subscribe · €3,99 / month');
  expect(rig.purchase).toHaveBeenCalledTimes(1);
  expect(rig.refresh).toHaveBeenCalledTimes(1);
});

it('restores previous purchases even when new payments are disabled and no storefront product is returned', async () => {
  rig.canPurchase.mockResolvedValue(false);
  rig.product.mockResolvedValue(null);
  await mount();
  expect(button(/^Subscribe/)).toBeUndefined();
  expect(button('Restore purchases')).toBeDefined();
  await press('Restore purchases');
  expect(rig.restore).toHaveBeenCalledTimes(1);
  expect(rig.purchase).not.toHaveBeenCalled();
  expect(content()).toContain('Your purchases are restored');
});

it('retries App Store product loading without remounting the screen', async () => {
  rig.product.mockResolvedValueOnce(null);
  await mount();
  expect(button(/^Subscribe/)).toBeUndefined();
  await press(/(?:Retry|Try).*App Store/);
  expect(rig.product).toHaveBeenCalledTimes(2);
  expect(button('Subscribe · €3,99 / month')).toBeDefined();
});

it('invalidates an in-flight purchase after switching the authenticated account', async () => {
  let complete!: (value: string) => void;
  rig.purchase.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  await mount();
  await press('Subscribe · €3,99 / month');
  const [owner, , current] = rig.purchase.mock.calls[0]!;
  expect(owner).toBe(rig.owner);
  expect(current()).toBe(true);
  rig.owner = '05bdfdd6-4dfc-47d9-bd4a-a42d4c8fd8f5';
  await act(async () => {
    renderer!.update(React.createElement(TokensScreen));
  });
  expect(current()).toBe(false);
  await act(async () => {
    complete('purchased');
  });
  expect(rig.refresh).not.toHaveBeenCalled();
  expect(content()).not.toContain('Your tokens are ready.');
});
