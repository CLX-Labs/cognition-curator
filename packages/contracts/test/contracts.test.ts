import { describe, expect, it } from 'vitest';
import {
  cardInput,
  deckInputSchema,
  pushRequestSchema,
  reviewEventSchema,
  syncOperationSchema,
} from '../src/index.ts';

const id = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const at = '2026-10-11T12:00:00.000Z';
const review = {
  id,
  cardId: id,
  deckId: id,
  deviceId: id,
  deviceSequence: 1,
  rating: 'good',
  reviewedAt: at,
  elapsedMs: 2000,
  algorithmVersion: 'sm2-v1',
};

describe('runtime wire contracts', () => {
  it('rejects old numeric ratings and unknown scheduler versions', () => {
    expect(reviewEventSchema.safeParse({ ...review, rating: 2 }).success).toBe(false);
    expect(reviewEventSchema.safeParse({ ...review, algorithmVersion: 'old-sm2' }).success).toBe(
      false,
    );
    expect(reviewEventSchema.safeParse({ ...review, elapsedMs: -1 }).success).toBe(false);
  });
  it('prevents owner and server schedule assignment through content commands', () => {
    const content = {
      id,
      name: 'Biology',
      description: '',
      color: '#113355',
      icon: 'book',
      isSilenced: false,
      silencedUntil: null,
    };
    expect(deckInputSchema.safeParse({ ...content, ownerId: other }).success).toBe(false);
    const projected = cardInput({
      id,
      deckId: id,
      front: 'Question',
      back: 'Answer',
      hint: '',
      explanation: '',
      tags: [],
      aiGenerated: false,
    });
    expect(Object.keys(projected)).not.toContain('schedule');
  });
  it('validates operation/event device consistency and bounds batches', () => {
    const op = {
      operationId: id,
      deviceId: other,
      createdAt: at,
      type: 'review.append',
      payload: review,
    };
    expect(syncOperationSchema.safeParse(op).success).toBe(false);
    const valid = { ...op, deviceId: id };
    expect(pushRequestSchema.safeParse({ operations: [valid] }).success).toBe(true);
    expect(
      pushRequestSchema.safeParse({ operations: Array.from({ length: 101 }, () => valid) }).success,
    ).toBe(false);
  });
});
