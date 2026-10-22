import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Profile, ProfileUpdate } from '@recollect/contracts';

const rig = vi.hoisted(() => ({
  profile: null as Profile | null,
  save: vi.fn<(patch: ProfileUpdate) => Promise<void>>(),
  pick: vi.fn<() => Promise<string | null>>(),
}));
vi.mock('../src/profile', () => ({
  useProfile: () => ({
    profile: rig.profile,
    loading: false,
    error: null,
    refresh: async () => {},
    save: rig.save,
  }),
}));
vi.mock('../src/profile-photo', () => ({ chooseProfilePhoto: () => rig.pick() }));
vi.mock('../src/avatar', () => ({
  default: (props: unknown) => React.createElement('avatar', props),
}));
vi.mock('expo-router', () => ({ useFocusEffect: () => {} }));
vi.mock('react-native', () => ({
  View: ({ children, ...props }: { children: React.ReactNode }) =>
    React.createElement('view', props, children),
  Pressable: ({ children, ...props }: { children: React.ReactNode }) =>
    React.createElement('pressable', props, children),
}));
vi.mock('../src/ui', () => ({
  colors: {},
  s: {},
  Text: ({ children, ...props }: { children: React.ReactNode }) =>
    React.createElement('text', props, children),
  Button: (props: unknown) => React.createElement('button', props),
  Field: (props: unknown) => React.createElement('field', props),
}));
import ProfileEditor from '../src/profile-editor';
const photo = 'data:image/jpeg;base64,/9j/2Q==';
let renderer: ReactTestRenderer | null = null;
const button = (title: string) =>
  renderer!.root.findAllByType('button').find((node) => node.props.title === title)!;
const field = () => renderer!.root.findByType('field');
const text = () =>
  renderer!.root
    .findAllByType('text')
    .flatMap((node) => node.children)
    .join(' ');
async function press(title: string) {
  await act(async () => button(title).props.onPress());
}
async function edit() {
  await act(async () => {
    renderer = create(React.createElement(ProfileEditor, { email: null }));
  });
  await press('Edit profile');
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  rig.profile = { id: '00000000-0000-4000-8000-000000000001', name: 'Nico', photoDataUrl: null };
  rig.save.mockReset().mockResolvedValue(undefined);
  rig.pick.mockReset().mockResolvedValue(photo);
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = null;
  vi.unstubAllGlobals();
});

it('trims and saves the name without sending an untouched photo, and Cancel discards edits', async () => {
  await edit();
  await act(async () => field().props.onChangeText('  Nicholas  '));
  await press('Save profile');
  expect(rig.save).toHaveBeenCalledExactlyOnceWith({ name: 'Nicholas' });
  await press('Edit profile');
  await act(async () => field().props.onChangeText('Cancelled'));
  await press('Cancel');
  expect(rig.save).toHaveBeenCalledTimes(1);
  expect(text()).toContain('Nico');
});

it('previews a picked photo, saves it only on Save, and supports removing it', async () => {
  await edit();
  await press('Choose photo');
  expect(renderer!.root.findByType('avatar').props.photoDataUrl).toBe(photo);
  expect(rig.save).not.toHaveBeenCalled();
  await press('Save profile');
  expect(rig.save).toHaveBeenLastCalledWith({ photoDataUrl: photo });
  rig.profile = { ...rig.profile!, photoDataUrl: photo };
  await act(async () => renderer!.update(React.createElement(ProfileEditor, { email: null })));
  await press('Edit profile');
  await press('Remove photo');
  expect(renderer!.root.findByType('avatar').props.photoDataUrl).toBeNull();
  await press('Save profile');
  expect(rig.save).toHaveBeenLastCalledWith({ photoDataUrl: null });
});

it('canceling the picker keeps the previous photo and a failed save keeps the draft for retry', async () => {
  rig.profile = { ...rig.profile!, photoDataUrl: photo };
  rig.pick.mockResolvedValueOnce(null);
  await edit();
  await press('Change photo');
  expect(renderer!.root.findByType('avatar').props.photoDataUrl).toBe(photo);
  expect(button('Save profile').props.disabled).toBe(true);
  await act(async () => field().props.onChangeText('Unsaved name'));
  rig.save.mockRejectedValueOnce(new Error('No connection'));
  await press('Save profile');
  expect(field().props.value).toBe('Unsaved name');
  expect(text()).toContain('No connection');
  expect(renderer!.root.findByType('avatar').props.photoDataUrl).toBe(photo);
  await press('Save profile');
  expect(rig.save).toHaveBeenCalledTimes(2);
});

it('blocks blank names and duplicate save requests while a save is running', async () => {
  await edit();
  await act(async () => field().props.onChangeText('  '));
  expect(button('Save profile').props.disabled).toBe(true);
  await press('Save profile');
  expect(rig.save).not.toHaveBeenCalled();
  await act(async () => field().props.onChangeText('New name'));
  let finish!: () => void;
  rig.save.mockImplementationOnce(
    () =>
      new Promise<void>((done) => {
        finish = done;
      }),
  );
  await act(async () => {
    button('Save profile').props.onPress();
    button('Save profile').props.onPress();
  });
  expect(rig.save).toHaveBeenCalledTimes(1);
  expect(button('Cancel').props.disabled).toBe(true);
  await act(async () => finish());
});

it('keeps the editing baseline when another device refreshes the name while choosing a photo', async () => {
  await edit();
  await press('Choose photo');
  rig.profile = { ...rig.profile!, name: 'Changed on another device' };
  await act(async () => renderer!.update(React.createElement(ProfileEditor, { email: null })));
  expect(field().props.value).toBe('Nico');
  await press('Save profile');
  expect(rig.save).toHaveBeenCalledExactlyOnceWith({ photoDataUrl: photo });
});
