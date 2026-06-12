import { Request, Response, NextFunction } from 'express';
import { SyncService } from '../services/sync.service';

export const flashcardReview = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { reviewSessionId, nextReviewDate } = await SyncService.recordFlashcardReview(
      req.user.id,
      req.body
    );
    res.status(201).json({
      review_session_id: reviewSessionId,
      next_review_date: nextReviewDate.toISOString(),
    });
  } catch (err) {
    next(err);
  }
};

export const studySession = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionId = await SyncService.recordStudySession(req.user.id, req.body);
    res.status(201).json({ study_session_id: sessionId });
  } catch (err) {
    next(err);
  }
};

export const userStats = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await SyncService.updateUserStats(req.user.id, req.body);
    res.json({ message: 'Stats updated' });
  } catch (err) {
    next(err);
  }
};
