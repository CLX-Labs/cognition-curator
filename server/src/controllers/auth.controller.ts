import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service';
import { serializeUser } from '../serializers/user.serializer';

export const sendMagicLink = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await AuthService.sendMagicLink(req.body.email as string);
    res.json({ message: 'Magic link sent. Check your email.' });
  } catch (err) {
    next(err);
  }
};

export const getAppleOAuthStartUrl = (_req: Request, res: Response) => {
  res.json({ url: AuthService.getAppleOAuthStartUrl() });
};

export const callback = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token, token_type } = req.body as { token: string; token_type?: 'magic_links' | 'oauth' };
    const { sessionJwt, user, isNewUser } = await AuthService.exchangeToken(token, token_type);
    res.json({ session_jwt: sessionJwt, user: serializeUser(user), is_new_user: isNewUser });
  } catch (err) {
    next(err);
  }
};

export const me = (req: Request, res: Response) => {
  res.json({ user: serializeUser(req.user) });
};

export const updateProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const updated = await AuthService.updateProfile(req.user.id, req.body);
    res.json({ user: serializeUser(updated) });
  } catch (err) {
    next(err);
  }
};

export const logout = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionJwt = req.headers.authorization!.slice(7);
    await AuthService.revokeSession(sessionJwt);
    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
};
