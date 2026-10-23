export interface ApiConfig {
  databaseUrl: string;
  accessSecret: string;
  appleAudience: string;
  enableDevAuth: boolean;
  production: boolean;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
  dailyGenerationCards: number;
  appleSignInTeamId?: string;
  appleSignInKeyId?: string;
  appleSignInPrivateKey?: string;
  accountDeletionMaxDays?: number;
}
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const production = env.NODE_ENV === 'production';
  const enableDevAuth = env.ENABLE_DEV_AUTH === 'true';
  if (production && enableDevAuth) throw new Error('ENABLE_DEV_AUTH is forbidden in production.');
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  if (!env.ACCESS_TOKEN_SECRET || env.ACCESS_TOKEN_SECRET.length < 32)
    throw new Error(
      'ACCESS_TOKEN_SECRET must contain at least 32 characters; there is no fallback.',
    );
  if (!env.APPLE_BUNDLE_ID && !enableDevAuth)
    throw new Error('APPLE_BUNDLE_ID is required for verified Apple sign-in.');
  const dailyGenerationCards = Number(env.DAILY_GENERATION_CARDS ?? 100);
  const accountDeletionMaxDays = env.ACCOUNT_DELETION_MAX_DAYS
    ? Number(env.ACCOUNT_DELETION_MAX_DAYS)
    : undefined;
  if (
    accountDeletionMaxDays !== undefined &&
    (!Number.isSafeInteger(accountDeletionMaxDays) ||
      accountDeletionMaxDays < 1 ||
      accountDeletionMaxDays > 30)
  )
    throw new Error(
      'ACCOUNT_DELETION_MAX_DAYS must be the actual operational commitment, an integer from 1 to 30.',
    );
  if (
    !Number.isSafeInteger(dailyGenerationCards) ||
    dailyGenerationCards < 1 ||
    dailyGenerationCards > 10000
  )
    throw new Error('DAILY_GENERATION_CARDS must be an integer between 1 and 10000.');
  return {
    databaseUrl: env.DATABASE_URL,
    accessSecret: env.ACCESS_TOKEN_SECRET,
    appleAudience: env.APPLE_BUNDLE_ID ?? '',
    enableDevAuth,
    production,
    accessTtlSeconds: 900,
    refreshTtlSeconds: 2_592_000,
    dailyGenerationCards,
    appleSignInTeamId: env.APPLE_SIGN_IN_TEAM_ID,
    appleSignInKeyId: env.APPLE_SIGN_IN_KEY_ID,
    appleSignInPrivateKey: env.APPLE_SIGN_IN_PRIVATE_KEY,
    accountDeletionMaxDays,
  };
}
