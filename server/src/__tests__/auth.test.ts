/**
 * Contract tests: auth route shapes and validation.
 * Uses jest.mock to isolate from Stytch and Prisma.
 */
import request from 'supertest';
import app from '../app';

// Prevent real Stytch calls
jest.mock('../lib/stytch', () => ({
  stytchClient: {
    magicLinks: {
      email: {
        loginOrCreate: jest.fn().mockResolvedValue({}),
      },
      authenticate: jest.fn().mockResolvedValue({
        user_id: 'stytch-user-123',
        session_jwt: 'mock-jwt',
        user: {
          user_id: 'stytch-user-123',
          emails: [{ email: 'user@example.com' }],
          name: { first_name: 'Test', last_name: 'User' },
        },
      }),
    },
    sessions: {
      authenticateJwt: jest.fn().mockResolvedValue({
        session: { user_id: 'stytch-user-123' },
      }),
      revoke: jest.fn().mockResolvedValue({}),
    },
  },
}));

// Prevent real DB calls
jest.mock('../db/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    deck: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  },
}));

describe('POST /api/auth/magic-link/send', () => {
  it('returns 400 when email is missing', async () => {
    const res = await request(app)
      .post('/api/auth/magic-link/send')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'validation_error');
  });

  it('returns 400 when email is invalid', async () => {
    const res = await request(app)
      .post('/api/auth/magic-link/send')
      .send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'validation_error');
  });

  it('returns 200 with a valid email', async () => {
    const res = await request(app)
      .post('/api/auth/magic-link/send')
      .send({ email: 'user@example.com' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('message');
  });
});

describe('POST /api/auth/callback', () => {
  it('returns 400 when token is missing', async () => {
    const res = await request(app)
      .post('/api/auth/callback')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'validation_error');
  });

  it('returns 200 with valid token and creates new user', async () => {
    const { prisma } = require('../db/prisma');
    prisma.user.findUnique.mockResolvedValueOnce(null); // no stytchUserId match
    prisma.user.findUnique.mockResolvedValueOnce(null); // no email match
    prisma.user.create.mockResolvedValueOnce({
      id: 'user-uuid-1',
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
    });

    const res = await request(app)
      .post('/api/auth/callback')
      .send({ token: 'mock-magic-link-token' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('session_jwt', 'mock-jwt');
    expect(res.body).toHaveProperty('is_new_user', true);
    expect(res.body.user).toMatchObject({
      email: 'user@example.com',
      is_active: true,
    });
  });
});

describe('Auth middleware', () => {
  it('returns 401 when no Authorization header is provided', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('code', 'authorization_required');
  });

  it('returns 401 when user is not found after JWT validation', async () => {
    const { prisma } = require('../db/prisma');
    prisma.user.findUnique.mockResolvedValueOnce(null);

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer mock-jwt');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('code', 'user_not_found');
  });

  it('returns 200 with valid session and existing user', async () => {
    const { prisma } = require('../db/prisma');
    prisma.user.findUnique.mockResolvedValueOnce({
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
    });

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer mock-jwt');
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: 'user@example.com' });
  });
});
