import React, { useEffect, useRef, useState } from 'react';
import type { Repository } from './repository';
import { Button, Panel, Text, s } from './ui';
import { aiConsentListeners, hasAIConsent, saveAIConsent } from './ai-consent';

export function useAIConsent(repository: Repository | null) {
  const [state, setState] = useState<{
    ownerId: string;
    allowed: boolean;
    loaded: boolean;
    error: string | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const scope = useRef(0);
  const reads = useRef(0);
  const inFlight = useRef(false);
  useEffect(() => {
    const epoch = ++scope.current;
    inFlight.current = false;
    setBusy(false);
    if (!repository) return;
    const refresh = () => {
      const read = ++reads.current;
      void hasAIConsent(repository)
        .then((allowed) => {
          if (scope.current === epoch && reads.current === read)
            setState({ ownerId: repository.ownerId, allowed, loaded: true, error: null });
        })
        .catch((cause) => {
          if (scope.current === epoch && reads.current === read)
            setState({
              ownerId: repository.ownerId,
              allowed: false,
              loaded: true,
              error: cause instanceof Error ? cause.message : 'Your AI permission could not load.',
            });
        });
    };
    const ownerListeners = aiConsentListeners.get(repository.ownerId) ?? new Set();
    ownerListeners.add(refresh);
    aiConsentListeners.set(repository.ownerId, ownerListeners);
    refresh();
    return () => {
      ++scope.current;
      ownerListeners.delete(refresh);
      if (!ownerListeners.size) aiConsentListeners.delete(repository.ownerId);
    };
  }, [repository]);
  async function setAllowed(allowed: boolean) {
    if (!repository || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    const epoch = scope.current;
    try {
      await saveAIConsent(repository, allowed);
    } catch (cause) {
      if (scope.current === epoch)
        setState({
          ownerId: repository.ownerId,
          allowed: false,
          loaded: true,
          error: cause instanceof Error ? cause.message : 'Your AI permission could not save.',
        });
    } finally {
      if (scope.current === epoch) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }
  const current = state?.ownerId === repository?.ownerId;
  return {
    allowed: current ? (state?.allowed ?? false) : false,
    loaded: current ? (state?.loaded ?? false) : false,
    error: current ? (state?.error ?? null) : null,
    busy,
    setAllowed,
  };
}
export function AIPermissionPanel({
  consent,
  settings = false,
}: {
  consent: ReturnType<typeof useAIConsent>;
  settings?: boolean;
}) {
  if (consent.allowed && !settings) return null;
  return (
    <Panel style={{ padding: 18 }}>
      <Text style={s.sectionTitle}>
        {consent.allowed ? 'AI generation is enabled' : 'Before you generate with AI'}
      </Text>
      <Text style={s.body}>
        With your permission, Recollect sends your question or deck title, topic and generation
        prompt to Anthropic to suggest cards or answers. When expanding a deck, up to 40 existing
        card fronts are included as context.
      </Text>
      <Text style={s.caption}>
        Recollect does not add your profile or Apple sign-in details to the AI prompt. Anything
        you include in your card text or generation prompt may be sent.
      </Text>
      <Text style={s.caption}>
        This is optional. Write and practice cards without AI. Permission applies to this signed-in
        account on this device. You can revoke it in the You tab; requests already sent cannot
        be recalled.
      </Text>
      {!!consent.error && (
        <Text accessibilityRole="alert" style={s.caption}>
          {consent.error}
        </Text>
      )}
      <Button
        title={consent.allowed ? 'Revoke AI sharing permission' : 'Allow sharing with Anthropic'}
        variant="secondary"
        size="compact"
        loading={consent.busy}
        disabled={!consent.loaded || consent.busy}
        onPress={() => void consent.setAllowed(!consent.allowed)}
      />
    </Panel>
  );
}
