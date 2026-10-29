import { z } from 'zod';

/** Shared wire fields; kept separate so settings helpers do not depend on the barrel. */
export const uuidSchema = z.uuid().toLowerCase();
export const dateTimeSchema = z.iso.datetime({ offset: true });
export const revisionSchema = z.string().regex(/^(0|[1-9][0-9]*)$/);
export const recordFields = {
  ownerId: uuidSchema,
  version: z.number().int().positive(),
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
  deletedAt: dateTimeSchema.nullable(),
};
