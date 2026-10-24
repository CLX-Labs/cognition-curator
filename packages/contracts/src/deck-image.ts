import { z } from 'zod';

// Small normalized cover art travels with its owning deck and shared snapshot.
// No remote URLs or unbounded image payloads are accepted.
export const MAX_DECK_IMAGE_LENGTH = 180_000;
export const deckImageSchema = z
  .string()
  .max(MAX_DECK_IMAGE_LENGTH)
  .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/);
