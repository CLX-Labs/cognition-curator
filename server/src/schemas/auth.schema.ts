import { z } from 'zod';

export const magicLinkSendSchema = z.object({
  email: z.string().email(),
});

export const callbackSchema = z.object({
  token: z.string().min(1),
  token_type: z.enum(['magic_links', 'oauth']).optional(),
});

export const updateProfileSchema = z.object({
  name: z.string().min(1).optional(),
  displayName: z.string().optional(),
  timezone: z.string().optional(),
});

export type MagicLinkSendInput = z.infer<typeof magicLinkSendSchema>;
export type CallbackInput = z.infer<typeof callbackSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
