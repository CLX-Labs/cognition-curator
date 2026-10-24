import { z } from 'zod';
import { deckImageSchema } from './deck-image.ts';

// Keep these wire contracts independent of the index module: the index re-exports
// them alongside the core sync contracts.
const uuid = z.uuid().toLowerCase();
const dateTime = z.iso.datetime({ offset: true });
const personFields = {
  id: uuid,
  name: z.string().trim().min(1).max(100),
  photoDataUrl: z
    .string()
    .max(280_000)
    .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/)
    .nullable(),
};

export const communityPersonSchema = z.strictObject(personFields);
export type CommunityPerson = z.infer<typeof communityPersonSchema>;
export const friendSchema = z.strictObject({ ...personFields, connectedAt: dateTime });
export type Friend = z.infer<typeof friendSchema>;
const inviteCode = z
  .string()
  .trim()
  .min(16)
  .max(256)
  .regex(/^[A-Za-z0-9_-]+$/);
export const friendInviteSchema = z.strictObject({ code: inviteCode, expiresAt: dateTime });
export type FriendInvite = z.infer<typeof friendInviteSchema>;
export const acceptInviteSchema = z.strictObject({ code: inviteCode });
export type AcceptInvite = z.infer<typeof acceptInviteSchema>;

export const sharedDeckSummarySchema = z.strictObject({
  id: uuid,
  name: z.string().trim().min(1).max(200),
  description: z.string().max(10_000),
  color: z.string().regex(/^#[a-fA-F0-9]{6}$/),
  icon: z.string().max(50),
  imageDataUrl: deckImageSchema.nullable().optional(),
});
export type SharedDeckSummary = z.infer<typeof sharedDeckSummarySchema>;
export const sharedCardSchema = z.strictObject({
  id: uuid,
  front: z.string().trim().min(1).max(20_000),
  back: z.string().trim().min(1).max(30_000),
  hint: z.string().max(10_000),
  explanation: z.string().max(30_000),
  tags: z.array(z.string().trim().min(1).max(100)).max(50),
  aiGenerated: z.boolean(),
});
export type SharedCard = z.infer<typeof sharedCardSchema>;
export const deckShareSchema = z.strictObject({
  id: uuid,
  sender: communityPersonSchema,
  recipient: communityPersonSchema,
  sourceDeckId: uuid,
  deck: sharedDeckSummarySchema,
  cardCount: z.number().int().nonnegative(),
  createdAt: dateTime,
  acceptedAt: dateTime.nullable(),
  recipientDeckId: uuid.nullable(),
  senderSharesProgress: z.boolean(),
  recipientSharesProgress: z.boolean(),
});
export type DeckShare = z.infer<typeof deckShareSchema>;
export const communityOverviewSchema = z.strictObject({
  friends: z.array(friendSchema),
  shares: z.array(deckShareSchema),
});
export type CommunityOverview = z.infer<typeof communityOverviewSchema>;
export const shareDetailSchema = z.strictObject({
  share: deckShareSchema,
  cards: z.array(sharedCardSchema),
});
export type ShareDetail = z.infer<typeof shareDetailSchema>;
export const createShareSchema = z.strictObject({
  operationId: uuid,
  friendId: uuid,
  deckId: uuid,
  shareProgress: z.boolean(),
});
export type CreateShare = z.infer<typeof createShareSchema>;
export const acceptShareSchema = z.strictObject({ shareProgress: z.boolean() });
export type AcceptShare = z.infer<typeof acceptShareSchema>;
export const progressPermissionSchema = z.strictObject({ enabled: z.boolean() });
export type ProgressPermission = z.infer<typeof progressPermissionSchema>;
