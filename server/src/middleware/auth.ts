import { Request, Response, NextFunction } from 'express';
import { stytchClient } from '../lib/stytch';
import { prisma } from '../db/prisma';
import { UnauthorizedError } from '../utils/errors';

export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return next(new UnauthorizedError('Authorization token required'));
    }

    const sessionJwt = authHeader.slice(7);
    let stytchUserId: string;

    // In test mode the token is treated directly as the stytch user_id,
    // avoiding any real Stytch SDK call in Jest tests.
    if (process.env.NODE_ENV === 'test') {
      stytchUserId = sessionJwt;
    } else {
      try {
        const result = await stytchClient.sessions.authenticateJwt({
          session_jwt: sessionJwt,
        });
        stytchUserId = result.session.user_id;
      } catch {
        return next(new UnauthorizedError('Invalid or expired session'));
      }
    }

    const user = await prisma.user.findUnique({ where: { stytchUserId } });

    if (!user || !user.isActive) {
      return next(new UnauthorizedError('User not found'));
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}
