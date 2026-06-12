import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { validateSchema } from '../middleware/validateSchema';
import { generateFlashcardsSchema, generateAnswerSchema } from '../schemas/ai.schema';
import * as AiController from '../controllers/ai.controller';

const router = Router();

router.use(requireAuth);

router.post('/generate-flashcards', validateSchema(generateFlashcardsSchema), AiController.generateFlashcards);
router.post('/generate-answer', validateSchema(generateAnswerSchema), AiController.generateAnswer);

export { router as aiRouter };
