import React from 'react';
import DeckForm from '../../src/deck-form';
import { Back, Panel, Screen } from '../../src/ui';
export default function NewDeck() {
  return (
    <Screen
      title="New deck"
      eyebrow="LIBRARY"
      subtitle="Start with a name. Add cards next."
      leading={<Back label="Decks" />}
    >
      <Panel>
        <DeckForm />
      </Panel>
    </Screen>
  );
}
