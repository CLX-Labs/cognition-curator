import type { Repository } from './repository';

export const AI_CONSENT_KEY = 'anthropicConsent.v1';
type Consent = { provider: 'Anthropic'; version: 1; grantedAt: string };
export const aiConsentListeners = new Map<string, Set<() => void>>();
export async function hasAIConsent(repository: Pick<Repository, 'getState'>) {
  const value = await repository.getState<Consent>(AI_CONSENT_KEY);
  return (
    value?.provider === 'Anthropic' && value.version === 1 && typeof value.grantedAt === 'string'
  );
}
export async function requireAIConsent(repository: Pick<Repository, 'getState'>) {
  if (!(await hasAIConsent(repository)))
    throw new Error(
      'Allow sharing with Anthropic before generating. Your cards can still be written and practiced without AI.',
    );
}
export async function saveAIConsent(
  repository: Pick<Repository, 'ownerId' | 'setState'>,
  allowed: boolean,
) {
  await repository.setState(
    AI_CONSENT_KEY,
    allowed
      ? ({
          provider: 'Anthropic',
          version: 1,
          grantedAt: new Date().toISOString(),
        } satisfies Consent)
      : null,
  );
  for (const notify of aiConsentListeners.get(repository.ownerId) ?? []) notify();
}
