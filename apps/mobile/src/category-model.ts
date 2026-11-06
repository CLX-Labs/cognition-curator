import {
  DEFAULT_REVIEW_CADENCE,
  categoryForDeck,
  defaultReviewSettingsInput,
  reviewCadenceSchema,
  scheduledReviewEnabled,
  type ReviewCadence,
  type ReviewSettings,
  type ReviewSettingsInput,
} from '@recollect/contracts';
import { activeDeck, dueCards, reviewSettingsContent, type LocalSnapshot } from './repository';

export function settingsInput(
  settings: ReviewSettings | null | undefined,
  ownerId: string,
): ReviewSettingsInput {
  return reviewSettingsContent(settings ?? defaultReviewSettingsInput(ownerId));
}
export type CadenceDraft = Record<Exclude<keyof ReviewCadence, 'growIntervals'>, string> & {
  growIntervals: boolean;
};
export function cadenceDraft(cadence: ReviewCadence = DEFAULT_REVIEW_CADENCE): CadenceDraft {
  return {
    againDays: String(cadence.againDays),
    hardDays: String(cadence.hardDays),
    goodDays: String(cadence.goodDays),
    easyDays: String(cadence.easyDays),
    maxIntervalDays: String(cadence.maxIntervalDays),
    growIntervals: cadence.growIntervals,
  };
}
export function parseCadence(draft: CadenceDraft): ReviewCadence | null {
  const parsed = reviewCadenceSchema.safeParse({
    againDays: Number(draft.againDays),
    hardDays: Number(draft.hardDays),
    goodDays: Number(draft.goodDays),
    easyDays: Number(draft.easyDays),
    maxIntervalDays: Number(draft.maxIntervalDays),
    growIntervals: draft.growIntervals,
  });
  return parsed.success ? parsed.data : null;
}
export function categorySummary(data: LocalSnapshot, categoryId: string | null, now = Date.now()) {
  const decks = data.decks.filter(
    (deck) =>
      !deck.deletedAt && (categoryForDeck(data.reviewSettings, deck.id)?.id ?? null) === categoryId,
  );
  const ids = new Set(decks.map((deck) => deck.id));
  const cards = data.cards.filter((card) => !card.deletedAt && ids.has(card.deckId));
  const due = dueCards(data, now, categoryId);
  const deckMap = new Map(decks.map((deck) => [deck.id, deck]));
  const nextDue = cards.reduce<number | null>((next, card) => {
    const deck = deckMap.get(card.deckId)!;
    if (!scheduledReviewEnabled(data.reviewSettings, deck.id)) return next;
    if (!activeDeck(deck, now) && !deck.silencedUntil) return next;
    const date = Math.max(
      Date.parse(card.schedule.dueAt),
      deck.isSilenced && deck.silencedUntil ? Date.parse(deck.silencedUntil) : 0,
    );
    return date > now && (next === null || date < next) ? date : next;
  }, null);
  return { decks, cards, due, nextDue };
}
