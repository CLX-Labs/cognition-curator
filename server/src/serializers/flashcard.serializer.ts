import { Flashcard } from '@prisma/client';

export const serializeFlashcard = (card: Flashcard) => ({
  id: card.id,
  front: card.front,
  back: card.back,
  hint: card.hint,
  explanation: card.explanation,
  deck_id: card.deckId,
  tags: card.tags,
  is_active: card.isActive,
  status: card.status,
  ease_factor: card.easeFactor,
  interval_days: card.intervalDays,
  repetitions: card.repetitions,
  next_review_date: card.nextReviewDate.toISOString(),
  last_reviewed_at: card.lastReviewedAt?.toISOString() ?? null,
  total_reviews: card.totalReviews,
  correct_reviews: card.correctReviews,
  ai_generated: card.aiGenerated,
  created_at: card.createdAt.toISOString(),
  updated_at: card.updatedAt.toISOString(),
});
