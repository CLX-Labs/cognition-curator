import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { validateSchema } from '../middleware/validateSchema';
import {
  createFlashcardSchema,
  batchFlashcardSchema,
  updateFlashcardSchema,
} from '../schemas/flashcards.schema';
import * as FlashcardsController from '../controllers/flashcards.controller';

const router = Router();

router.use(requireAuth);

router.post('/', validateSchema(createFlashcardSchema), FlashcardsController.createFlashcard);
router.post('/batch', validateSchema(batchFlashcardSchema), FlashcardsController.batchCreateFlashcards);
router.get('/deck/:deckId', FlashcardsController.getFlashcardsByDeck);
router.get('/:flashcardId', FlashcardsController.getFlashcard);
router.put('/:flashcardId', validateSchema(updateFlashcardSchema), FlashcardsController.updateFlashcard);
router.delete('/:flashcardId', FlashcardsController.deleteFlashcard);

export { router as flashcardsRouter };
