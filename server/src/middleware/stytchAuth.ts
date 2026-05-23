import { Request, Response, NextFunction } from 'express';
import { stytchClient } from '../lib/stytch';
import { prisma } from '../db/prisma';
import { createError } from './errorHandler';

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return next(createError('Authorization token required', 401, 'authorization_required'));
    }

    const sessionJwt = authHeader.slice(7);

    let stytchUserId: string;
    try {
      const result = await stytchClient.sessions.authenticateJwt({
        session_jwt: sessionJwt,
      });
      stytchUserId = result.session.user_id;
    } catch {
      return next(createError('Invalid or expired session', 401, 'session_expired'));
    }

    const user = await prisma.user.findUnique({
      where: { stytchUserId },
    });

    if (!user || !user.isActive) {
      return next(createError('User not found', 401, 'user_not_found'));
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}
