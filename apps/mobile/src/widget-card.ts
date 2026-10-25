import type { Card } from '@recollect/contracts';
import type { LocalSnapshot } from './repository';
import type { WidgetSnapshot } from '../modules/recollect-widget';

/** Prefer a due card; otherwise retain a random library card until it is removed. */
export function selectWidgetCard(
  snapshot: Pick<LocalSnapshot, 'decks' | 'cards'>,
  due: readonly Card[],
  previousFallbackId?: string | null,
  random = Math.random,
): Card | undefined {
  if (due[0]) return due[0];
  const decks = new Set(snapshot.decks.filter((deck) => !deck.deletedAt).map((deck) => deck.id));
  const cards = snapshot.cards.filter((card) => !card.deletedAt && decks.has(card.deckId));
  const previous = cards.find((card) => card.id === previousFallbackId);
  if (previous || !cards.length) return previous;
  return cards[Math.floor(random() * cards.length)];
}

/** Bound text before crossing the native bridge's encoded snapshot size limit. */
export function widgetCardPreview(
  card: Card,
  deckName: string,
): NonNullable<WidgetSnapshot['topCard']> {
  const clip = (value: string, length: number) => Array.from(value).slice(0, length).join('');
  return {
    id: card.id,
    question: clip(card.front, 500),
    answer: clip(card.back, 500),
    deckName: clip(deckName, 100),
  };
}
