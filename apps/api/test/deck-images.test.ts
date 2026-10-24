import { describe, expect, it } from 'vitest';
import { assertDeckImage, legacyDeckImageResponse } from '../src/deck-images.js';
import { deckImage } from './deck-image-fixture.js';

describe('bounded JPEG deck covers', () => {
  it('accepts normalized square JPEGs and optional removal', () => {
    expect(() => assertDeckImage(deckImage)).not.toThrow();
    expect(() => assertDeckImage(null)).not.toThrow();
    expect(() => assertDeckImage(undefined)).not.toThrow();
  });
  it('rejects remote URLs, fake, truncated and noncanonical JPEG data', () => {
    for (const value of [
      'https://example.com/image.jpg',
      'data:image/jpeg;base64,/9j/2Q==',
      deckImage.slice(0, -8),
      deckImage + '=',
      'data:image/jpeg;base64,' + 'A'.repeat(180000),
    ])
      expect(() => assertDeckImage(value)).toThrow();
  });
  it('rejects rectangular or excessive decoded dimensions despite small encoded payloads', () => {
    const bytes = Buffer.from(deckImage.split(',')[1]!, 'base64');
    const frame = bytes.indexOf(Buffer.from([0xff, 0xc0]));
    expect(frame).toBeGreaterThan(0);
    for (const [width, height] of [
      [1025, 1025],
      [4, 8],
      [0, 0],
    ]) {
      const changed = Buffer.from(bytes);
      changed.writeUInt16BE(height!, frame + 5);
      changed.writeUInt16BE(width!, frame + 7);
      expect(() =>
        assertDeckImage('data:image/jpeg;base64,' + changed.toString('base64')),
      ).toThrow();
    }
  });
  it('removes only deck-shaped cover fields from legacy wire output without mutating source data', () => {
    const deck = {
      name: 'Italian',
      description: '',
      icon: '📚',
      color: '#2441EA',
      imageDataUrl: deckImage,
    };
    const source = {
      decks: [deck],
      canonical: { entity: 'deck', data: deck },
      listing: { deck },
      other: { imageDataUrl: 'unrelated' },
    };
    const projected = legacyDeckImageResponse(source) as typeof source;
    expect(projected.decks[0]).not.toHaveProperty('imageDataUrl');
    expect(projected.canonical.data).not.toHaveProperty('imageDataUrl');
    expect(projected.listing.deck).not.toHaveProperty('imageDataUrl');
    expect(projected.other.imageDataUrl).toBe('unrelated');
    expect(source.decks[0]!.imageDataUrl).toBe(deckImage);
  });
});
