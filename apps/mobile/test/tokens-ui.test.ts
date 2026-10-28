import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { TokenWallet } from '@recollect/contracts';

const rig = vi.hoisted(() => ({
  owner: '00000000-0000-4000-8000-000000000001',
  focused: true,
  active: true,
  fetch: vi.fn(),
  push: vi.fn(),
  listener: null as null | ((owner: string) => void),
}));
vi.mock('react-native', () => ({
  View: ({ children }: { children: React.ReactNode }) => React.createElement('view', {}, children),
}));
vi.mock('expo-router', () => ({ router: { push: rig.push } }));
vi.mock('expo-router/react-navigation', () => ({ useIsFocused: () => rig.focused }));
vi.mock('../src/polling', () => ({ useAppActive: () => rig.active }));
vi.mock('../src/store', () => ({ useStore: () => ({ repository: { ownerId: rig.owner } }) }));
vi.mock('../src/tokens', () => ({
  fetchTokenWallet: rig.fetch,
  onTokenWalletChanged: (listener: (owner: string) => void) => {
    rig.listener = listener;
    return () => {
      rig.listener = null;
    };
  },
}));
vi.mock('../src/ui', () => ({
  Text: ({ children }: { children: React.ReactNode }) => React.createElement('text', {}, children),
  Panel: ({ children }: { children: React.ReactNode }) =>
    React.createElement('panel', {}, children),
  Button: (props: object) => React.createElement('button', props),
  s: {},
}));
import TokenBalancePanel, { GenerationTokenNotice } from '../src/tokens-ui';

const wallet: TokenWallet = {
  available: 9,
  free: 9,
  paid: 0,
  earned: 0,
  reserved: 1,
  freeMonthlyAllowance: 10,
  freeResetsAt: '2026-11-01T00:00:00.000Z',
  subscription: { active: false, productId: null, renewsAt: null },
  enabled: true,
  billing: {
    available: false,
    productId: 'collect.software.recollect.tokens.monthly',
    monthlyTokens: 100,
    priceUsd: 3.99,
  },
};
let renderer: ReactTestRenderer | null;
beforeEach(() => {
  rig.owner = '00000000-0000-4000-8000-000000000001';
  rig.focused = true;
  rig.active = true;
  rig.fetch.mockReset().mockResolvedValue(wallet);
  rig.push.mockReset();
});
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = null;
});
async function mount(element: React.ReactElement) {
  await act(async () => {
    renderer = create(element);
  });
  return renderer!;
}
const text = () => JSON.stringify(renderer?.toJSON());

it('shows the authenticated available balance without periodic rerenders or polling', async () => {
  const element = React.createElement(TokenBalancePanel);
  const view = await mount(element);
  expect(rig.fetch).toHaveBeenCalledExactlyOnceWith(rig.owner);
  expect(text()).toContain('9');
  await act(async () => view.update(element));
  expect(rig.fetch).toHaveBeenCalledTimes(1);
  const manage = view.root
    .findAllByType('button')
    .find((button) => button.props.title === 'Manage tokens')!;
  await act(async () => manage.props.onPress());
  expect(rig.push).toHaveBeenCalledWith('/tokens');
});

it('hides generation charges when charging is disabled and shows a zero balance when enabled', async () => {
  rig.fetch.mockResolvedValueOnce({ ...wallet, enabled: false });
  const view = await mount(React.createElement(GenerationTokenNotice, { refreshKey: 1 }));
  expect(view.toJSON()).toBeNull();
  rig.fetch.mockResolvedValueOnce({ ...wallet, available: 0, free: 0 });
  await act(async () => view.update(React.createElement(GenerationTokenNotice, { refreshKey: 2 })));
  expect(text()).toContain('0');
  expect(text()).toContain('One token when you accept');
});

it('drops a late account response and never shows a previous owner’s credits', async () => {
  let complete!: (value: TokenWallet) => void;
  rig.fetch.mockImplementationOnce(
    () =>
      new Promise<TokenWallet>((resolve) => {
        complete = resolve;
      }),
  );
  const view = await mount(React.createElement(TokenBalancePanel));
  rig.owner = '00000000-0000-4000-8000-000000000002';
  rig.fetch.mockResolvedValueOnce({ ...wallet, available: 3, free: 3 });
  await act(async () => view.update(React.createElement(TokenBalancePanel)));
  await act(async () => complete({ ...wallet, available: 999 }));
  expect(text()).toContain('3');
  expect(text()).not.toContain('999');
});

it('refreshes after an owner-specific purchase notification and ignores other owners', async () => {
  await mount(React.createElement(TokenBalancePanel));
  await act(async () => rig.listener?.('another-account'));
  expect(rig.fetch).toHaveBeenCalledTimes(1);
  rig.fetch.mockResolvedValueOnce({ ...wallet, available: 109, paid: 100 });
  await act(async () => rig.listener?.(rig.owner));
  expect(rig.fetch).toHaveBeenCalledTimes(2);
  expect(text()).toContain('109');
});

it('keeps the last balance visible offline and waits until foreground focus to refresh', async () => {
  const view = await mount(React.createElement(TokenBalancePanel));
  rig.focused = false;
  await act(async () => view.update(React.createElement(TokenBalancePanel)));
  expect(rig.fetch).toHaveBeenCalledTimes(1);
  rig.fetch.mockRejectedValueOnce(new Error('offline'));
  rig.focused = true;
  await act(async () => view.update(React.createElement(TokenBalancePanel)));
  expect(text()).toContain('9');
  expect(text()).toContain('Connect to see your current balance');
});
