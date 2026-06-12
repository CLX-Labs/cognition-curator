import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '../utils/logger';
import { NotFoundError, BadRequestError, UnauthorizedError, ForbiddenError } from '../utils/errors';

export interface AppError extends Error {
  status?: number;
  code?: string;
}

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Resource not found', code: 'not_found' });
}

export function errorHandler(
  err: AppError,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Validation error',
      code: 'validation_error',
      details: err.flatten().fieldErrors,
    });
    return;
  }

  // Resolve status from typed error classes or legacy AppError.status
  const status =
    err instanceof NotFoundError ? 404
    : err instanceof BadRequestError ? 400
    : err instanceof UnauthorizedError ? 401
    : err instanceof ForbiddenError ? 403
    : err.status ?? 500;

  const code =
    (err as NotFoundError | BadRequestError | UnauthorizedError | ForbiddenError).code
    ?? err.code
    ?? (status === 500 ? 'internal_error' : 'error');

  if (status >= 500) {
    logger.error('Unhandled error', {
      error: err.message,
      stack: err.stack,
    });
  }

  res.status(status).json({ error: err.message || 'An unexpected error occurred', code });
}
