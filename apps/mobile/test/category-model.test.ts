import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import {
  defaultReviewSettingsInput,
  type Card,
  type Deck,
  type ReviewSettings,
} from '@recollect/contracts';
import { initialSchedule } from '@recollect/scheduler';
import { cadenceDraft, categorySummary, parseCadence } from '../src/category-model';
import type { LocalSnapshot } from '../src/repository';

function fixture() {
  const at = '2026-10-29T12:00:00.000Z',
    now = Date.parse(at),
    owner = randomUUID(),
    categoryId = randomUUID();
  const deck: Deck = {
    id: randomUUID(),
    ownerId: owner,
    name: 'History',
    description: '',
    color: '#DDD9E8',
    icon: '',
    isSilenced: false,
    silencedUntil: null,
    version: 1,
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
  };
  const card: Card = {
    id: randomUUID(),
    ownerId: owner,
    deckId: deck.id,
    front: 'Austen',
    back: 'Pride and Prejudice',
    hint: '',
    explanation: '',
    tags: [],
    aiGenerated: false,
    schedule: { ...initialSchedule(at), dueAt: new Date(now + 86_400_000).toISOString() },
    version: 1,
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
  };
  const settings: ReviewSettings = {
    ...defaultReviewSettingsInput(owner),
    ownerId: owner,
    version: 1,
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
    categories: [
      { id: categoryId, name: 'Jeopardy', color: '#DDD9E8', reviewEnabled: true, cadence: null },
    ],
    deckCategories: { [deck.id]: categoryId },
  };
  const data: LocalSnapshot = {
    decks: [deck],
    cards: [card],
    reviews: [],
    pending: 0,
    issues: [],
    reviewSettings: settings,
  };
  return { data, now, categoryId, deck, card, settings };
}
it('never advertises a next due card in an indefinitely paused deck', () => {
  const { data, now, categoryId, deck } = fixture();
  data.decks = [{ ...deck, isSilenced: true }];
  expect(categorySummary(data, categoryId, now)).toMatchObject({ due: [], nextDue: null });
  expect(categorySummary(data, categoryId, now).cards).toHaveLength(1);
});
it('reports the later of the due date and a timed deck pause ending', () => {
  const { data, now, categoryId, deck } = fixture();
  const resumeAt = now + 3 * 86_400_000;
  data.decks = [{ ...deck, isSilenced: true, silencedUntil: new Date(resumeAt).toISOString() }];
  expect(categorySummary(data, categoryId, now).nextDue).toBe(resumeAt);
});
it('keeps paused categories and a paused global queue out of next-due summaries', () => {
  const { data, now, categoryId, settings } = fixture();
  data.reviewSettings = { ...settings, reviewEnabled: false };
  expect(categorySummary(data, categoryId, now).nextDue).toBeNull();
  data.reviewSettings = {
    ...settings,
    categories: settings.categories.map((category) => ({ ...category, reviewEnabled: false })),
  };
  expect(categorySummary(data, categoryId, now).nextDue).toBeNull();
});
it('keeps uncategorized and category counts separate without including deleted cards', () => {
  const { data, now, categoryId, card } = fixture();
  data.cards = [card, { ...card, id: randomUUID(), deletedAt: new Date(now).toISOString() }];
  expect(categorySummary(data, categoryId, now).cards).toHaveLength(1);
  expect(categorySummary(data, null, now).cards).toHaveLength(0);
});
it('rejects empty, fractional, and out-of-order cadence fields while preserving the fixed/growing choice', () => {
  const draft = cadenceDraft();
  expect(parseCadence(draft)?.goodDays).toBe(7);
  expect(parseCadence({ ...draft, againDays: '' })).toBeNull();
  expect(parseCadence({ ...draft, goodDays: '2.5' })).toBeNull();
  expect(parseCadence({ ...draft, easyDays: '4' })).toBeNull();
  expect(parseCadence({ ...draft, growIntervals: false })?.growIntervals).toBe(false);
});
