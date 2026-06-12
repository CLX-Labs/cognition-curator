import { z } from 'zod';

export const createFlashcardSchema = z.object({
  front: z.string().min(1),
  back: z.string().min(1),
  hint: z.string().optional(),
  explanation: z.string().optional(),
  deck_id: z.string().uuid(),
  tags: z.array(z.string()).optional().default([]),
  ai_generated: z.boolean().optional().default(false),
  ai_generation_prompt: z.string().optional(),
  ai_model_used: z.string().optional(),
});

export const batchFlashcardSchema = z.object({
  deck_id: z.string().uuid(),
  flashcards: z.array(
    z.object({
      front: z.string().min(1),
      back: z.string().min(1),
      hint: z.string().optional(),
      explanation: z.string().optional(),
      tags: z.array(z.string()).optional().default([]),
      ai_generated: z.boolean().optional().default(false),
      ai_generation_prompt: z.string().optional(),
      ai_model_used: z.string().optional(),
    })
  ),
});

export const updateFlashcardSchema = z.object({
  front: z.string().min(1).optional(),
  back: z.string().min(1).optional(),
  hint: z.string().optional().nullable(),
  explanation: z.string().optional().nullable(),
  tags: z.array(z.string()).optional(),
});

export type CreateFlashcardInput = z.infer<typeof createFlashcardSchema>;
export type BatchFlashcardInput = z.infer<typeof batchFlashcardSchema>;
export type UpdateFlashcardInput = z.infer<typeof updateFlashcardSchema>;
