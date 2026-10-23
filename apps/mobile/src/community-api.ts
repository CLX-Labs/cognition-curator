import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  communityOverviewSchema,
  deckShareSchema,
  friendInviteSchema,
  shareDetailSchema,
  type CommunityOverview,
  type DeckShare,
} from '@recollect/contracts';
import { api, ApiError } from './api';
import { useStore } from './store';

export const communityApi = {
  async overview(ownerId: string) {
    try {
      return communityOverviewSchema.parse(await api.request('/v1/community', { ownerId }));
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 404)
        throw new Error(
          'Friends are arriving in this release. Try again shortly while the server updates.',
        );
      throw cause;
    }
  },
  async invite(ownerId: string) {
    return friendInviteSchema.parse(
      await api.request('/v1/community/invites', { method: 'POST', ownerId }),
    );
  },
  async acceptInvite(ownerId: string, code: string) {
    return communityOverviewSchema.parse(
      await api.request('/v1/community/invites/accept', {
        method: 'POST',
        body: { code: code.trim() },
        ownerId,
      }),
    );
  },
  async removeFriend(ownerId: string, friendId: string) {
    await api.request('/v1/community/friends/' + encodeURIComponent(friendId), {
      method: 'DELETE',
      ownerId,
    });
  },
  async createShare(
    ownerId: string,
    body: {
      operationId: string;
      friendId: string;
      deckId: string;
      shareProgress: boolean;
    },
  ) {
    return deckShareSchema.parse(
      await api.request('/v1/community/shares', {
        method: 'POST',
        body,
        ownerId,
      }),
    );
  },
  async detail(ownerId: string, shareId: string) {
    return shareDetailSchema.parse(
      await api.request('/v1/community/shares/' + encodeURIComponent(shareId), { ownerId }),
    );
  },
  async acceptShare(ownerId: string, shareId: string, shareProgress: boolean) {
    return deckShareSchema.parse(
      await api.request('/v1/community/shares/' + encodeURIComponent(shareId) + '/accept', {
        method: 'POST',
        body: { shareProgress },
        ownerId,
      }),
    );
  },
  async permission(ownerId: string, shareId: string, enabled: boolean) {
    return deckShareSchema.parse(
      await api.request('/v1/community/shares/' + encodeURIComponent(shareId) + '/progress', {
        method: 'PATCH',
        body: { enabled },
        ownerId,
      }),
    );
  },
  async revoke(ownerId: string, shareId: string) {
    await api.request('/v1/community/shares/' + encodeURIComponent(shareId), {
      method: 'DELETE',
      ownerId,
    });
  },
};

export function otherParticipant(share: DeckShare, ownerId: string) {
  return share.sender.id === ownerId ? share.recipient : share.sender;
}
export function sharesWith(overview: CommunityOverview, ownerId: string, friendId: string) {
  return overview.shares.filter((share) => otherParticipant(share, ownerId).id === friendId);
}
export function progressVisible(share: DeckShare, userId: string) {
  return share.sender.id === userId
    ? share.senderSharesProgress
    : share.recipient.id === userId
      ? share.recipientSharesProgress
      : false;
}

/** Invalidate pending reads/actions on blur or account changes; never poll social data. */
export function useCommunityResource<T>(
  key: string,
  load: (ownerId: string) => Promise<T>,
  enabled = true,
) {
  const { session } = useStore();
  const ownerId = session?.user.id ?? null;
  const identity = ownerId + ':' + key;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const loader = useRef(load);
  loader.current = load;
  const active = useRef(false);
  const epoch = useRef(0);
  const busyRef = useRef<string | null>(null);
  const [state, setState] = useState<{
    identity: string;
    data: T | null;
    loading: boolean;
    error: string | null;
    busy: string | null;
  }>({
    identity,
    data: null,
    loading: false,
    error: null,
    busy: null,
  });
  const isCurrent = useCallback(
    (generation: number) =>
      active.current && epoch.current === generation && identityRef.current === identity,
    [identity],
  );
  const refresh = useCallback(async () => {
    if (
      !ownerId ||
      !enabled ||
      !active.current ||
      busyRef.current ||
      identityRef.current !== identity
    )
      return;
    const generation = ++epoch.current;
    setState((previous) => ({
      identity,
      data: previous.identity === identity ? previous.data : null,
      loading: true,
      error: null,
      busy: busyRef.current,
    }));
    try {
      const data = await loader.current(ownerId);
      if (isCurrent(generation))
        setState((previous) => ({ ...previous, identity, data, loading: false, error: null }));
    } catch (cause) {
      if (isCurrent(generation))
        setState((previous) => ({
          ...previous,
          loading: false,
          error: cause instanceof Error ? cause.message : 'Could not load this. Try again.',
        }));
    }
  }, [ownerId, identity, enabled, isCurrent]);
  useFocusEffect(
    useCallback(() => {
      active.current = true;
      busyRef.current = null;
      if (enabled) void refresh();
      return () => {
        active.current = false;
        ++epoch.current;
        busyRef.current = null;
      };
    }, [refresh, enabled]),
  );
  const run = useCallback(
    async <R>(label: string, action: (ownerId: string) => Promise<R>) => {
      if (!ownerId || !active.current || busyRef.current || identityRef.current !== identity)
        return null;
      busyRef.current = label;
      const generation = ++epoch.current;
      setState((previous) => ({
        ...previous,
        identity,
        data: previous.identity === identity ? previous.data : null,
        busy: label,
        loading: false,
        error: null,
      }));
      try {
        const result = await action(ownerId);
        return isCurrent(generation) ? result : null;
      } catch (cause) {
        if (isCurrent(generation))
          setState((previous) => ({
            ...previous,
            error: cause instanceof Error ? cause.message : 'Could not finish. Try again.',
          }));
        return null;
      } finally {
        if (isCurrent(generation)) {
          busyRef.current = null;
          setState((previous) => ({ ...previous, busy: null }));
        }
      }
    },
    [ownerId, identity, isCurrent],
  );
  const current = state.identity === identity;
  return {
    ownerId,
    data: current ? state.data : null,
    loading: current ? state.loading : enabled,
    error: current ? state.error : null,
    busy: current ? state.busy : null,
    refresh,
    run,
  };
}
