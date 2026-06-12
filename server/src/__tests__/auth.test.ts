/**
 * Contract tests: auth route shapes and validation.
 */
import request from 'supertest';
import app from '../app';
import { mockUser } from './factories/user.factory';

// Auth middleware uses test shortcut (token = stytch_user_id) — no Stytch mock needed.
// Still mock Stytch for the /callback endpoint which calls AuthService.exchangeToken.
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
      revoke: jest.fn().mockResolvedValue({}),
    },
  },
}));

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
    prisma.user.create.mockResolvedValueOnce(mockUser());

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
    expect(res.body).toHaveProperty('code', 'unauthorized');
  });

  it('returns 401 when user is not found after JWT validation', async () => {
    const { prisma } = require('../db/prisma');
    prisma.user.findUnique.mockResolvedValueOnce(null);

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer stytch-user-123');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('code', 'unauthorized');
  });

  it('returns 200 with valid session and existing user', async () => {
    const { prisma } = require('../db/prisma');
    prisma.user.findUnique.mockResolvedValueOnce(mockUser());

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer stytch-user-123');
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: 'user@example.com' });
  });
});
