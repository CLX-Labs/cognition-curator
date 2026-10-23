import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Card, Deck, ReviewEvent } from '@recollect/contracts';
import { initialSchedule } from '@recollect/scheduler';
import { personalInsights } from '../src/personal-insights';
import { Repository, type LocalSnapshot } from '../src/repository';
import { TestDatabase } from './sqlite';

const now = '2026-10-22T12:00:00.000Z';
const databases: TestDatabase[] = [];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
});
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function deck(ownerId = randomUUID(), name = 'Italian'): Deck {
  return {
    id: randomUUID(),
    ownerId,
    name,
    description: '',
    color: '#113355',
    icon: '🇮🇹',
    isSilenced: false,
    silencedUntil: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}
function card(parent: Deck, front = 'Ciao'): Card {
  return {
    id: randomUUID(),
    ownerId: parent.ownerId,
    deckId: parent.id,
    front,
    back: 'Hello',
    hint: '',
    explanation: '',
    tags: [],
    aiGenerated: false,
    schedule: initialSchedule(now),
    version: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}
function review(
  source: Card,
  sequence: number,
  rating: ReviewEvent['rating'] = 'good',
  at = now,
): ReviewEvent {
  return {
    id: randomUUID(),
    cardId: source.id,
    deckId: source.deckId,
    deviceId: source.ownerId,
    deviceSequence: sequence,
    rating,
    reviewedAt: at,
    elapsedMs: 500,
    algorithmVersion: 'sm2-v2',
  };
}
function snapshot(decks: Deck[], cards: Card[], reviews: ReviewEvent[] = []): LocalSnapshot {
  return { decks, cards, reviews, pending: 0, issues: [] };
}
async function repository(database?: TestDatabase, ownerId = randomUUID()) {
  const db = database ?? new TestDatabase();
  if (!database) databases.push(db);
  const repo = new Repository(db, ownerId, randomUUID(), randomUUID, () => now);
  await repo.initialize();
  const sourceDeck = deck(ownerId);
  const sourceCard = card(sourceDeck);
  await repo.applyChanges([
    { revision: '1', entity: 'deck', data: sourceDeck },
    { revision: '2', entity: 'card', data: sourceCard },
  ]);
  return { db, repo, sourceDeck, sourceCard };
}

describe('personal insights from the local library', () => {
  it('includes a durable offline review immediately and counts its eventual server echo once', async () => {
    const { repo, sourceCard } = await repository();
    const event = await repo.rateCard(sourceCard.id, 'good', 1_250);
    const local = await repo.snapshot();
    expect(local.pending).toBe(1);
    expect(personalInsights(local, null).summary).toMatchObject({
      reviewCount: 1,
      rememberedCount: 1,
      unsureCount: 0,
      recallRate: 100,
    });
    await repo.applyChanges([{ revision: '3', entity: 'review', data: event }]);
    const withEcho = personalInsights(await repo.snapshot(), null);
    expect(withEcho.summary.reviewCount).toBe(1);
    expect(withEcho.cards[0]!.history).toMatchObject([{ id: event.id, elapsedMs: 1_250 }]);
  });

  it('uses the repository’s account partition when two accounts have offline history on one device', async () => {
    const first = await repository();
    const second = await repository(first.db);
    await first.repo.rateCard(first.sourceCard.id, 'good', 100);
    await second.repo.rateCard(second.sourceCard.id, 'again', 200);
    const firstInsights = personalInsights(await first.repo.snapshot(), null);
    const secondInsights = personalInsights(await second.repo.snapshot(), null);
    expect(firstInsights.cards.map((item) => item.id)).toEqual([first.sourceCard.id]);
    expect(secondInsights.cards.map((item) => item.id)).toEqual([second.sourceCard.id]);
    expect(firstInsights.summary).toMatchObject({ reviewCount: 1, rememberedCount: 1 });
    expect(secondInsights.summary).toMatchObject({ reviewCount: 1, unsureCount: 1 });
  });

  it('limits deck-specific reports and excludes removed or orphaned cards without losing silenced-deck history', () => {
    const italian = deck();
    const silenced = { ...deck(italian.ownerId, 'Biology'), isSilenced: true };
    const removed = { ...deck(italian.ownerId, 'Removed'), deletedAt: now };
    const italianCard = card(italian);
    const silencedCard = card(silenced, 'ATP');
    const removedDeckCard = card(removed, 'Removed deck card');
    const removedCard = { ...card(italian, 'Removed card'), deletedAt: now };
    const orphan = card(deck(italian.ownerId), 'Orphan');
    const cards = [italianCard, silencedCard, removedDeckCard, removedCard, orphan];
    const data = snapshot(
      [italian, silenced, removed],
      cards,
      cards.map((item, index) => review(item, index + 1)),
    );
    const all = personalInsights(data, null);
    expect(all.cards.map((item) => item.front)).toEqual(['Ciao', 'ATP']);
    expect(all.summary.reviewCount).toBe(2);
    const selected = personalInsights(data, null, italian.id);
    expect(selected.cards.map((item) => item.id)).toEqual([italianCard.id]);
    expect(selected.cards[0]!.deckName).toBe('Italian');
    expect(selected.summary.reviewCount).toBe(1);
    expect(personalInsights(data, null, removed.id).summary.cardCount).toBe(0);
  });

  it('passes the selected range and device timezone through while leaving local content unchanged', () => {
    const nativeOptions = new Intl.DateTimeFormat().resolvedOptions();
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      ...nativeOptions,
      timeZone: 'America/New_York',
    });
    const sourceDeck = deck();
    const sourceCard = card(sourceDeck);
    const data = snapshot(
      [sourceDeck],
      [sourceCard],
      [
        review(sourceCard, 1, 'again', '2026-10-15T12:00:00.000Z'),
        review(sourceCard, 2, 'good', '2026-10-22T03:30:00.000Z'),
      ],
    );
    const before = structuredClone(data);
    const insights = personalInsights(data, 7);
    expect(insights.window).toMatchObject({
      days: 7,
      timezone: 'America/New_York',
      since: '2026-10-16T04:00:00.000Z',
    });
    expect(insights.summary).toMatchObject({ reviewCount: 1, rememberedCount: 1 });
    expect(insights.daily.find((day) => day.date === '2026-10-21')?.reviewCount).toBe(1);
    expect(personalInsights(data, 30).summary.reviewCount).toBe(2);
    expect(data).toEqual(before);
  });

  it('does not manufacture historical answers from imported checkpoint totals', () => {
    const sourceDeck = deck();
    const sourceCard = card(sourceDeck);
    sourceCard.schedule = {
      ...sourceCard.schedule,
      totalReviews: 200,
      repetitions: 190,
      lapses: 10,
      lastReviewedAt: now,
    };
    const insights = personalInsights(snapshot([sourceDeck], [sourceCard]), null);
    expect(insights.summary).toMatchObject({
      cardCount: 1,
      unreviewedCardCount: 1,
      reviewCount: 0,
      recallRate: null,
    });
    expect(insights.cards[0]!.history).toEqual([]);
  });
});
