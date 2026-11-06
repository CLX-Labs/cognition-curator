import { useCallback, useEffect, useRef } from 'react';

/** Capture before async work; use the returned check before changing this screen. */
export function useActionScope(ownerId: string | null | undefined): () => () => boolean {
  const state = useRef({ ownerId, ownerEpoch: 0, mountEpoch: 0, mounted: true });
  if (state.current.ownerId !== ownerId) {
    state.current.ownerId = ownerId;
    ++state.current.ownerEpoch;
  }
  const ownerEpoch = state.current.ownerEpoch;
  useEffect(() => {
    state.current.mounted = true;
    return () => {
      state.current.mounted = false;
      ++state.current.mountEpoch;
    };
  }, []);
  return useCallback(() => {
    const mountEpoch = state.current.mountEpoch;
    return () =>
      ownerId != null &&
      state.current.mounted &&
      state.current.ownerEpoch === ownerEpoch &&
      state.current.mountEpoch === mountEpoch;
  }, [ownerId, ownerEpoch]);
}
