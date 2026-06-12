import { z } from 'zod';

export const flashcardReviewSchema = z.object({
  flashcard_id: z.string().uuid(),
  deck_id: z.string().uuid(),
  difficulty_rating: z.number().int().min(0).max(3),
  was_correct: z.boolean(),
  response_time_seconds: z.number().min(0),
  session_type: z.string().default('standard'),
  review_context: z.string().optional(),
  ease_factor_before: z.number().optional(),
  ease_factor_after: z.number().optional(),
  interval_before_days: z.number().int().optional(),
  interval_after_days: z.number().int().optional(),
  repetitions_before: z.number().int().optional(),
  repetitions_after: z.number().int().optional(),
  confidence_level: z.number().optional(),
  hint_used: z.boolean().optional().default(false),
  multiple_attempts: z.boolean().optional().default(false),
  device_type: z.string().optional(),
  app_version: z.string().optional(),
  platform: z.string().optional(),
});

export const studySessionSchema = z.object({
  deck_id: z.string().uuid().optional(),
  session_type: z.string().default('standard'),
  session_name: z.string().optional(),
  started_at: z.string().datetime(),
  ended_at: z.string().datetime().optional(),
  duration_minutes: z.number().int().min(0),
  cards_reviewed: z.number().int().min(0),
  cards_correct: z.number().int().min(0),
  cards_incorrect: z.number().int().min(0),
  accuracy_rate: z.number().min(0).max(1),
  cards_new_studied: z.number().int().min(0).default(0),
  cards_graduated: z.number().int().min(0).default(0),
  cards_mastered: z.number().int().min(0).default(0),
  cards_reset: z.number().int().min(0).default(0),
  average_response_time_seconds: z.number().min(0).default(0),
  total_think_time_seconds: z.number().int().min(0).default(0),
  session_quality_score: z.number().min(0).max(1).default(0.5),
  focus_score: z.number().min(0).max(1).default(0.5),
  difficulty_distribution: z.record(z.number()).default({}),
  platform: z.string().optional(),
  device_type: z.string().optional(),
  app_version: z.string().optional(),
  goal_achieved: z.boolean().default(false),
  notes: z.string().optional(),
});

export const userStatsSchema = z.object({
  current_streak_days: z.number().int().optional(),
  longest_streak_days: z.number().int().optional(),
  overall_accuracy_rate: z.number().min(0).max(1).optional(),
  mastery_rate: z.number().min(0).max(1).optional(),
});

export type FlashcardReviewInput = z.infer<typeof flashcardReviewSchema>;
export type StudySessionInput = z.infer<typeof studySessionSchema>;
export type UserStatsInput = z.infer<typeof userStatsSchema>;
