import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../db/prisma';
import { NotFoundError } from '../utils/errors';
import { FlashcardReviewInput, StudySessionInput, UserStatsInput } from '../schemas/sync.schema';

export const SyncService = {
  recordFlashcardReview: async (userId: string, data: FlashcardReviewInput) => {
    const card = await prisma.flashcard.findUnique({
      where: { id: data.flashcard_id },
      include: { deck: { select: { userId: true } } },
    });
    if (!card || card.deck.userId !== userId) throw new NotFoundError('Flashcard not found');

    const now = new Date();
    const easeAfter = data.ease_factor_after ?? card.easeFactor;
    const intervalAfter = data.interval_after_days ?? card.intervalDays;
    const repsAfter = data.repetitions_after ?? card.repetitions;

    const nextReviewDate = new Date(now);
    nextReviewDate.setDate(nextReviewDate.getDate() + intervalAfter);

    const [session] = await prisma.$transaction([
      prisma.reviewSession.create({
        data: {
          id: uuidv4(),
          userId,
          deckId: data.deck_id,
          flashcardId: data.flashcard_id,
          difficultyRating: data.difficulty_rating,
          wasCorrect: data.was_correct,
          responseTimeSeconds: data.response_time_seconds,
          sessionType: data.session_type,
          reviewContext: data.review_context ?? null,
          easeFactorBefore: data.ease_factor_before ?? card.easeFactor,
          easeFactorAfter: easeAfter,
          intervalBeforeDays: data.interval_before_days ?? card.intervalDays,
          intervalAfterDays: intervalAfter,
          repetitionsBefore: data.repetitions_before ?? card.repetitions,
          repetitionsAfter: repsAfter,
          confidenceLevel: data.confidence_level ?? null,
          hintUsed: data.hint_used,
          multipleAttempts: data.multiple_attempts,
          reviewedAt: now,
          timeOfDayHour: now.getHours(),
          dayOfWeek: now.getDay(),
          platform: data.platform ?? null,
          deviceType: data.device_type ?? null,
          appVersion: data.app_version ?? null,
        },
      }),
      prisma.flashcard.update({
        where: { id: data.flashcard_id },
        data: {
          easeFactor: easeAfter,
          intervalDays: intervalAfter,
          repetitions: repsAfter,
          nextReviewDate,
          lastReviewedAt: now,
          totalReviews: { increment: 1 },
          correctReviews: data.was_correct ? { increment: 1 } : undefined,
          streakCorrect: data.was_correct ? { increment: 1 } : 0,
          mistakeCount: data.was_correct ? undefined : { increment: 1 },
          updatedAt: now,
        },
      }),
    ]);

    return { reviewSessionId: session.id, nextReviewDate };
  },

  recordStudySession: async (userId: string, data: StudySessionInput) => {
    if (data.deck_id) {
      const deck = await prisma.deck.findUnique({ where: { id: data.deck_id } });
      if (!deck || deck.userId !== userId) throw new NotFoundError('Deck not found');
    }

    const session = await prisma.studySession.create({
      data: {
        id: uuidv4(),
        userId,
        deckId: data.deck_id ?? null,
        sessionType: data.session_type,
        sessionName: data.session_name ?? null,
        startedAt: new Date(data.started_at),
        endedAt: data.ended_at ? new Date(data.ended_at) : null,
        durationMinutes: data.duration_minutes,
        cardsReviewed: data.cards_reviewed,
        cardsCorrect: data.cards_correct,
        cardsIncorrect: data.cards_incorrect,
        accuracyRate: data.accuracy_rate,
        cardsNewStudied: data.cards_new_studied,
        cardsGraduated: data.cards_graduated,
        cardsMastered: data.cards_mastered,
        cardsReset: data.cards_reset,
        averageResponseTimeSeconds: data.average_response_time_seconds,
        totalThinkTimeSeconds: data.total_think_time_seconds,
        sessionQualityScore: data.session_quality_score,
        focusScore: data.focus_score,
        difficultyDistribution: data.difficulty_distribution,
        platform: data.platform ?? null,
        deviceType: data.device_type ?? null,
        appVersion: data.app_version ?? null,
        interruptionsCount: 0,
        goalAchieved: data.goal_achieved,
        notes: data.notes ?? null,
      },
    });

    await prisma.user.update({
      where: { id: userId },
      data: {
        totalStudyTimeMinutes: { increment: data.duration_minutes },
        totalCardsReviewed: { increment: data.cards_reviewed },
        updatedAt: new Date(),
      },
    });

    return session.id;
  },

  updateUserStats: async (userId: string, data: UserStatsInput) => {
    await prisma.user.update({
      where: { id: userId },
      data: {
        ...(data.current_streak_days !== undefined && {
          currentStreakDays: data.current_streak_days,
        }),
        ...(data.longest_streak_days !== undefined && {
          longestStreakDays: data.longest_streak_days,
        }),
        ...(data.overall_accuracy_rate !== undefined && {
          overallAccuracyRate: data.overall_accuracy_rate,
        }),
        ...(data.mastery_rate !== undefined && { masteryRate: data.mastery_rate }),
        updatedAt: new Date(),
      },
    });
  },
};
