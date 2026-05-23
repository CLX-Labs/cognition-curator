import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../db/prisma';
import { requireAuth } from '../middleware/stytchAuth';
import { createError } from '../middleware/errorHandler';

const router = Router();

// All deck routes require auth
router.use(requireAuth);

const deckSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  category: z.string().optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().default('#007AFF'),
  icon: z.string().optional(),
  is_public: z.boolean().optional().default(false),
});

function formatDeck(deck: {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  userId: string;
  isPublic: boolean;
  isActive: boolean;
  color: string;
  icon: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastStudiedAt: Date | null;
  totalCards: number;
  cardsDueCount: number;
  cardsNewCount: number;
  cardsLearningCount: number;
  cardsMasteredCount: number;
  averageAccuracy: number;
  totalReviews: number;
  aiGenerated: boolean;
  tags: unknown;
}) {
  return {
    id: deck.id,
    name: deck.name,
    description: deck.description,
    category: deck.category,
    user_id: deck.userId,
    is_public: deck.isPublic,
    is_active: deck.isActive,
    color: deck.color,
    icon: deck.icon,
    created_at: deck.createdAt.toISOString(),
    updated_at: deck.updatedAt.toISOString(),
    last_studied_at: deck.lastStudiedAt?.toISOString() ?? null,
    total_cards: deck.totalCards,
    cards_due_count: deck.cardsDueCount,
    cards_new_count: deck.cardsNewCount,
    cards_learning_count: deck.cardsLearningCount,
    cards_mastered_count: deck.cardsMasteredCount,
    average_accuracy: deck.averageAccuracy,
    total_reviews: deck.totalReviews,
    ai_generated: deck.aiGenerated,
    tags: deck.tags,
  };
}

// GET /api/decks/
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const decks = await prisma.deck.findMany({
      where: { userId: req.user.id, isActive: true },
      orderBy: { updatedAt: 'desc' },
    });

    res.json({ decks: decks.map(formatDeck) });
  } catch (err) {
    next(err);
  }
});

// POST /api/decks/
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = deckSchema.parse(req.body);

    const deck = await prisma.deck.create({
      data: {
        id: uuidv4(),
        name: data.name,
        description: data.description ?? null,
        category: data.category ?? null,
        userId: req.user.id,
        isPublic: data.is_public,
        isActive: true,
        color: data.color,
        icon: data.icon ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    // Increment user's deck count
    await prisma.user.update({
      where: { id: req.user.id },
      data: { totalDecksCreated: { increment: 1 } },
    });

    res.status(201).json({ deck: formatDeck(deck) });
  } catch (err) {
    next(err);
  }
});

// GET /api/decks/:deckId
router.get('/:deckId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const deck = await prisma.deck.findUnique({ where: { id: req.params['deckId'] as string } });

    if (!deck || deck.userId !== req.user.id) {
      return next(createError('Deck not found', 404, 'not_found'));
    }

    res.json({ deck: formatDeck(deck) });
  } catch (err) {
    next(err);
  }
});

// PUT /api/decks/:deckId
router.put('/:deckId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const deckId = req.params['deckId'] as string;
    const existing = await prisma.deck.findUnique({ where: { id: deckId } });

    if (!existing || existing.userId !== req.user.id) {
      return next(createError('Deck not found', 404, 'not_found'));
    }

    const data = deckSchema.partial().parse(req.body);

    const deck = await prisma.deck.update({
      where: { id: deckId },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.category !== undefined && { category: data.category }),
        ...(data.color && { color: data.color }),
        ...(data.icon !== undefined && { icon: data.icon }),
        ...(data.is_public !== undefined && { isPublic: data.is_public }),
        updatedAt: new Date(),
      },
    });

    res.json({ deck: formatDeck(deck) });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/decks/:deckId — soft delete
router.delete('/:deckId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const deckId = req.params['deckId'] as string;
    const existing = await prisma.deck.findUnique({ where: { id: deckId } });

    if (!existing || existing.userId !== req.user.id) {
      return next(createError('Deck not found', 404, 'not_found'));
    }

    await prisma.deck.update({
      where: { id: deckId },
      data: { isActive: false, updatedAt: new Date() },
    });

    res.json({ message: 'Deck deleted' });
  } catch (err) {
    next(err);
  }
});

export { router as decksRouter };
