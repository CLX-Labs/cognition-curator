import { z } from 'zod';

export const blockedUsersSchema = z.strictObject({
  users: z.array(z.strictObject({ id: z.uuid().toLowerCase(), name: z.string() })),
});
export const contentReportSchema = z.strictObject({
  targetUserId: z.uuid().toLowerCase(),
  shareId: z.uuid().toLowerCase().optional(),
  reason: z.enum(['inappropriate', 'harassment', 'spam', 'other']),
  details: z.string().trim().max(2000).optional(),
});
export const contentReportReceiptSchema = z.strictObject({
  id: z.uuid().toLowerCase(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type ContentReport = z.infer<typeof contentReportSchema>;
