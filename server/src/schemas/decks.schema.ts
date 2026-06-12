import { z } from 'zod';

export const createDeckSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  category: z.string().optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().default('#007AFF'),
  icon: z.string().optional(),
  is_public: z.boolean().optional().default(false),
});

export const updateDeckSchema = createDeckSchema.partial();

export type CreateDeckInput = z.infer<typeof createDeckSchema>;
export type UpdateDeckInput = z.infer<typeof updateDeckSchema>;
