import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { validateSchema } from '../middleware/validateSchema';
import { createDeckSchema, updateDeckSchema } from '../schemas/decks.schema';
import * as DecksController from '../controllers/decks.controller';

const router = Router();

router.use(requireAuth);

router.get('/', DecksController.listDecks);
router.post('/', validateSchema(createDeckSchema), DecksController.createDeck);
router.get('/:deckId', DecksController.getDeck);
router.put('/:deckId', validateSchema(updateDeckSchema), DecksController.updateDeck);
router.delete('/:deckId', DecksController.deleteDeck);

export { router as decksRouter };
