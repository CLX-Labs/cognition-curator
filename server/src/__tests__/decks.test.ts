/**
 * Contract tests: decks CRUD routes.
 */
import request from 'supertest';
import app from '../app';

const MOCK_USER = {
  id: 'user-uuid-1',
  stytchUserId: 'stytch-user-123',
  email: 'user@example.com',
  name: 'Test User',
  displayName: null,
  profilePictureUrl: null,
  isActive: true,
  isPremium: false,
  emailVerified: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastLoginAt: null,
  timezone: 'UTC',
  totalStudyTimeMinutes: 0,
  currentStreakDays: 0,
  longestStreakDays: 0,
  totalCardsReviewed: 0,
  totalDecksCreated: 0,
  overallAccuracyRate: 0,
  masteryRate: 0,
};

const MOCK_DECK = {
  id: 'deck-uuid-1',
  name: 'Test Deck',
  description: 'A test deck',
  category: null,
  userId: 'user-uuid-1',
  isPublic: false,
  isActive: true,
  color: '#007AFF',
  icon: null,
  spacedRepetitionEnabled: true,
  dailyGoalCards: 20,
  maxNewCardsPerDay: 10,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastStudiedAt: null,
  totalCards: 0,
  cardsDueCount: 0,
  cardsNewCount: 0,
  cardsLearningCount: 0,
  cardsMasteredCount: 0,
  averageAccuracy: 0,
  averageStudyTimePerCard: 0,
  totalStudyTimeMinutes: 0,
  totalReviews: 0,
  tags: [],
  customFields: {},
  aiGenerated: false,
  aiGenerationPrompt: null,
  aiModelUsed: null,
};

jest.mock('../lib/stytch', () => ({
  stytchClient: {
    sessions: {
      authenticateJwt: jest.fn().mockResolvedValue({
        session: { user_id: 'stytch-user-123' },
      }),
    },
  },
}));

jest.mock('../db/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    deck: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  },
}));

function authHeader() {
  return { Authorization: 'Bearer mock-jwt' };
}

function withAuthUser() {
  const { prisma } = require('../db/prisma');
  prisma.user.findUnique.mockResolvedValueOnce(MOCK_USER);
}

describe('GET /api/decks/', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/decks/');
    expect(res.status).toBe(401);
  });

  it('returns deck list with correct shape', async () => {
    withAuthUser();
    const { prisma } = require('../db/prisma');
    prisma.deck.findMany.mockResolvedValueOnce([MOCK_DECK]);

    const res = await request(app).get('/api/decks/').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('decks');
    expect(Array.isArray(res.body.decks)).toBe(true);
    const deck = res.body.decks[0];
    expect(deck).toHaveProperty('id');
    expect(deck).toHaveProperty('name');
    expect(deck).toHaveProperty('user_id');
    expect(deck).toHaveProperty('total_cards');
    expect(deck).toHaveProperty('cards_due_count');
  });
});

describe('POST /api/decks/', () => {
  it('returns 400 when name is missing', async () => {
    withAuthUser();
    const res = await request(app)
      .post('/api/decks/')
      .set(authHeader())
      .send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'validation_error');
  });

  it('creates a deck and returns 201 with correct shape', async () => {
    withAuthUser();
    const { prisma } = require('../db/prisma');
    prisma.deck.create.mockResolvedValueOnce(MOCK_DECK);
    prisma.user.update.mockResolvedValueOnce(MOCK_USER);

    const res = await request(app)
      .post('/api/decks/')
      .set(authHeader())
      .send({ name: 'Test Deck', description: 'A test deck' });
    expect(res.status).toBe(201);
    expect(res.body.deck).toMatchObject({
      name: 'Test Deck',
      is_active: true,
    });
  });
});

describe('GET /api/decks/:deckId', () => {
  it('returns 404 for unknown deck', async () => {
    withAuthUser();
    const { prisma } = require('../db/prisma');
    prisma.deck.findUnique.mockResolvedValueOnce(null);

    const res = await request(app)
      .get('/api/decks/nonexistent-id')
      .set(authHeader());
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('code', 'not_found');
  });

  it('returns 404 when deck belongs to another user', async () => {
    withAuthUser();
    const { prisma } = require('../db/prisma');
    prisma.deck.findUnique.mockResolvedValueOnce({
      ...MOCK_DECK,
      userId: 'other-user-id',
    });

    const res = await request(app)
      .get('/api/decks/deck-uuid-1')
      .set(authHeader());
    expect(res.status).toBe(404);
  });

  it('returns deck when owned by authenticated user', async () => {
    withAuthUser();
    const { prisma } = require('../db/prisma');
    prisma.deck.findUnique.mockResolvedValueOnce(MOCK_DECK);

    const res = await request(app)
      .get('/api/decks/deck-uuid-1')
      .set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.deck.id).toBe('deck-uuid-1');
  });
});

describe('DELETE /api/decks/:deckId', () => {
  it('soft-deletes and returns message', async () => {
    withAuthUser();
    const { prisma } = require('../db/prisma');
    prisma.deck.findUnique.mockResolvedValueOnce(MOCK_DECK);
    prisma.deck.update.mockResolvedValueOnce({ ...MOCK_DECK, isActive: false });

    const res = await request(app)
      .delete('/api/decks/deck-uuid-1')
      .set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('message');
  });
});
