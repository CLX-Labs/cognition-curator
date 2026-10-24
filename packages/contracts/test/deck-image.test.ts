import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  deckInput,
  deckInputSchema,
  deckImageSchema,
  MAX_DECK_IMAGE_LENGTH,
} from '../src/index.ts';

describe('optional bounded deck covers', () => {
  const input = {
    id: randomUUID(),
    name: 'Italian',
    description: '',
    color: '#2441EA',
    icon: '📚',
    isSilenced: false,
    silencedUntil: null,
  };
  const photo = 'data:image/jpeg;base64,/9j/2Q==';
  it('keeps old records and command projection free of an added undefined field', () => {
    expect(deckInputSchema.parse(input)).not.toHaveProperty('imageDataUrl');
    expect(deckInput(input)).not.toHaveProperty('imageDataUrl');
    expect(deckInput({ ...input, imageDataUrl: null }).imageDataUrl).toBeNull();
    expect(deckInput({ ...input, imageDataUrl: photo }).imageDataUrl).toBe(photo);
  });
  it('accepts only bounded JPEG data URLs before API structural validation', () => {
    expect(deckImageSchema.parse(photo)).toBe(photo);
    expect(deckImageSchema.safeParse('https://example.com/image.jpg').success).toBe(false);
    expect(deckImageSchema.safeParse('data:image/png;base64,AAAA').success).toBe(false);
    expect(
      deckImageSchema.safeParse('data:image/jpeg;base64,' + 'A'.repeat(MAX_DECK_IMAGE_LENGTH))
        .success,
    ).toBe(false);
  });
});
