import { describe, expect, it } from 'vitest';
import {
  acceptInviteSchema,
  acceptShareSchema,
  communityOverviewSchema,
  createShareSchema,
  progressPermissionSchema,
  shareDetailSchema,
} from '../src/index.ts';

const id = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const at = '2026-10-22T12:00:00.000Z';
const sender = { id, name: 'Alex', photoDataUrl: null };
const recipient = { ...sender, id: other, name: 'Jordan' };
const share = {
  id,
  sender,
  recipient,
  sourceDeckId: id,
  deck: { id, name: 'Italian', description: '', color: '#113355', icon: '🇮🇹' },
  cardCount: 1,
  createdAt: at,
  acceptedAt: null,
  recipientDeckId: null,
  senderSharesProgress: false,
  recipientSharesProgress: false,
};

describe('community wire contracts', () => {
  it('keeps shared previews free of account credentials and private scheduler state', () => {
    const card = {
      id,
      front: 'Ciao',
      back: 'Hello',
      hint: '',
      explanation: '',
      tags: [],
      aiGenerated: false,
    };
    expect(shareDetailSchema.safeParse({ share, cards: [card] }).success).toBe(true);
    expect(shareDetailSchema.safeParse({ share, cards: [{ ...card, schedule: {} }] }).success).toBe(
      false,
    );
    expect(
      communityOverviewSchema.safeParse({
        friends: [{ ...sender, connectedAt: at, email: 'private@example.com' }],
        shares: [],
      }).success,
    ).toBe(false);
  });

  it('requires explicit progress permission and server-assigned ownership', () => {
    const input = { operationId: id, friendId: other, deckId: id, shareProgress: false };
    expect(createShareSchema.safeParse(input).success).toBe(true);
    expect(createShareSchema.safeParse({ ...input, ownerId: other }).success).toBe(false);
    expect(acceptShareSchema.safeParse({}).success).toBe(false);
    expect(progressPermissionSchema.safeParse({ enabled: true }).success).toBe(true);
    expect(progressPermissionSchema.safeParse({ enabled: 'true' }).success).toBe(false);
  });

  it('accepts opaque invite codes and rejects URLs or oversized untrusted input', () => {
    expect(acceptInviteSchema.safeParse({ code: 'opaque_invite-code_1234567890' }).success).toBe(
      true,
    );
    expect(acceptInviteSchema.safeParse({ code: 'https://example.com/invite' }).success).toBe(
      false,
    );
    expect(acceptInviteSchema.safeParse({ code: 'x'.repeat(257) }).success).toBe(false);
  });
});
