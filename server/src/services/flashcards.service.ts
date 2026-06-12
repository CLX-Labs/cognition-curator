import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../db/prisma';
import { NotFoundError } from '../utils/errors';
import {
  CreateFlashcardInput,
  BatchFlashcardInput,
  UpdateFlashcardInput,
} from '../schemas/flashcards.schema';

async function assertDeckOwnership(deckId: string, userId: string): Promise<void> {
  const deck = await prisma.deck.findUnique({ where: { id: deckId }, select: { userId: true } });
  if (!deck || deck.userId !== userId) throw new NotFoundError('Deck not found');
}

export const FlashcardsService = {
  findByDeck: async (deckId: string, userId: string) => {
    await assertDeckOwnership(deckId, userId);
    return prisma.flashcard.findMany({
      where: { deckId, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
  },

  findById: async (flashcardId: string, userId: string) => {
    const card = await prisma.flashcard.findUnique({
      where: { id: flashcardId },
      include: { deck: { select: { userId: true } } },
    });
    if (!card || card.deck.userId !== userId) throw new NotFoundError('Flashcard not found');
    return card;
  },

  create: async (userId: string, data: CreateFlashcardInput) => {
    await assertDeckOwnership(data.deck_id, userId);

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

    return card;
  },

  createBatch: async (userId: string, data: BatchFlashcardInput) => {
    await assertDeckOwnership(data.deck_id, userId);

    if (data.flashcards.length === 0) return [];

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

    return cards;
  },

  update: async (flashcardId: string, userId: string, data: UpdateFlashcardInput) => {
    const existing = await prisma.flashcard.findUnique({
      where: { id: flashcardId },
      include: { deck: { select: { userId: true } } },
    });
    if (!existing || existing.deck.userId !== userId) throw new NotFoundError('Flashcard not found');

    return prisma.flashcard.update({
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
  },

  remove: async (flashcardId: string, userId: string) => {
    const existing = await prisma.flashcard.findUnique({
      where: { id: flashcardId },
      include: { deck: { select: { userId: true, id: true } } },
    });
    if (!existing || existing.deck.userId !== userId) throw new NotFoundError('Flashcard not found');

    await prisma.flashcard.update({
      where: { id: flashcardId },
      data: { isActive: false, updatedAt: new Date() },
    });

    await prisma.deck.update({
      where: { id: existing.deck.id },
      data: { totalCards: { decrement: 1 }, updatedAt: new Date() },
    });
  },
};
