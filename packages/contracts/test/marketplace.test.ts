import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  marketplacePublishSchema,
  marketplaceSettingsSchema,
  marketplaceSnapshotJson,
  marketplaceSnapshotValue,
  marketplaceUsageSchema,
} from '../src/marketplace.ts';
import { hash } from '@recollect/db';

describe('marketplace privacy contracts', () => {
  it('requires explicit rights acknowledgment and defaults all public statistics off', () => {
    const request = {
      operationId: randomUUID(),
      deckId: randomUUID(),
      rightsAccepted: true,
      expectedContentHash: 'a'.repeat(64),
    };
    expect(marketplacePublishSchema.parse(request)).toMatchObject({
      showDownloadCount: false,
      showUsageStats: false,
    });
    expect(marketplacePublishSchema.safeParse({ ...request, rightsAccepted: false }).success).toBe(
      false,
    );
    expect(
      marketplacePublishSchema.safeParse({
        operationId: request.operationId,
        deckId: request.deckId,
      }).success,
    ).toBe(false);
  });
  it('canonicalizes reviewed content identically across client and server without sync metadata', () => {
    const deck = {
      id: randomUUID(),
      name: 'Italian',
      description: 'Vocabulary',
      color: '#2441EA',
      icon: '📚',
    };
    const cards = [
      {
        id: '00000000-0000-4000-8000-000000000002',
        front: 'Grazie',
        back: 'Thank you',
        hint: '',
        explanation: '',
        tags: ['Italian'],
        aiGenerated: false,
      },
      {
        id: '00000000-0000-4000-8000-000000000001',
        front: 'Ciao',
        back: 'Hello',
        hint: '',
        explanation: '',
        tags: ['Italian'],
        aiGenerated: false,
      },
    ];
    const json = marketplaceSnapshotJson(deck, cards);
    expect(createHash('sha256').update(json, 'utf8').digest('hex')).toBe(
      hash(marketplaceSnapshotValue(deck, cards)),
    );
    expect(marketplaceSnapshotJson(deck, [...cards].reverse())).toBe(json);
    const withMetadata = cards.map((card) => ({
      ...card,
      ownerId: randomUUID(),
      version: 9,
      schedule: { nextReviewAt: 'tomorrow' },
    }));
    expect(marketplaceSnapshotJson({ ...deck, version: 12 } as typeof deck, withMetadata)).toBe(
      json,
    );
    expect(
      marketplaceSnapshotJson(
        deck,
        cards.map((card, index) => (index ? card : { ...card, back: 'Thanks' })),
      ),
    ).not.toBe(json);
    expect(
      marketplacePublishSchema.safeParse({
        operationId: randomUUID(),
        deckId: deck.id,
        rightsAccepted: true,
      }).success,
    ).toBe(false);
  });
  it('rejects empty settings and analytics filters or identity-level output', () => {
    expect(marketplaceSettingsSchema.safeParse({}).success).toBe(false);
    expect(marketplaceSettingsSchema.safeParse({ showUsageStats: false }).success).toBe(true);
    const usage = { learnerBand: '5–9', reviewBand: '1–9', recallBand: 'mixed', windowDays: 30 };
    expect(marketplaceUsageSchema.parse(usage)).toEqual(usage);
    expect(marketplaceUsageSchema.safeParse({ ...usage, learnerIds: [randomUUID()] }).success).toBe(
      false,
    );
    expect(marketplaceUsageSchema.safeParse({ ...usage, reviewCount: 7 }).success).toBe(false);
  });
});
