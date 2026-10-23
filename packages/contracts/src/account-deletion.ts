import { z } from 'zod';

const uuid = z.uuid().toLowerCase();
export const accountDeletionRequestSchema = z.strictObject({
  operationId: uuid,
  ownerId: uuid,
  challengeId: uuid,
  identityToken: z.string().min(20).max(20_000),
  authorizationCode: z.string().min(1).max(4096).optional(),
});
export type AccountDeletionRequest = z.infer<typeof accountDeletionRequestSchema>;
export const accountDeletionReceiptSchema = z.strictObject({
  requestId: uuid,
  ownerId: uuid,
  status: z.enum(['pending', 'completed']),
  requestedAt: z.iso.datetime({ offset: true }),
  completedAt: z.iso.datetime({ offset: true }).nullable(),
  estimatedCompletionDays: z.number().int().min(1).max(30).nullable(),
  actionRequired: z.enum(['none', 'reauthenticate', 'contact_support']),
});
export type AccountDeletionReceipt = z.infer<typeof accountDeletionReceiptSchema>;
