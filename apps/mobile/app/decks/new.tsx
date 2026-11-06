import React from 'react';
import DeckForm from '../../src/deck-form';
import { Back, Panel, Screen } from '../../src/ui';
import { useLocalSearchParams } from 'expo-router';
export default function NewDeck() {
  const { categoryId } = useLocalSearchParams<{ categoryId?: string }>();
  return (
    <Screen
      title="New deck"
      eyebrow="LIBRARY"
      subtitle="Start with a name. Add cards next."
      leading={<Back label="Decks" />}
    >
      <Panel>
        <DeckForm categoryId={categoryId} />
      </Panel>
    </Screen>
  );
}
