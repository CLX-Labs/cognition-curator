import { Request, Response, NextFunction } from 'express';
import { AiService } from '../services/ai.service';

export const generateFlashcards = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!AiService.isAvailable()) {
      res.status(503).json({ error: 'AI generation not configured', code: 'ai_unavailable' });
      return;
    }
    const result = await AiService.generateFlashcards(req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

export const generateAnswer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!AiService.isAvailable()) {
      res.status(503).json({ error: 'AI generation not configured', code: 'ai_unavailable' });
      return;
    }
    const result = await AiService.generateAnswer(req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
};
