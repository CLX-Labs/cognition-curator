import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export interface AppError extends Error {
  status?: number;
  code?: string;
}

export function notFound(req: Request, res: Response): void {
  res.status(404).json({ error: 'Resource not found', code: 'not_found' });
}

export function errorHandler(
  err: AppError,
  req: Request,
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

  const status = err.status ?? 500;
  const code = err.code ?? (status === 500 ? 'internal_error' : 'error');

  if (status === 500) {
    console.error('Unhandled error:', err);
  }

  res.status(status).json({ error: err.message || 'An unexpected error occurred', code });
}

export function createError(message: string, status: number, code: string): AppError {
  const err = new Error(message) as AppError;
  err.status = status;
  err.code = code;
  return err;
}
