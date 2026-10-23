import { buildRecallInsights, type InsightDays } from '@recollect/contracts';
import type { LocalSnapshot } from './repository';

export function personalInsights(data: LocalSnapshot, days: InsightDays, deckId?: string) {
  const decks = new Map(
    data.decks.filter((deck) => !deck.deletedAt).map((deck) => [deck.id, deck]),
  );
  return buildRecallInsights({
    cards: data.cards
      .filter(
        (card) => !card.deletedAt && decks.has(card.deckId) && (!deckId || card.deckId === deckId),
      )
      .map((card) => ({
        id: card.id,
        deckId: card.deckId,
        deckName: decks.get(card.deckId)!.name,
        front: card.front,
        back: card.back,
      })),
    reviews: data.reviews,
    days,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  });
}
