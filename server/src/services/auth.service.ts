import { v4 as uuidv4 } from 'uuid';
import { stytchClient } from '../lib/stytch';
import { prisma } from '../db/prisma';
import { env } from '../config/env';
import { UpdateProfileInput } from '../schemas/auth.schema';
import { NotFoundError } from '../utils/errors';

export const AuthService = {
  sendMagicLink: async (email: string): Promise<void> => {
    await stytchClient.magicLinks.email.loginOrCreate({ email });
  },

  getAppleOAuthStartUrl: (): string => {
    const baseApiUrl =
      env.STYTCH_ENV === 'live' ? 'https://api.stytch.com' : 'https://test.stytch.com';

    const redirectUrl = encodeURIComponent(
      env.NODE_ENV === 'production'
        ? 'https://cognition-curator-production.up.railway.app/api/auth/callback'
        : 'http://localhost:8080/api/auth/callback'
    );

    return `${baseApiUrl}/v1/public/${env.STYTCH_PROJECT_ID}/oauth/apple/start?redirect_url=${redirectUrl}`;
  },

  exchangeToken: async (
    token: string,
    tokenType?: 'magic_links' | 'oauth'
  ) => {
    let stytchUserId: string;
    let sessionJwt: string;
    let email: string | null = null;
    let name: string | null = null;

    if (tokenType === 'oauth') {
      const result = await stytchClient.oauth.authenticate({
        token,
        session_duration_minutes: 60 * 24 * 30,
      });
      stytchUserId = result.user_id;
      sessionJwt = result.session_jwt;
      email = result.user.emails?.[0]?.email ?? null;
      name = result.user.name
        ? `${result.user.name.first_name ?? ''} ${result.user.name.last_name ?? ''}`.trim()
        : null;
    } else {
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

    let user = await prisma.user.findUnique({ where: { stytchUserId } });
    let isNewUser = false;

    if (!user && email) {
      user = await prisma.user.findUnique({ where: { email } });
      if (user) {
        user = await prisma.user.update({ where: { id: user.id }, data: { stytchUserId } });
      }
    }

    if (!user) {
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

    return { sessionJwt, user, isNewUser };
  },

  updateProfile: async (userId: string, data: UpdateProfileInput) => {
    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.displayName !== undefined && { displayName: data.displayName }),
        ...(data.timezone && { timezone: data.timezone }),
      },
    });
    return user;
  },

  revokeSession: async (sessionJwt: string): Promise<void> => {
    await stytchClient.sessions.revoke({ session_jwt: sessionJwt }).catch(() => {
      // Best-effort; token may already be expired
    });
  },
};

export type { UpdateProfileInput };
