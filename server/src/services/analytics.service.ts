import { prisma } from '../db/prisma';

export const AnalyticsService = {
  getDashboard: async (userId: string, days: number) => {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const [user, recentSessions, deckStats, dailyStats] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: userId } }),

      prisma.studySession.findMany({
        where: { userId, startedAt: { gte: startDate } },
        orderBy: { startedAt: 'desc' },
        take: 10,
        select: {
          id: true,
          deckId: true,
          sessionType: true,
          startedAt: true,
          endedAt: true,
          durationMinutes: true,
          cardsReviewed: true,
          accuracyRate: true,
          cardsMastered: true,
          sessionQualityScore: true,
          goalAchieved: true,
        },
      }),

      prisma.deck.findMany({
        where: { userId, isActive: true },
        select: {
          id: true,
          name: true,
          totalCards: true,
          cardsDueCount: true,
          cardsMasteredCount: true,
          averageAccuracy: true,
          lastStudiedAt: true,
        },
      }),

      prisma.$queryRaw<Array<{ date: string; minutes: number; cards: number; accuracy: number }>>`
        SELECT
          DATE(started_at) AS date,
          SUM(duration_minutes)::int AS minutes,
          SUM(cards_reviewed)::int AS cards,
          AVG(accuracy_rate)::float AS accuracy
        FROM study_sessions
        WHERE user_id = ${userId}::uuid
          AND started_at >= ${startDate}
        GROUP BY DATE(started_at)
        ORDER BY DATE(started_at) ASC
      `,
    ]);

    return { user, recentSessions, deckStats, dailyStats };
  },
};
