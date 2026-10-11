import { requireOptionalNativeModule } from 'expo-modules-core';

export interface WidgetSnapshot {
  ownerId: string;
  dueCount: number;
  hasCards: boolean;
  updatedAt: string;
  topCard: { id: string; question: string; answer: string; deckName: string } | null;
}

interface WidgetNativeModule {
  setWidgetOwner(ownerId: string | null): Promise<void>;
  publishWidget(json: string | null): Promise<void>;
}

const native = requireOptionalNativeModule<WidgetNativeModule>('RecollectWidget');
export const isWidgetAvailable = (): boolean => native !== null;

/** Call at auth restoration/login. Clears any snapshot belonging to a prior session. */
export async function setWidgetOwner(ownerId: string | null): Promise<void> {
  if (native) await native.setWidgetOwner(ownerId);
}

/** null also revokes active ownership, so a stale async publish after logout is rejected. */
export async function publishWidget(snapshot: WidgetSnapshot | null): Promise<void> {
  if (native) await native.publishWidget(snapshot === null ? null : JSON.stringify(snapshot));
}
