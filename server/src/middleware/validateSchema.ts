import { Request, Response, NextFunction } from 'express';
import { AnyZodObject } from 'zod';

export const validateSchema =
  (schema: AnyZodObject) =>
  async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      req.body = await schema.parseAsync(req.body);
      next();
    } catch (err) {
      next(err);
    }
  };
