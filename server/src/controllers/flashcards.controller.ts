import { Request, Response, NextFunction } from 'express';
import { FlashcardsService } from '../services/flashcards.service';
import { serializeFlashcard } from '../serializers/flashcard.serializer';

export const createFlashcard = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const card = await FlashcardsService.create(req.user.id, req.body);
    res.status(201).json({ flashcard: serializeFlashcard(card) });
  } catch (err) {
    next(err);
  }
};

export const batchCreateFlashcards = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cards = await FlashcardsService.createBatch(req.user.id, req.body);
    res.status(201).json({ flashcards: cards.map(serializeFlashcard), created: cards.length });
  } catch (err) {
    next(err);
  }
};

export const getFlashcardsByDeck = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cards = await FlashcardsService.findByDeck(req.params['deckId'] as string, req.user.id);
    res.json({ flashcards: cards.map(serializeFlashcard) });
  } catch (err) {
    next(err);
  }
};

export const getFlashcard = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const card = await FlashcardsService.findById(req.params['flashcardId'] as string, req.user.id);
    res.json({ flashcard: serializeFlashcard(card) });
  } catch (err) {
    next(err);
  }
};

export const updateFlashcard = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const card = await FlashcardsService.update(
      req.params['flashcardId'] as string,
      req.user.id,
      req.body
    );
    res.json({ flashcard: serializeFlashcard(card) });
  } catch (err) {
    next(err);
  }
};

export const deleteFlashcard = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await FlashcardsService.remove(req.params['flashcardId'] as string, req.user.id);
    res.json({ message: 'Flashcard deleted' });
  } catch (err) {
    next(err);
  }
};
