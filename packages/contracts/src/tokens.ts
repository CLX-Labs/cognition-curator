import { z } from 'zod';

export const FREE_MONTHLY_TOKENS = 10 as const;
export const PAID_MONTHLY_TOKENS = 100 as const;
export const TOKEN_SUBSCRIPTION_PRICE_USD = 3.99 as const;
export const TOKEN_SUBSCRIPTION_PRODUCT_ID = 'collect.software.recollect.tokens.monthly';

export const tokenBalanceSchema = z.strictObject({
  available: z.number().int().nonnegative(),
  reserved: z.number().int().nonnegative(),
  free: z.number().int().nonnegative(),
  paid: z.number().int().nonnegative(),
  earned: z.number().int().nonnegative(),
  freeMonthlyAllowance: z.literal(FREE_MONTHLY_TOKENS),
  freeResetsAt: z.iso.datetime({ offset: true }),
  subscription: z.strictObject({
    active: z.boolean(),
    productId: z.string().nullable(),
    renewsAt: z.iso.datetime({ offset: true }).nullable(),
  }),
});
export type TokenBalance = z.infer<typeof tokenBalanceSchema>;

export const tokenWalletSchema = tokenBalanceSchema.extend({
  enabled: z.boolean(),
  billing: z.strictObject({
    available: z.boolean(),
    productId: z.string().min(1),
    monthlyTokens: z.literal(PAID_MONTHLY_TOKENS),
    priceUsd: z.literal(TOKEN_SUBSCRIPTION_PRICE_USD),
  }),
});
export type TokenWallet = z.infer<typeof tokenWalletSchema>;

export const appleTokenPurchaseSchema = z.strictObject({
  signedTransaction: z.string().min(1).max(100_000),
});
export const appleTokenPurchaseResponseSchema = z.strictObject({
  balance: tokenBalanceSchema,
  transactionId: z.string().min(1),
});
export type AppleTokenPurchaseResponse = z.infer<typeof appleTokenPurchaseResponseSchema>;
export const appleBillingNotificationSchema = z.strictObject({
  signedPayload: z.string().min(1).max(200_000),
});

export const generationAnswerAcceptSchema = z.strictObject({
  operationId: z.uuid().toLowerCase(),
});
export const generationAnswerAcceptResponseSchema = z.strictObject({
  answer: z.string().min(1).max(30_000),
  tokenCharged: z.boolean(),
});
export type GenerationAnswerAcceptResponse = z.infer<typeof generationAnswerAcceptResponseSchema>;
