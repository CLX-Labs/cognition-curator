import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { buildRecallInsights } from '@recollect/contracts';

vi.mock('react-native', () => ({
  View: ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement('view', props, children),
  Pressable: () => null,
}));
vi.mock('../src/ui', () => ({
  Text: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('text', {}, children),
  Panel: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('panel', {}, children),
  Button: () => null,
  Empty: () => null,
  Field: () => null,
  colors: {},
  s: {},
}));
import { InsightSummary } from '../src/insight-panels';

let renderer: ReactTestRenderer | null = null;
beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true));
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = null;
  vi.unstubAllGlobals();
});

it('distinguishes an empty selected range from existing history when drawing the summary', async () => {
  const cardId = '00000000-0000-4000-8000-000000000010';
  const deckId = '00000000-0000-4000-8000-000000000011';
  const input = {
    cards: [{ id: cardId, deckId, deckName: 'Italian', front: 'Ciao', back: 'Hello' }],
    reviews: [
      {
        id: '00000000-0000-4000-8000-000000000012',
        cardId,
        deckId,
        deviceId: '00000000-0000-4000-8000-000000000013',
        deviceSequence: 1,
        rating: 'good' as const,
        reviewedAt: '2026-10-01T12:00:00.000Z',
        elapsedMs: 500,
        algorithmVersion: 'sm2-v2' as const,
      },
    ],
    now: '2026-10-22T12:00:00.000Z',
    timezone: 'UTC',
  };
  const recent = buildRecallInsights({ ...input, days: 7 });
  expect(recent.weekly.length).toBeGreaterThan(0);
  expect(recent.summary.reviewCount).toBe(0);
  await act(async () => {
    renderer = create(React.createElement(InsightSummary, { insights: recent }));
  });
  const chartWeeks = () =>
    renderer!.root.findAll(
      (node) =>
        typeof node.type === 'string' &&
        String(node.props.accessibilityLabel ?? '').startsWith('Week of '),
    );
  expect(chartWeeks()).toHaveLength(0);
  expect(JSON.stringify(renderer!.toJSON())).toContain('no responses in this period');

  const all = buildRecallInsights({ ...input, days: null });
  await act(async () => renderer!.update(React.createElement(InsightSummary, { insights: all })));
  expect(chartWeeks().length).toBeGreaterThan(0);
  expect(all.summary.reviewCount).toBe(1);
  expect(JSON.stringify(renderer!.toJSON())).not.toContain('no responses in this period');
});
