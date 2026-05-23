/**
 * Contract tests: sync routes.
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
      findUnique: jest.fn(),
    },
    flashcard: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    reviewSession: {
      create: jest.fn(),
    },
    studySession: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

function authHeader() {
  return { Authorization: 'Bearer mock-jwt' };
}

function withAuthUser() {
  const { prisma } = require('../db/prisma');
  prisma.user.findUnique.mockResolvedValueOnce(MOCK_USER);
}

describe('POST /api/sync/flashcard-review', () => {
  it('returns 400 when required fields are missing', async () => {
    withAuthUser();
    const res = await request(app)
      .post('/api/sync/flashcard-review')
      .set(authHeader())
      .send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'validation_error');
  });

  it('returns 404 when flashcard not found', async () => {
    withAuthUser();
    const { prisma } = require('../db/prisma');
    prisma.flashcard.findUnique.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/api/sync/flashcard-review')
      .set(authHeader())
      .send({
        flashcard_id: '00000000-0000-0000-0000-000000000001',
        deck_id: '00000000-0000-0000-0000-000000000002',
        difficulty_rating: 2,
        was_correct: true,
        response_time_seconds: 3.5,
      });
    expect(res.status).toBe(404);
  });

  it('creates review session and returns next_review_date', async () => {
    withAuthUser();
    const { prisma } = require('../db/prisma');
    prisma.flashcard.findUnique.mockResolvedValueOnce({
      id: '00000000-0000-0000-0000-000000000001',
      easeFactor: 2.5,
      intervalDays: 1,
      repetitions: 1,
      deck: { userId: 'user-uuid-1' },
    });
    const reviewId = 'review-session-id';
    prisma.$transaction.mockResolvedValueOnce([
      { id: reviewId },
      { nextReviewDate: new Date() },
    ]);

    const res = await request(app)
      .post('/api/sync/flashcard-review')
      .set(authHeader())
      .send({
        flashcard_id: '00000000-0000-0000-0000-000000000001',
        deck_id: '00000000-0000-0000-0000-000000000002',
        difficulty_rating: 2,
        was_correct: true,
        response_time_seconds: 3.5,
        ease_factor_before: 2.5,
        ease_factor_after: 2.6,
        interval_before_days: 1,
        interval_after_days: 3,
        repetitions_before: 1,
        repetitions_after: 2,
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('review_session_id');
    expect(res.body).toHaveProperty('next_review_date');
  });
});

describe('POST /api/sync/study-session', () => {
  it('returns 400 when required fields are missing', async () => {
    withAuthUser();
    const res = await request(app)
      .post('/api/sync/study-session')
      .set(authHeader())
      .send({});
    expect(res.status).toBe(400);
  });

  it('creates study session and returns id', async () => {
    withAuthUser();
    const { prisma } = require('../db/prisma');
    prisma.studySession.create.mockResolvedValueOnce({ id: 'session-id' });
    prisma.user.update.mockResolvedValueOnce(MOCK_USER);

    const res = await request(app)
      .post('/api/sync/study-session')
      .set(authHeader())
      .send({
        session_type: 'standard',
        started_at: new Date().toISOString(),
        duration_minutes: 10,
        cards_reviewed: 5,
        cards_correct: 4,
        cards_incorrect: 1,
        accuracy_rate: 0.8,
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('study_session_id');
  });
});

describe('POST /api/sync/user-stats', () => {
  it('returns 200 with valid stats', async () => {
    withAuthUser();
    const { prisma } = require('../db/prisma');
    prisma.user.update.mockResolvedValueOnce(MOCK_USER);

    const res = await request(app)
      .post('/api/sync/user-stats')
      .set(authHeader())
      .send({
        current_streak_days: 7,
        overall_accuracy_rate: 0.82,
      });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('message');
  });
});
