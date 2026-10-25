import { expect, it, vi } from 'vitest';
import type { Card, Deck } from '@recollect/contracts';
import { initialSchedule } from '@recollect/scheduler';
import { selectWidgetCard, widgetCardPreview } from '../src/widget-card';

const timestamp = '2026-10-25T12:00:00.000Z';
const deck: Deck = {
  id: 'deck',
  ownerId: 'owner',
  name: 'Italian',
  description: '',
  color: '#123456',
  icon: '📚',
  isSilenced: true,
  silencedUntil: null,
  version: 1,
  createdAt: timestamp,
  updatedAt: timestamp,
  deletedAt: null,
};
const card = (id: string): Card => ({
  id,
  ownerId: deck.ownerId,
  deckId: deck.id,
  front: id,
  back: 'Answer',
  hint: '',
  explanation: '',
  tags: [],
  aiGenerated: false,
  version: 1,
  createdAt: timestamp,
  updatedAt: timestamp,
  deletedAt: null,
  schedule: initialSchedule('2026-11-25T12:00:00.000Z'),
});
const first = card('first'),
  second = card('second');
const library = { decks: [deck], cards: [first, second] };

it('chooses a random saved card even when nothing is due and its deck is paused', () => {
  expect(selectWidgetCard(library, [], null, () => 0)).toBe(first);
  expect(selectWidgetCard(library, [], null, () => 0.99)).toBe(second);
});

it('retains the same fallback through refreshes while reflecting edits to its content', () => {
  const random = vi.fn(() => 0);
  const edited = { ...second, front: 'Edited question' };
  expect(selectWidgetCard({ ...library, cards: [first, edited] }, [], second.id, random)).toBe(
    edited,
  );
  expect(random).not.toHaveBeenCalled();
});

it('replaces a removed fallback, skips deleted or orphaned cards, and prioritizes due cards', () => {
  expect(selectWidgetCard(library, [first], second.id, () => 0.99)).toBe(first);
  expect(selectWidgetCard({ decks: [deck], cards: [first] }, [], second.id, () => 0)).toBe(first);
  const invalid = [
    { ...first, deletedAt: timestamp },
    { ...second, deckId: 'removed-deck' },
  ];
  expect(selectWidgetCard({ decks: [deck], cards: invalid }, [], second.id)).toBeUndefined();
  expect(selectWidgetCard({ decks: [], cards: [first] }, [])).toBeUndefined();
  expect(selectWidgetCard({ decks: [deck], cards: [] }, [])).toBeUndefined();
});

it('bounds multilingual card previews before the native widget payload limit without broken surrogates', () => {
  const preview = widgetCardPreview(
    { ...first, front: '😀'.repeat(20_000), back: '漢'.repeat(30_000) },
    '🌱'.repeat(200),
  );
  expect(preview.question).toBe('😀'.repeat(500));
  expect(preview.answer).toBe('漢'.repeat(500));
  expect(preview.deckName).toBe('🌱'.repeat(100));
  expect(preview.id).toBe(first.id);
  expect(Buffer.byteLength(JSON.stringify(preview))).toBeLessThan(131_072);
});
