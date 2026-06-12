/**
 * Contract tests: decks CRUD routes.
 */
import request from 'supertest';
import app from '../app';
import { mockUser } from './factories/user.factory';
import { mockDeck } from './factories/deck.factory';

// Auth middleware uses test shortcut — no Stytch mock needed.
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
  return { Authorization: 'Bearer stytch-user-123' };
}

function withAuthUser() {
  const { prisma } = require('../db/prisma');
  prisma.user.findUnique.mockResolvedValueOnce(mockUser());
}

describe('GET /api/decks/', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/decks/');
    expect(res.status).toBe(401);
  });

  it('returns deck list with correct shape', async () => {
    withAuthUser();
    const { prisma } = require('../db/prisma');
    prisma.deck.findMany.mockResolvedValueOnce([mockDeck()]);

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
    prisma.deck.create.mockResolvedValueOnce(mockDeck());
    prisma.user.update.mockResolvedValueOnce(mockUser());

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
    prisma.deck.findUnique.mockResolvedValueOnce(mockDeck({ userId: 'other-user-id' }));

    const res = await request(app)
      .get('/api/decks/deck-uuid-1')
      .set(authHeader());
    expect(res.status).toBe(404);
  });

  it('returns deck when owned by authenticated user', async () => {
    withAuthUser();
    const { prisma } = require('../db/prisma');
    prisma.deck.findUnique.mockResolvedValueOnce(mockDeck());

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
    prisma.deck.findUnique.mockResolvedValueOnce(mockDeck());
    prisma.deck.update.mockResolvedValueOnce(mockDeck({ isActive: false }));

    const res = await request(app)
      .delete('/api/decks/deck-uuid-1')
      .set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('message');
  });
});
