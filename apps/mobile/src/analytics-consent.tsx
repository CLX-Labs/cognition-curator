import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Repository } from './repository';
import { useStore } from './store';
import { Button, Panel, Text, s } from './ui';

export const ANALYTICS_CONSENT_KEY = 'posthogConsent.v1';

type SavedConsent = {
  provider: 'PostHog';
  version: 1;
  allowed: true;
  grantedAt: string;
};
type AnalyticsConsent = {
  allowed: boolean;
  loaded: boolean;
  busy: boolean;
  error: string | null;
  setAllowed(allowed: boolean): Promise<void>;
};
type Scope = {
  repository: Repository | null;
  ownerId: string | null;
  mounted: boolean;
  epoch: number;
  revision: number;
};
type ConsentState = Omit<AnalyticsConsent, 'setAllowed'> & { scope: Scope };

const AnalyticsConsentContext = createContext<AnalyticsConsent | null>(null);

function isGranted(value: unknown): value is SavedConsent {
  if (!value || typeof value !== 'object') return false;
  const consent = value as Partial<SavedConsent>;
  return (
    consent.provider === 'PostHog' &&
    consent.version === 1 &&
    consent.allowed === true &&
    typeof consent.grantedAt === 'string' &&
    Number.isFinite(Date.parse(consent.grantedAt))
  );
}

export function AnalyticsConsentProvider({ children }: { children: React.ReactNode }) {
  const { repository } = useStore();
  const ownerId = repository?.ownerId ?? null;
  const scope = useMemo<Scope>(
    () => ({ repository, ownerId, mounted: true, epoch: 0, revision: 0 }),
    [repository, ownerId],
  );
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const [state, setState] = useState<ConsentState | null>(null);
  // A failed revocation must not restore an older stored grant on an account switch.
  // Only a new, successfully saved opt-in clears this in-memory denial.
  const deniedOwners = useRef(new Set<string>());
  // Preserve the user's last choice even if saves span repository/account changes.
  const writes = useRef(new Map<string, Promise<void>>());

  useEffect(() => {
    scope.mounted = true;
    const epoch = ++scope.epoch;
    const revision = scope.revision;
    const current = () =>
      currentScope.current === scope &&
      scope.mounted &&
      scope.epoch === epoch &&
      scope.revision === revision;
    if (scope.repository && scope.ownerId) {
      void scope.repository
        .getState<unknown>(ANALYTICS_CONSENT_KEY)
        .then((saved) => {
          if (current())
            setState({
              scope,
              allowed: isGranted(saved) && !deniedOwners.current.has(scope.ownerId!),
              loaded: true,
              busy: false,
              error: null,
            });
        })
        .catch((cause) => {
          if (current())
            setState({
              scope,
              allowed: false,
              loaded: true,
              busy: false,
              error:
                cause instanceof Error
                  ? cause.message
                  : 'Your analytics preference could not load.',
            });
        });
    }
    return () => {
      scope.mounted = false;
      ++scope.epoch;
    };
  }, [scope]);

  const setAllowed = useCallback(
    async (allowed: boolean) => {
      const { repository: target, ownerId: owner } = scope;
      if (!target || !owner || !scope.mounted || currentScope.current !== scope) return;
      const epoch = scope.epoch;
      const revision = ++scope.revision;
      const current = () =>
        currentScope.current === scope &&
        scope.mounted &&
        scope.epoch === epoch &&
        scope.revision === revision;
      deniedOwners.current.add(owner);
      // Opt-in waits for durable permission. Revocation takes effect before the save.
      setState({ scope, allowed: false, loaded: true, busy: true, error: null });
      const saved = (writes.current.get(owner) ?? Promise.resolve())
        .catch(() => undefined)
        .then(() =>
          target.setState(
            ANALYTICS_CONSENT_KEY,
            allowed
              ? ({
                  provider: 'PostHog',
                  version: 1,
                  allowed: true,
                  grantedAt: new Date().toISOString(),
                } satisfies SavedConsent)
              : null,
          ),
        );
      writes.current.set(owner, saved);
      try {
        await saved;
        if (current()) {
          if (allowed) deniedOwners.current.delete(owner);
          setState({ scope, allowed, loaded: true, busy: false, error: null });
        }
      } catch (cause) {
        if (current())
          setState({
            scope,
            allowed: false,
            loaded: true,
            busy: false,
            error:
              cause instanceof Error
                ? cause.message
                : 'Your analytics preference could not save.',
          });
      }
    },
    [scope],
  );

  const current = state?.scope === scope;
  const value = useMemo<AnalyticsConsent>(
    () => ({
      allowed: current ? state.allowed : false,
      loaded: current ? state.loaded : false,
      busy: current ? state.busy : false,
      error: current ? state.error : null,
      setAllowed,
    }),
    [current, state, setAllowed],
  );
  return (
    <AnalyticsConsentContext.Provider value={value}>{children}</AnalyticsConsentContext.Provider>
  );
}

export function useAnalyticsConsent(): AnalyticsConsent {
  const consent = useContext(AnalyticsConsentContext);
  if (!consent) throw new Error('AnalyticsConsentProvider is missing.');
  return consent;
}

export function AnalyticsConsentPanel() {
  const consent = useAnalyticsConsent();
  return (
    <Panel>
      <Text style={s.sectionTitle}>App analytics &amp; replay</Text>
      <Text style={s.body}>
        Optional usage events and recordings of masked app screens help improve Recollect. If you
        enable this, they are sent to PostHog and linked to your internal account ID. Your screen
        text and images are masked and are not sent.
      </Text>
      <Text style={s.caption}>
        Permission applies to this account on this device only. You can disable it here anytime.
      </Text>
      <Text style={s.caption}>
        {!consent.loaded
          ? 'Loading your preference…'
          : consent.allowed
            ? 'Permission granted on this device'
            : 'Off on this device'}
      </Text>
      {!!consent.error && (
        <Text accessibilityRole="alert" style={s.caption}>
          {consent.error}
        </Text>
      )}
      <Button
        title={consent.allowed ? 'Disable analytics & replay' : 'Enable analytics & replay'}
        variant="secondary"
        size="compact"
        loading={consent.busy}
        disabled={!consent.loaded || consent.busy}
        onPress={() => void consent.setAllowed(!consent.allowed)}
      />
    </Panel>
  );
}
