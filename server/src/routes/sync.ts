import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { validateSchema } from '../middleware/validateSchema';
import {
  flashcardReviewSchema,
  studySessionSchema,
  userStatsSchema,
} from '../schemas/sync.schema';
import * as SyncController from '../controllers/sync.controller';

const router = Router();

router.use(requireAuth);

router.post('/flashcard-review', validateSchema(flashcardReviewSchema), SyncController.flashcardReview);
router.post('/study-session', validateSchema(studySessionSchema), SyncController.studySession);
router.post('/user-stats', validateSchema(userStatsSchema), SyncController.userStats);

export { router as syncRouter };
