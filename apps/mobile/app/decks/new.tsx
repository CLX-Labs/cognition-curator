import React from 'react';
import DeckForm from '../../src/deck-form';
import { Back, Screen } from '../../src/ui';
export default function NewDeck() {
  return (
    <Screen title="A new collection." eyebrow="CREATE A DECK">
      <Back />
      <DeckForm />
    </Screen>
  );
}
