import { Request, Response, NextFunction } from 'express';
import { DecksService } from '../services/decks.service';
import { serializeDeck } from '../serializers/deck.serializer';

export const listDecks = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const decks = await DecksService.findAll(req.user.id);
    res.json({ decks: decks.map(serializeDeck) });
  } catch (err) {
    next(err);
  }
};

export const createDeck = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const deck = await DecksService.create(req.user.id, req.body);
    res.status(201).json({ deck: serializeDeck(deck) });
  } catch (err) {
    next(err);
  }
};

export const getDeck = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const deck = await DecksService.findById(req.params['deckId'] as string, req.user.id);
    res.json({ deck: serializeDeck(deck) });
  } catch (err) {
    next(err);
  }
};

export const updateDeck = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const deck = await DecksService.update(req.params['deckId'] as string, req.user.id, req.body);
    res.json({ deck: serializeDeck(deck) });
  } catch (err) {
    next(err);
  }
};

export const deleteDeck = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await DecksService.remove(req.params['deckId'] as string, req.user.id);
    res.json({ message: 'Deck deleted' });
  } catch (err) {
    next(err);
  }
};
