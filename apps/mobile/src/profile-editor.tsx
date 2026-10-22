import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { Profile, ProfileUpdate } from '@recollect/contracts';
import { useProfile } from './profile';
import { chooseProfilePhoto } from './profile-photo';
import Avatar from './avatar';
import { Button, Field, Text, colors, s } from './ui';

export default function ProfileEditor({ email }: { email: string | null }) {
  const { profile, loading, error, refresh, save } = useProfile();
  const [editing, setEditing] = useState(false);
  useFocusEffect(
    useCallback(() => {
      void refresh(true);
    }, [refresh]),
  );
  return (
    <View style={{ gap: 16 }}>
      {editing ? (
        <EditProfile
          key={profile.id}
          initial={profile}
          save={save}
          close={() => setEditing(false)}
        />
      ) : (
        <>
          <View style={s.row}>
            <Avatar name={profile.name} photoDataUrl={profile.photoDataUrl} size={64} />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={s.sectionTitle}>{profile.name}</Text>
              <Text selectable style={s.caption}>
                {email ?? 'Signed in with Apple'}
              </Text>
            </View>
          </View>
          <Button
            title="Edit profile"
            variant="secondary"
            size="compact"
            onPress={() => setEditing(true)}
            disabled={loading}
          />
          {!!error && <Text style={s.caption}>{error}</Text>}
        </>
      )}
    </View>
  );
}

function EditProfile({
  initial,
  save,
  close,
}: {
  initial: Profile;
  save(patch: ProfileUpdate): Promise<void>;
  close(): void;
}) {
  const [baseline] = useState(initial);
  const [name, setName] = useState(baseline.name);
  const [photo, setPhoto] = useState(baseline.photoDataUrl);
  const [busy, setBusy] = useState<'photo' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const trimmed = name.trim();
  const dirty = trimmed !== baseline.name || photo !== baseline.photoDataUrl;
  async function pickPhoto() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy('photo');
    setError(null);
    try {
      const chosen = await chooseProfilePhoto();
      if (mounted.current && chosen) setPhoto(chosen);
    } catch (cause) {
      if (mounted.current)
        setError(
          cause instanceof Error
            ? cause.message
            : 'This photo could not be opened. Try another image.',
        );
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(null);
    }
  }
  async function submit() {
    if (inFlight.current || !dirty || !trimmed) return;
    inFlight.current = true;
    setBusy('save');
    setError(null);
    try {
      await save({
        ...(trimmed !== baseline.name ? { name: trimmed } : {}),
        ...(photo !== baseline.photoDataUrl ? { photoDataUrl: photo } : {}),
      });
      if (mounted.current) close();
    } catch (cause) {
      if (mounted.current)
        setError(
          cause instanceof Error ? cause.message : 'Your profile could not save. Try again.',
        );
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(null);
    }
  }
  return (
    <View style={{ gap: 18 }}>
      <Text style={s.eyebrow}>MAKE IT YOURS</Text>
      <View style={[s.row, { gap: 18 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Change profile photo"
          disabled={busy !== null}
          onPress={() => void pickPhoto()}
        >
          <Avatar name={name} photoDataUrl={photo} size={88} />
        </Pressable>
        <View style={{ flex: 1, gap: 8 }}>
          <Button
            title={photo ? 'Change photo' : 'Choose photo'}
            variant="secondary"
            size="compact"
            onPress={() => void pickPhoto()}
            loading={busy === 'photo'}
            disabled={busy !== null}
          />
          {!!photo && (
            <Button
              title="Remove photo"
              variant="ghost"
              size="compact"
              disabled={busy !== null}
              onPress={() => setPhoto(null)}
            />
          )}
        </View>
      </View>
      <Field
        label="Your name"
        value={name}
        onChangeText={setName}
        placeholder="What should we call you?"
        maxLength={100}
        autoCapitalize="words"
        autoComplete="name"
        textContentType="name"
        editable={busy === null}
        returnKeyType="done"
        onSubmitEditing={() => void submit()}
      />
      <Text style={s.caption}>Your name and photo are saved to your Recollect account.</Text>
      {!!error && (
        <Text accessibilityRole="alert" style={[s.body, { color: colors.danger }]}>
          {error}
        </Text>
      )}
      <View style={s.row}>
        <View style={{ flex: 1 }}>
          <Button title="Cancel" variant="secondary" disabled={busy !== null} onPress={close} />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            title="Save profile"
            loading={busy === 'save'}
            disabled={busy !== null || !dirty || !trimmed}
            onPress={() => void submit()}
          />
        </View>
      </View>
    </View>
  );
}
