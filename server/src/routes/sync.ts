import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../db/prisma';
import { requireAuth } from '../middleware/stytchAuth';
import { createError } from '../middleware/errorHandler';

const router = Router();

router.use(requireAuth);

// ---------------------------------------------------------------------------
// POST /api/sync/flashcard-review
// Records a review session and updates flashcard SM-2 state.
// The iOS app is authoritative for SM-2 calculations; it sends the
// pre-computed ease/interval/repetition values.
// ---------------------------------------------------------------------------
const flashcardReviewSchema = z.object({
  flashcard_id: z.string().uuid(),
  deck_id: z.string().uuid(),
  difficulty_rating: z.number().int().min(0).max(3),
  was_correct: z.boolean(),
  response_time_seconds: z.number().min(0),
  session_type: z.string().default('standard'),
  review_context: z.string().optional(),
  ease_factor_before: z.number().optional(),
  ease_factor_after: z.number().optional(),
  interval_before_days: z.number().int().optional(),
  interval_after_days: z.number().int().optional(),
  repetitions_before: z.number().int().optional(),
  repetitions_after: z.number().int().optional(),
  confidence_level: z.number().optional(),
  hint_used: z.boolean().optional().default(false),
  multiple_attempts: z.boolean().optional().default(false),
  device_type: z.string().optional(),
  app_version: z.string().optional(),
  platform: z.string().optional(),
});

router.post('/flashcard-review', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = flashcardReviewSchema.parse(req.body);

    const card = await prisma.flashcard.findUnique({
      where: { id: data.flashcard_id },
      include: { deck: { select: { userId: true } } },
    });

    if (!card || card.deck.userId !== req.user.id) {
      return next(createError('Flashcard not found', 404, 'not_found'));
    }

    const now = new Date();
    const easeBefore = data.ease_factor_before ?? card.easeFactor;
    const easeAfter = data.ease_factor_after ?? card.easeFactor;
    const intervalBefore = data.interval_before_days ?? card.intervalDays;
    const intervalAfter = data.interval_after_days ?? card.intervalDays;
    const repsBefore = data.repetitions_before ?? card.repetitions;
    const repsAfter = data.repetitions_after ?? card.repetitions;

    // Next review date from the new interval
    const nextReviewDate = new Date(now);
    nextReviewDate.setDate(nextReviewDate.getDate() + intervalAfter);

    const [session] = await prisma.$transaction([
      prisma.reviewSession.create({
        data: {
          id: uuidv4(),
          userId: req.user.id,
          deckId: data.deck_id,
          flashcardId: data.flashcard_id,
          difficultyRating: data.difficulty_rating,
          wasCorrect: data.was_correct,
          responseTimeSeconds: data.response_time_seconds,
          sessionType: data.session_type,
          reviewContext: data.review_context ?? null,
          easeFactorBefore: easeBefore,
          easeFactorAfter: easeAfter,
          intervalBeforeDays: intervalBefore,
          intervalAfterDays: intervalAfter,
          repetitionsBefore: repsBefore,
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

    res.status(201).json({
      review_session_id: session.id,
      next_review_date: nextReviewDate.toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/sync/study-session
// Records a completed study session summary.
// ---------------------------------------------------------------------------
const studySessionSchema = z.object({
  deck_id: z.string().uuid().optional(),
  session_type: z.string().default('standard'),
  session_name: z.string().optional(),
  started_at: z.string().datetime(),
  ended_at: z.string().datetime().optional(),
  duration_minutes: z.number().int().min(0),
  cards_reviewed: z.number().int().min(0),
  cards_correct: z.number().int().min(0),
  cards_incorrect: z.number().int().min(0),
  accuracy_rate: z.number().min(0).max(1),
  cards_new_studied: z.number().int().min(0).default(0),
  cards_graduated: z.number().int().min(0).default(0),
  cards_mastered: z.number().int().min(0).default(0),
  cards_reset: z.number().int().min(0).default(0),
  average_response_time_seconds: z.number().min(0).default(0),
  total_think_time_seconds: z.number().int().min(0).default(0),
  session_quality_score: z.number().min(0).max(1).default(0.5),
  focus_score: z.number().min(0).max(1).default(0.5),
  difficulty_distribution: z.record(z.number()).default({}),
  platform: z.string().optional(),
  device_type: z.string().optional(),
  app_version: z.string().optional(),
  goal_achieved: z.boolean().default(false),
  notes: z.string().optional(),
});

router.post('/study-session', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = studySessionSchema.parse(req.body);

    if (data.deck_id) {
      const deck = await prisma.deck.findUnique({ where: { id: data.deck_id } });
      if (!deck || deck.userId !== req.user.id) {
        return next(createError('Deck not found', 404, 'not_found'));
      }
    }

    const session = await prisma.studySession.create({
      data: {
        id: uuidv4(),
        userId: req.user.id,
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

    // Update user aggregate stats
    await prisma.user.update({
      where: { id: req.user.id },
      data: {
        totalStudyTimeMinutes: { increment: data.duration_minutes },
        totalCardsReviewed: { increment: data.cards_reviewed },
        updatedAt: new Date(),
      },
    });

    res.status(201).json({ study_session_id: session.id });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/sync/user-stats
// Client-initiated stat sync (streak, accuracy, etc.).
// ---------------------------------------------------------------------------
const userStatsSchema = z.object({
  current_streak_days: z.number().int().optional(),
  longest_streak_days: z.number().int().optional(),
  overall_accuracy_rate: z.number().min(0).max(1).optional(),
  mastery_rate: z.number().min(0).max(1).optional(),
});

router.post('/user-stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = userStatsSchema.parse(req.body);

    await prisma.user.update({
      where: { id: req.user.id },
      data: {
        ...(data.current_streak_days !== undefined && { currentStreakDays: data.current_streak_days }),
        ...(data.longest_streak_days !== undefined && { longestStreakDays: data.longest_streak_days }),
        ...(data.overall_accuracy_rate !== undefined && { overallAccuracyRate: data.overall_accuracy_rate }),
        ...(data.mastery_rate !== undefined && { masteryRate: data.mastery_rate }),
        updatedAt: new Date(),
      },
    });

    res.json({ message: 'Stats updated' });
  } catch (err) {
    next(err);
  }
});

export { router as syncRouter };
