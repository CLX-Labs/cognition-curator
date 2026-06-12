import { User } from '@prisma/client';

export const serializeUser = (user: User) => ({
  id: user.id,
  email: user.email,
  name: user.name,
  display_name: user.displayName,
  profile_picture_url: user.profilePictureUrl,
  is_active: user.isActive,
  is_premium: user.isPremium,
  is_apple_user: false,
  email_verified: user.emailVerified,
  created_at: user.createdAt.toISOString(),
  updated_at: user.updatedAt.toISOString(),
  last_login_at: user.lastLoginAt?.toISOString() ?? null,
  timezone: user.timezone,
  total_study_time_minutes: user.totalStudyTimeMinutes,
  current_streak_days: user.currentStreakDays,
  longest_streak_days: user.longestStreakDays,
  total_cards_reviewed: user.totalCardsReviewed,
  total_decks_created: user.totalDecksCreated,
  overall_accuracy_rate: user.overallAccuracyRate,
  mastery_rate: user.masteryRate,
});
