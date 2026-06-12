import { z } from 'zod';

export const generateFlashcardsSchema = z.object({
  topic: z.string().min(1).max(500),
  number_of_cards: z.number().int().min(1).max(20).default(5),
  difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
  additional_context: z.string().optional(),
});

export const generateAnswerSchema = z.object({
  question: z.string().min(1),
  context: z.string().optional(),
  deck_topic: z.string().optional(),
});

export type GenerateFlashcardsInput = z.infer<typeof generateFlashcardsSchema>;
export type GenerateAnswerInput = z.infer<typeof generateAnswerSchema>;
