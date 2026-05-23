import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../db/prisma';
import { requireAuth } from '../middleware/stytchAuth';
import { createError } from '../middleware/errorHandler';

const router = Router();

router.use(requireAuth);

const flashcardCreateSchema = z.object({
  front: z.string().min(1),
  back: z.string().min(1),
  hint: z.string().optional(),
  explanation: z.string().optional(),
  deck_id: z.string().uuid(),
  tags: z.array(z.string()).optional().default([]),
  ai_generated: z.boolean().optional().default(false),
  ai_generation_prompt: z.string().optional(),
  ai_model_used: z.string().optional(),
});

const batchFlashcardSchema = z.object({
  deck_id: z.string().uuid(),
  flashcards: z.array(
    z.object({
      front: z.string().min(1),
      back: z.string().min(1),
      hint: z.string().optional(),
      explanation: z.string().optional(),
      tags: z.array(z.string()).optional().default([]),
      ai_generated: z.boolean().optional().default(false),
      ai_generation_prompt: z.string().optional(),
      ai_model_used: z.string().optional(),
    })
  ),
});

function formatCard(card: {
  id: string;
  front: string;
  back: string;
  hint: string | null;
  explanation: string | null;
  deckId: string;
  tags: unknown;
  isActive: boolean;
  status: string;
  easeFactor: number;
  intervalDays: number;
  repetitions: number;
  nextReviewDate: Date;
  lastReviewedAt: Date | null;
  totalReviews: number;
  correctReviews: number;
  aiGenerated: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
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
  };
}

async function assertDeckOwnership(
  deckId: string,
  userId: string,
  next: NextFunction
): Promise<boolean> {
  const deck = await prisma.deck.findUnique({ where: { id: deckId }, select: { userId: true } });
  if (!deck || deck.userId !== userId) {
    next(createError('Deck not found', 404, 'not_found'));
    return false;
  }
  return true;
}

// POST /api/flashcards/
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = flashcardCreateSchema.parse(req.body);

    if (!(await assertDeckOwnership(data.deck_id, req.user.id, next))) return;

    const card = await prisma.flashcard.create({
      data: {
        id: uuidv4(),
        front: data.front,
        back: data.back,
        hint: data.hint ?? null,
        explanation: data.explanation ?? null,
        deckId: data.deck_id,
        tags: data.tags,
        isActive: true,
        nextReviewDate: new Date(),
        aiGenerated: data.ai_generated,
        aiGenerationPrompt: data.ai_generation_prompt ?? null,
        aiModelUsed: data.ai_model_used ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    await prisma.deck.update({
      where: { id: data.deck_id },
      data: { totalCards: { increment: 1 }, cardsNewCount: { increment: 1 }, updatedAt: new Date() },
    });

    res.status(201).json({ flashcard: formatCard(card) });
  } catch (err) {
    next(err);
  }
});

// POST /api/flashcards/batch
router.post('/batch', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = batchFlashcardSchema.parse(req.body);

    if (!(await assertDeckOwnership(data.deck_id, req.user.id, next))) return;

    if (data.flashcards.length === 0) {
      return res.status(201).json({ flashcards: [], created: 0 });
    }

    const now = new Date();
    const cards = await prisma.$transaction(
      data.flashcards.map((fc) =>
        prisma.flashcard.create({
          data: {
            id: uuidv4(),
            front: fc.front,
            back: fc.back,
            hint: fc.hint ?? null,
            explanation: fc.explanation ?? null,
            deckId: data.deck_id,
            tags: fc.tags,
            isActive: true,
            nextReviewDate: now,
            aiGenerated: fc.ai_generated,
            aiGenerationPrompt: fc.ai_generation_prompt ?? null,
            aiModelUsed: fc.ai_model_used ?? null,
            createdAt: now,
            updatedAt: now,
          },
        })
      )
    );

    await prisma.deck.update({
      where: { id: data.deck_id },
      data: {
        totalCards: { increment: cards.length },
        cardsNewCount: { increment: cards.length },
        updatedAt: now,
      },
    });

    res.status(201).json({
      flashcards: cards.map(formatCard),
      created: cards.length,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/flashcards/deck/:deckId
router.get('/deck/:deckId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const deckId = req.params['deckId'] as string;
    if (!(await assertDeckOwnership(deckId, req.user.id, next))) return;

    const cards = await prisma.flashcard.findMany({
      where: { deckId, isActive: true },
      orderBy: { createdAt: 'asc' },
    });

    res.json({ flashcards: cards.map(formatCard) });
  } catch (err) {
    next(err);
  }
});

// GET /api/flashcards/:flashcardId
router.get('/:flashcardId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const flashcardId = req.params['flashcardId'] as string;
    const cardWithDeck = await prisma.flashcard.findUnique({
      where: { id: flashcardId },
      include: { deck: { select: { userId: true } } },
    });

    if (!cardWithDeck || cardWithDeck.deck.userId !== req.user.id) {
      return next(createError('Flashcard not found', 404, 'not_found'));
    }

    res.json({ flashcard: formatCard(cardWithDeck) });
  } catch (err) {
    next(err);
  }
});

// PUT /api/flashcards/:flashcardId
router.put('/:flashcardId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const flashcardId = req.params['flashcardId'] as string;
    const existing = await prisma.flashcard.findUnique({
      where: { id: flashcardId },
      include: { deck: { select: { userId: true } } },
    });

    if (!existing || existing.deck.userId !== req.user.id) {
      return next(createError('Flashcard not found', 404, 'not_found'));
    }

    const schema = z.object({
      front: z.string().min(1).optional(),
      back: z.string().min(1).optional(),
      hint: z.string().optional().nullable(),
      explanation: z.string().optional().nullable(),
      tags: z.array(z.string()).optional(),
    });

    const data = schema.parse(req.body);

    const card = await prisma.flashcard.update({
      where: { id: flashcardId },
      data: {
        ...(data.front && { front: data.front }),
        ...(data.back && { back: data.back }),
        ...(data.hint !== undefined && { hint: data.hint }),
        ...(data.explanation !== undefined && { explanation: data.explanation }),
        ...(data.tags && { tags: data.tags }),
        updatedAt: new Date(),
      },
    });

    res.json({ flashcard: formatCard(card) });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/flashcards/:flashcardId
router.delete('/:flashcardId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const flashcardId = req.params['flashcardId'] as string;
    const existing = await prisma.flashcard.findUnique({
      where: { id: flashcardId },
      include: { deck: { select: { userId: true, id: true } } },
    });

    if (!existing || existing.deck.userId !== req.user.id) {
      return next(createError('Flashcard not found', 404, 'not_found'));
    }

    await prisma.flashcard.update({
      where: { id: flashcardId },
      data: { isActive: false, updatedAt: new Date() },
    });

    await prisma.deck.update({
      where: { id: existing.deck.id },
      data: { totalCards: { decrement: 1 }, updatedAt: new Date() },
    });

    res.json({ message: 'Flashcard deleted' });
  } catch (err) {
    next(err);
  }
});

export { router as flashcardsRouter };
