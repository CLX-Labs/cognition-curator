import React from 'react';
import { randomUUID } from 'node:crypto';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Deck } from '@recollect/contracts';
const rig = vi.hoisted(() => ({
  owner: 'owner-a',
  repo: null as any,
  choose: vi.fn(),
  save: vi.fn(),
  replace: vi.fn(),
  error: vi.fn(),
}));
vi.mock('react-native', () => ({
  View: ({ children, ...props }: any) => React.createElement('view', props, children),
  Pressable: ({ children, ...props }: any) => React.createElement('pressable', props, children),
}));
vi.mock('expo-router', () => ({ router: { replace: rig.replace } }));
vi.mock('../src/store', () => ({
  useStore: () => ({ repository: rig.repo, mutate: async (work: any) => work(rig.repo) }),
}));
vi.mock('../src/deck-photo', () => ({ chooseDeckPhoto: rig.choose }));
vi.mock('../src/brand-patterns', () => ({
  DeckArtwork: (props: object) => React.createElement('deck-art', props),
}));
vi.mock('../src/ui', () => ({
  Button: (props: object) => React.createElement('button', props),
  Field: (props: object) => React.createElement('field', props),
  Text: ({ children, ...props }: any) => React.createElement('text', props, children),
  colors: {},
  s: {},
  reportError: rig.error,
}));
import DeckForm from '../src/deck-form';
const photo = 'data:image/jpeg;base64,/9j/2Q==';
let renderer: ReactTestRenderer | null = null;
function deck(): Deck {
  return {
    id: randomUUID(),
    ownerId: rig.owner,
    name: 'Italian',
    description: '',
    color: '#E7ED9B',
    icon: '📚',
    isSilenced: false,
    silencedUntil: null,
    version: 1,
    createdAt: '2026-10-24T00:00:00Z',
    updatedAt: '2026-10-24T00:00:00Z',
    deletedAt: null,
  };
}
const button = (title: string) =>
  renderer!.root.findAllByType('button').find((item) => item.props.title === title)!;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  rig.owner = 'owner-a';
  rig.repo = { ownerId: rig.owner, newId: randomUUID, saveDeck: rig.save };
  rig.choose.mockResolvedValue(photo);
  rig.save.mockResolvedValue(undefined);
});
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = null;
  vi.unstubAllGlobals();
});
it('shows cover controls before appearance details and saves the picked image with ordinary deck edits', async () => {
  const baseline = deck();
  await act(async () => {
    renderer = create(React.createElement(DeckForm, { deck: baseline }));
  });
  expect(renderer!.root.findAllByType('field').map((field) => field.props.label)).toEqual([
    'Deck name',
  ]);
  await act(async () => {
    button('Choose image').props.onPress();
  });
  expect(renderer!.root.findByType('deck-art').props.imageDataUrl).toBe(photo);
  await act(async () => {
    button('Save changes').props.onPress();
  });
  expect(rig.save).toHaveBeenCalledWith(
    expect.objectContaining({ id: baseline.id, imageDataUrl: photo }),
    baseline,
  );
});
it('cancelling a replacement keeps the cover; using default explicitly saves null', async () => {
  const baseline = { ...deck(), imageDataUrl: photo };
  rig.choose.mockResolvedValueOnce(null);
  await act(async () => {
    renderer = create(React.createElement(DeckForm, { deck: baseline }));
  });
  await act(async () => {
    button('Change image').props.onPress();
  });
  expect(renderer!.root.findByType('deck-art').props.imageDataUrl).toBe(photo);
  await act(async () => {
    button('Use default artwork').props.onPress();
  });
  expect(renderer!.root.findByType('deck-art').props.imageDataUrl).toBeNull();
  await act(async () => {
    button('Save changes').props.onPress();
  });
  expect(rig.save).toHaveBeenCalledWith(expect.objectContaining({ imageDataUrl: null }), baseline);
});
it('does not invent a cover field for an unchanged legacy deck', async () => {
  await act(async () => {
    renderer = create(React.createElement(DeckForm, { deck: deck() }));
  });
  await act(async () => {
    button('Save changes').props.onPress();
  });
  expect(rig.save.mock.calls[0]![0]).not.toHaveProperty('imageDataUrl');
});
it('ignores a late picker result after leaving the form and suppresses duplicate launches', async () => {
  let finish!: (value: string) => void;
  rig.choose.mockReturnValueOnce(
    new Promise<string>((resolve) => {
      finish = resolve;
    }),
  );
  await act(async () => {
    renderer = create(React.createElement(DeckForm, { deck: deck() }));
  });
  await act(async () => {
    button('Choose image').props.onPress();
    button('Choose image').props.onPress();
  });
  expect(rig.choose).toHaveBeenCalledTimes(1);
  await act(async () => {
    renderer!.unmount();
    renderer = null;
    finish(photo);
  });
  expect(rig.save).not.toHaveBeenCalled();
  expect(rig.replace).not.toHaveBeenCalled();
});
it('does not apply or save a photo selected for a previous signed-in account', async () => {
  const baseline = deck();
  let finish!: (value: string) => void;
  rig.choose.mockReturnValueOnce(
    new Promise<string>((resolve) => {
      finish = resolve;
    }),
  );
  await act(async () => {
    renderer = create(React.createElement(DeckForm, { deck: baseline }));
  });
  await act(async () => {
    button('Choose image').props.onPress();
  });
  rig.repo = { ...rig.repo, ownerId: 'owner-b' };
  await act(async () => {
    renderer!.update(React.createElement(DeckForm, { deck: baseline }));
  });
  await act(async () => {
    finish(photo);
  });
  expect(renderer!.root.findByType('deck-art').props.imageDataUrl).toBeUndefined();
  await act(async () => {
    button('Save changes').props.onPress();
  });
  expect(rig.save).not.toHaveBeenCalled();
});
