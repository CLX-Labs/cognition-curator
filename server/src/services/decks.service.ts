import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../db/prisma';
import { NotFoundError } from '../utils/errors';
import { CreateDeckInput, UpdateDeckInput } from '../schemas/decks.schema';

export const DecksService = {
  findAll: (userId: string) =>
    prisma.deck.findMany({
      where: { userId, isActive: true },
      orderBy: { updatedAt: 'desc' },
    }),

  findById: async (deckId: string, userId: string) => {
    const deck = await prisma.deck.findUnique({ where: { id: deckId } });
    if (!deck || deck.userId !== userId) throw new NotFoundError('Deck not found');
    return deck;
  },

  create: async (userId: string, data: CreateDeckInput) => {
    const deck = await prisma.deck.create({
      data: {
        id: uuidv4(),
        name: data.name,
        description: data.description ?? null,
        category: data.category ?? null,
        userId,
        isPublic: data.is_public,
        isActive: true,
        color: data.color,
        icon: data.icon ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    await prisma.user.update({
      where: { id: userId },
      data: { totalDecksCreated: { increment: 1 } },
    });

    return deck;
  },

  update: async (deckId: string, userId: string, data: UpdateDeckInput) => {
    const existing = await prisma.deck.findUnique({ where: { id: deckId } });
    if (!existing || existing.userId !== userId) throw new NotFoundError('Deck not found');

    return prisma.deck.update({
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
  },

  remove: async (deckId: string, userId: string) => {
    const existing = await prisma.deck.findUnique({ where: { id: deckId } });
    if (!existing || existing.userId !== userId) throw new NotFoundError('Deck not found');

    await prisma.deck.update({
      where: { id: deckId },
      data: { isActive: false, updatedAt: new Date() },
    });
  },
};
