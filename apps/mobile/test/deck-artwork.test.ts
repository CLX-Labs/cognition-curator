import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('../src/brand', () => ({ colors: { paper: '#fff' } }));
vi.mock('react-native', () => ({
  Image: (props: object) => React.createElement('image', props),
  View: ({ children, ...props }: any) => React.createElement('view', props, children),
  Text: ({ children, ...props }: any) => React.createElement('text', props, children),
  StyleSheet: { create: (value: unknown) => value, absoluteFill: {} },
}));
import { DeckArtwork } from '../src/brand-patterns';
let renderer: ReactTestRenderer | null = null;
const props = { id: 'deck', color: '#E7ED9B', icon: '📚' };
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = null;
  vi.unstubAllGlobals();
});
it('falls back to branded artwork if a cover cannot decode and accepts a different replacement', async () => {
  const photo = 'data:image/jpeg;base64,/9j/2Q==';
  await act(async () => {
    renderer = create(React.createElement(DeckArtwork, { ...props, imageDataUrl: photo }));
  });
  expect(renderer!.root.findByType('image').props.source.uri).toBe(photo);
  await act(async () => {
    renderer!.root.findByType('image').props.onError();
  });
  expect(renderer!.root.findByType('image').props.source).not.toHaveProperty('uri');
  const replacement = 'data:image/jpeg;base64,/9j/AA/2Q==';
  await act(async () => {
    renderer!.update(React.createElement(DeckArtwork, { ...props, imageDataUrl: replacement }));
  });
  expect(renderer!.root.findByType('image').props.source.uri).toBe(replacement);
});
it('never fetches a remote cover URL from malformed local or legacy data', async () => {
  await act(async () => {
    renderer = create(
      React.createElement(DeckArtwork, {
        ...props,
        imageDataUrl: 'https://unexpected.example/image.jpg',
      }),
    );
  });
  expect(renderer!.root.findByType('image').props.source).not.toHaveProperty('uri');
});
