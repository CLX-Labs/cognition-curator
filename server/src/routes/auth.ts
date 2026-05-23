import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { stytchClient } from '../lib/stytch';
import { prisma } from '../db/prisma';
import { requireAuth } from '../middleware/stytchAuth';
import { createError } from '../middleware/errorHandler';
import { env } from '../config/env';

const router = Router();

// ---------------------------------------------------------------------------
// POST /api/auth/magic-link/send
// ---------------------------------------------------------------------------
router.post('/magic-link/send', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);

    await stytchClient.magicLinks.email.loginOrCreate({ email });

    res.json({ message: 'Magic link sent. Check your email.' });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/oauth/apple/start
// Returns the Stytch-hosted Apple OAuth start URL.
// The iOS app handles the native Apple Sign-In flow separately.
// ---------------------------------------------------------------------------
router.post('/oauth/apple/start', (_req: Request, res: Response) => {
  // Stytch v13 does not provide a server-side SDK method to generate the
  // Apple OAuth start URL. The URL pattern is:
  // https://api.stytch.com/v1/public/{project_id}/oauth/apple/start?redirect_url=...
  const baseApiUrl =
    env.STYTCH_ENV === 'live'
      ? 'https://api.stytch.com'
      : 'https://test.stytch.com';

  const redirectUrl = encodeURIComponent(
    env.NODE_ENV === 'production'
      ? 'https://cognition-curator-production.up.railway.app/api/auth/callback'
      : 'http://localhost:8080/api/auth/callback'
  );

  const url = `${baseApiUrl}/v1/public/${env.STYTCH_PROJECT_ID}/oauth/apple/start?redirect_url=${redirectUrl}`;

  res.json({ url });
});

// ---------------------------------------------------------------------------
// POST /api/auth/callback
// Exchange a Stytch token (magic link or OAuth) for a session JWT.
// ---------------------------------------------------------------------------
const callbackSchema = z.object({
  token: z.string().min(1),
  token_type: z.enum(['magic_links', 'oauth']).optional(),
});

router.post('/callback', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token, token_type } = callbackSchema.parse(req.body);

    let stytchUserId: string;
    let sessionJwt: string;
    let email: string | null = null;
    let name: string | null = null;

    if (token_type === 'oauth') {
      const result = await stytchClient.oauth.authenticate({
        token,
        session_duration_minutes: 60 * 24 * 30, // 30 days
      });
      stytchUserId = result.user_id;
      sessionJwt = result.session_jwt;
      email = result.user.emails?.[0]?.email ?? null;
      name = result.user.name
        ? `${result.user.name.first_name ?? ''} ${result.user.name.last_name ?? ''}`.trim()
        : null;
    } else {
      // Magic link (default)
      const result = await stytchClient.magicLinks.authenticate({
        token,
        session_duration_minutes: 60 * 24 * 30,
      });
      stytchUserId = result.user_id;
      sessionJwt = result.session_jwt;
      email = result.user.emails?.[0]?.email ?? null;
      name = result.user.name
        ? `${result.user.name.first_name ?? ''} ${result.user.name.last_name ?? ''}`.trim()
        : null;
    }

    // Find or create local user record
    let user = await prisma.user.findUnique({ where: { stytchUserId } });
    let isNewUser = false;

    if (!user && email) {
      // Check if an existing Flask user has this email (migration scenario)
      user = await prisma.user.findUnique({ where: { email } });
      if (user) {
        // Link existing user to Stytch
        user = await prisma.user.update({
          where: { id: user.id },
          data: { stytchUserId },
        });
      }
    }

    if (!user) {
      // Brand-new user
      isNewUser = true;
      user = await prisma.user.create({
        data: {
          id: uuidv4(),
          stytchUserId,
          email: email ?? `${stytchUserId}@stytch.user`,
          name: name || (email ? email.split('@')[0] : 'User'),
          isActive: true,
          isPremium: false,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          studyPreferences: {},
          timezone: 'UTC',
          languagePreference: 'en',
        },
      });
    }

    res.json({
      session_jwt: sessionJwt,
      user: formatUser(user),
      is_new_user: isNewUser,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/auth/me
// ---------------------------------------------------------------------------
router.get('/me', requireAuth, (req: Request, res: Response) => {
  res.json({ user: formatUser(req.user) });
});

// ---------------------------------------------------------------------------
// PUT /api/auth/profile
// ---------------------------------------------------------------------------
router.put('/profile', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      name: z.string().min(1).optional(),
      displayName: z.string().optional(),
      timezone: z.string().optional(),
    });

    const data = schema.parse(req.body);

    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.displayName !== undefined && { displayName: data.displayName }),
        ...(data.timezone && { timezone: data.timezone }),
      },
    });

    res.json({ user: formatUser(updated) });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/logout
// ---------------------------------------------------------------------------
router.post('/logout', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization!;
    const sessionJwt = authHeader.slice(7);

    // Revoke all sessions for this Stytch user
    await stytchClient.sessions.revoke({ session_jwt: sessionJwt }).catch(() => {
      // Best-effort; token may already be expired
    });

    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
});

function formatUser(user: {
  id: string;
  email: string;
  name: string;
  displayName: string | null;
  profilePictureUrl: string | null;
  isActive: boolean;
  isPremium: boolean;
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
  timezone: string;
  totalStudyTimeMinutes: number;
  currentStreakDays: number;
  longestStreakDays: number;
  totalCardsReviewed: number;
  totalDecksCreated: number;
  overallAccuracyRate: number;
  masteryRate: number;
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    display_name: user.displayName,
    profile_picture_url: user.profilePictureUrl,
    is_active: user.isActive,
    is_premium: user.isPremium,
    is_apple_user: false,
    email_verified: user.emailVerified,
    created_at: user.createdAt.toISOString(),
    updated_at: user.updatedAt.toISOString(),
    last_login_at: user.lastLoginAt?.toISOString() ?? null,
    timezone: user.timezone,
    total_study_time_minutes: user.totalStudyTimeMinutes,
    current_streak_days: user.currentStreakDays,
    longest_streak_days: user.longestStreakDays,
    total_cards_reviewed: user.totalCardsReviewed,
    total_decks_created: user.totalDecksCreated,
    overall_accuracy_rate: user.overallAccuracyRate,
    mastery_rate: user.masteryRate,
  };
}

export { router as authRouter, formatUser };
