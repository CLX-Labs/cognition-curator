/**
 * Contract tests: flashcards CRUD routes.
 */
import request from 'supertest';
import app from '../app';
import { mockUser } from './factories/user.factory';

const DECK_ID = '550e8400-e29b-41d4-a716-446655440001';
const CARD_ID = '550e8400-e29b-41d4-a716-446655440002';

const MOCK_CARD = {
  id: CARD_ID,
  front: 'What is the capital of France?',
  back: 'Paris',
  hint: null,
  explanation: null,
  deckId: DECK_ID,
  tags: [],
  isActive: true,
  status: 'NEW',
  easeFactor: 2.5,
  intervalDays: 0,
  repetitions: 0,
  nextReviewDate: new Date(),
  lastReviewedAt: null,
  totalReviews: 0,
  correctReviews: 0,
  aiGenerated: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// Auth middleware uses test shortcut — no Stytch mock needed.
jest.mock('../db/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    deck: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    flashcard: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

function authHeader() {
  return { Authorization: 'Bearer stytch-user-123' };
}

function withAuthUser() {
  const { prisma } = require('../db/prisma');
  prisma.user.findUnique.mockResolvedValueOnce(mockUser());
}

describe('POST /api/flashcards/', () => {
  it('returns 400 when required fields are missing', async () => {
    withAuthUser();
    const res = await request(app)
      .post('/api/flashcards/')
      .set(authHeader())
      .send({ front: 'Q only, no deck_id' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'validation_error');
  });

  it('returns 404 when deck does not exist', async () => {
    withAuthUser();
    const { prisma } = require('../db/prisma');
    prisma.deck.findUnique.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/api/flashcards/')
      .set(authHeader())
      .send({ front: 'Q', back: 'A', deck_id: DECK_ID });
    expect(res.status).toBe(404);
  });

  it('creates a flashcard with correct shape', async () => {
    withAuthUser();
    const { prisma } = require('../db/prisma');
    prisma.deck.findUnique.mockResolvedValueOnce({ userId: 'user-uuid-1' });
    prisma.flashcard.create.mockResolvedValueOnce(MOCK_CARD);
    prisma.deck.update.mockResolvedValueOnce({});

    const res = await request(app)
      .post('/api/flashcards/')
      .set(authHeader())
      .send({ front: 'What is the capital of France?', back: 'Paris', deck_id: DECK_ID });
    expect(res.status).toBe(201);
    expect(res.body.flashcard).toMatchObject({
      front: 'What is the capital of France?',
      back: 'Paris',
      deck_id: DECK_ID,
    });
    expect(res.body.flashcard).toHaveProperty('ease_factor', 2.5);
    expect(res.body.flashcard).toHaveProperty('interval_days', 0);
    expect(res.body.flashcard).toHaveProperty('status', 'NEW');
  });
});

describe('POST /api/flashcards/batch', () => {
  it('returns 201 with empty array for zero cards', async () => {
    withAuthUser();
    const { prisma } = require('../db/prisma');
    prisma.deck.findUnique.mockResolvedValueOnce({ userId: 'user-uuid-1' });

    const res = await request(app)
      .post('/api/flashcards/batch')
      .set(authHeader())
      .send({ deck_id: DECK_ID, flashcards: [] });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ flashcards: [], created: 0 });
  });

  it('creates multiple flashcards', async () => {
    withAuthUser();
    const { prisma } = require('../db/prisma');
    prisma.deck.findUnique.mockResolvedValueOnce({ userId: 'user-uuid-1' });
    prisma.$transaction.mockResolvedValueOnce([MOCK_CARD, { ...MOCK_CARD, id: 'card-uuid-2' }]);
    prisma.deck.update.mockResolvedValueOnce({});

    const res = await request(app)
      .post('/api/flashcards/batch')
      .set(authHeader())
      .send({
        deck_id: DECK_ID,
        flashcards: [
          { front: 'Q1', back: 'A1' },
          { front: 'Q2', back: 'A2' },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('created', 2);
    expect(res.body.flashcards).toHaveLength(2);
  });
});

describe('GET /api/flashcards/deck/:deckId', () => {
  it('returns flashcard list with SM-2 fields', async () => {
    withAuthUser();
    const { prisma } = require('../db/prisma');
    prisma.deck.findUnique.mockResolvedValueOnce({ userId: 'user-uuid-1' });
    prisma.flashcard.findMany.mockResolvedValueOnce([MOCK_CARD]);

    const res = await request(app)
      .get(`/api/flashcards/deck/${DECK_ID}`)
      .set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('flashcards');
    const card = res.body.flashcards[0];
    expect(card).toHaveProperty('ease_factor');
    expect(card).toHaveProperty('interval_days');
    expect(card).toHaveProperty('next_review_date');
    expect(card).toHaveProperty('status');
  });
});
