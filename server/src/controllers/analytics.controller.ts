import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AnalyticsService } from '../services/analytics.service';

export const dashboard = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { days: daysStr } = z.object({ days: z.string().optional() }).parse(req.query);
    const days = Math.min(Number(daysStr ?? '30'), 365);

    const { user, recentSessions, deckStats, dailyStats } =
      await AnalyticsService.getDashboard(req.user.id, days);

    const userStats = {
      total_study_time_minutes: user.totalStudyTimeMinutes,
      current_streak_days: user.currentStreakDays,
      longest_streak_days: user.longestStreakDays,
      total_cards_reviewed: user.totalCardsReviewed,
      total_decks_created: user.totalDecksCreated,
      overall_accuracy_rate: Math.round(user.overallAccuracyRate * 1000) / 1000,
      mastery_rate: Math.round(user.masteryRate * 1000) / 1000,
    };

    const totalDue = deckStats.reduce((sum, d) => sum + d.cardsDueCount, 0);
    const totalCards = deckStats.reduce((sum, d) => sum + d.totalCards, 0);

    res.json({
      user_stats: userStats,
      recent_sessions: recentSessions.map((s) => ({
        id: s.id,
        deck_id: s.deckId,
        session_type: s.sessionType,
        started_at: s.startedAt.toISOString(),
        ended_at: s.endedAt?.toISOString() ?? null,
        duration_minutes: s.durationMinutes,
        cards_reviewed: s.cardsReviewed,
        accuracy_rate: s.accuracyRate,
        cards_mastered: s.cardsMastered,
        session_quality_score: s.sessionQualityScore,
        goal_achieved: s.goalAchieved,
      })),
      deck_summary: {
        total_decks: deckStats.length,
        total_cards: totalCards,
        total_due: totalDue,
        decks: deckStats.map((d) => ({
          id: d.id,
          name: d.name,
          total_cards: d.totalCards,
          cards_due: d.cardsDueCount,
          cards_mastered: d.cardsMasteredCount,
          average_accuracy: d.averageAccuracy,
          last_studied_at: d.lastStudiedAt?.toISOString() ?? null,
        })),
      },
      daily_stats: dailyStats.map((row) => ({
        date: row.date,
        total_minutes: row.minutes ?? 0,
        total_cards: row.cards ?? 0,
        avg_accuracy: Math.round((row.accuracy ?? 0) * 1000) / 1000,
      })),
      days_range: days,
    });
  } catch (err) {
    next(err);
  }
};
