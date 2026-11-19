export type AnalyticsClient = {
  identify(id: string): void;
  screen(name: string, properties?: Record<string, string | boolean>): void | Promise<void>;
  register(properties: Record<string, string>): void | Promise<void>;
  reset(): void;
  optIn(): Promise<void>;
  optOut(): Promise<void>;
  startSessionRecording(resumeCurrent?: boolean): Promise<void>;
  stopSessionRecording(): Promise<void>;
  // Query the native plugin directly. SDK convenience queries may return false
  // after swallowing a native error, which cannot confirm a privacy boundary.
  isSessionRecordingActive(): Promise<boolean>;
};

type Target = { ownerId: string; screen: string };
type ActiveScope = { version: number; ownerId: string; screen: string | null; ready: boolean };

/**
 * Owns one lazily created SDK client. The factory must disable default capture,
 * automatic events and automatic replay, and use canCapture in its event filter.
 * Native replay cannot be canceled synchronously: stop/opt-out are requested at
 * withdrawal, then repeated after any in-flight operation settles.
 */
export function createAnalyticsSession(createClient: (canCapture: () => boolean) => AnalyticsClient) {
  let desired: Target | null = null;
  let version = 0;
  let enabledVersion: number | null = null;
  let active: ActiveScope | null = null;
  let client: AnalyticsClient | null = null;
  let creationAttempted = false;
  let unusable = false;
  let failedVersion: number | null = null;
  let interruptions: Promise<boolean>[] = [];
  let queue: Promise<void> = Promise.resolve();

  const current = (scope: ActiveScope) =>
    desired !== null && scope.version === version && scope.ownerId === desired.ownerId;
  const canCapture = () =>
    !unusable && active !== null && enabledVersion === version && current(active);

  async function attempt(action: () => void | Promise<void>): Promise<boolean> {
    try {
      await action();
      return true;
    } catch {
      // Optional analytics must never prevent an account or navigation change.
      return false;
    }
  }

  function interrupt() {
    if (!client || !active) return;
    const sdk = client;
    // Do not wait behind a network/native start before requesting withdrawal.
    // SDK-native ordering cancels pending starts; the serialized cleanup below
    // also handles a start/opt-in that was already in flight when this ran.
    interruptions.push(attempt(() => sdk.stopSessionRecording()));
    interruptions.push(attempt(() => sdk.optOut()));
  }

  async function cleanup() {
    enabledVersion = null;
    if (!client || !active) return;
    const sdk = client;
    // A delayed interrupt must finish before another account can opt in.
    while (interruptions.length) {
      const pending = interruptions;
      interruptions = [];
      await Promise.all(pending);
    }
    const stopped = await attempt(() => sdk.stopSessionRecording());
    const optedOut = await attempt(() => sdk.optOut());
    while (interruptions.length) {
      const pending = interruptions;
      interruptions = [];
      await Promise.all(pending);
    }
    let reset = true;
    try {
      sdk.reset();
    } catch {
      reset = false;
    }
    let confirmedStopped = false;
    try {
      // Resolving stop/opt-out is insufficient: some SDK wrappers swallow native
      // failures. A literal false from the native status API is required before
      // another identity may reuse this recorder.
      confirmedStopped = (await sdk.isSessionRecordingActive()) === false;
    } catch {
      // An unavailable bridge or failed query leaves native recording unknown.
    }
    // Scope changes during the native query issue additional immediate stops.
    // Drain them too so an old opt-out cannot overtake a new account's opt-in.
    while (interruptions.length) {
      const pending = interruptions;
      interruptions = [];
      await Promise.all(pending);
    }
    active = null;
    // If stopping, resetting or status confirmation failed, a new identity
    // cannot safely reuse this native client for the rest of the app process.
    if (!stopped || !optedOut || !reset || !confirmedStopped) unusable = true;
  }

  async function reconcile() {
    for (;;) {
      if (active && (!current(active) || failedVersion === active.version || unusable)) {
        await cleanup();
        continue;
      }
      if (!desired || unusable || failedVersion === version) return;

      if (!client) {
        if (creationAttempted) return;
        creationAttempted = true;
        try {
          client = createClient(canCapture);
        } catch {
          unusable = true;
          return;
        }
      }
      const sdk = client;
      if (!active) {
        const scope: ActiveScope = {
          version,
          ownerId: desired.ownerId,
          screen: null,
          ready: false,
        };
        active = scope;
        try {
          await sdk.optIn();
          if (!current(scope)) continue;
          // No automatic events are enabled. Open the filter for identify only
          // after opt-in has completed for this still-consented account.
          enabledVersion = scope.version;
          sdk.identify(scope.ownerId);
          if (!current(scope)) continue;
          await sdk.startSessionRecording(false);
          if (!current(scope)) continue;
          scope.ready = true;
        } catch {
          enabledVersion = null;
          failedVersion = scope.version;
          continue;
        }
      }

      const scope = active;
      if (!scope || !current(scope) || !scope.ready) continue;
      const screen = desired.screen;
      if (scope.screen !== screen) {
        try {
          await sdk.screen(screen);
          if (!current(scope)) continue;
          scope.screen = screen;
        } catch {
          enabledVersion = null;
          failedVersion = scope.version;
          continue;
        }
      }
      if (current(scope) && desired.screen === scope.screen) return;
    }
  }

  function update(target: Target | null): Promise<void> {
    if (desired?.ownerId === target?.ownerId && desired?.screen === target?.screen) return queue;
    const changedOwner = desired?.ownerId !== target?.ownerId;
    desired = target ? { ...target } : null;
    if (changedOwner) {
      ++version;
      enabledVersion = null;
      interrupt();
    }
    // Each update schedules reconciliation, including one arriving between a
    // previous reconciliation's last await and its promise settling.
    queue = queue.then(reconcile).catch(async () => {
      enabledVersion = null;
      unusable = true;
      await cleanup();
    });
    return queue;
  }

  return { update, canCapture };
}
