import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Platform, View } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { api, developmentAuthEnabled } from './api';
import { BrandHeader, Button, Field, Panel, Screen, colors, reportError, s, Text } from './ui';
import { ReleaseStamp } from './release-panel';

export default function Login() {
  const [available, setAvailable] = useState<boolean | null>(Platform.OS === 'ios' ? null : false);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  useEffect(() => {
    let active = true;
    if (Platform.OS === 'ios')
      void AppleAuthentication.isAvailableAsync()
        .then((value) => {
          if (active) setAvailable(value);
        })
        .catch(() => {
          if (active) setAvailable(false);
        });
    return () => {
      active = false;
    };
  }, []);
  async function signIn(development = false) {
    setBusy(true);
    try {
      if (development) await api.signInDevelopment(email.trim());
      else await api.signInApple();
    } catch (error) {
      if ((error as { code?: string }).code !== 'ERR_REQUEST_CANCELED') reportError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen
      leading={<BrandHeader />}
      footer={
        <View style={{ gap: 10 }}>
          {available ? (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
              buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
              cornerRadius={8}
              style={{ width: '100%', height: 56, opacity: busy ? 0.5 : 1 }}
              onPress={() => {
                if (!busy) void signIn();
              }}
            />
          ) : available === null ? (
            <View style={[s.row, { justifyContent: 'center', minHeight: 56 }]}>
              <ActivityIndicator color={colors.ink} />
              <Text style={s.caption}>Getting sign-in ready…</Text>
            </View>
          ) : (
            <Text style={s.body}>
              {Platform.OS === 'ios'
                ? 'Sign in with Apple is not available on this device.'
                : 'Continue on iPhone or iPad with Sign in with Apple.'}
            </Text>
          )}
          <Text style={[s.caption, { textAlign: 'center' }]}>
            {busy ? 'Signing in…' : 'Your library, saved to your account.'}
          </Text>
        </View>
      }
    >
      <View style={{ paddingTop: 10, gap: 24 }}>
        <View>
          <Text style={[s.title, { fontSize: 48, lineHeight: 52 }]}>FOR THE</Text>
          <Text style={[s.editorial, { fontSize: 80, lineHeight: 88, marginTop: -4 }]}>
            curious.
          </Text>
          <Text style={[s.body, { fontSize: 17, lineHeight: 26 }]}>
            Keep what catches your mind. Turn it into cards. Make a little more of it stay.
          </Text>
        </View>
        <View style={{ backgroundColor: colors.lilac, borderRadius: 8, padding: 12 }}>
          <Image
            source={require('../../landing/assets/curiosity-sculpture.png')}
            accessible={false}
            resizeMode="contain"
            style={{ width: '100%', height: 210 }}
          />
          <Text style={[s.eyebrow, { color: colors.ink, marginBottom: 0 }]}>
            OBJECTS OF CURIOSITY / NO. 001
          </Text>
        </View>
      </View>
      <Panel
        style={{
          gap: 24,
          backgroundColor: 'transparent',
          paddingHorizontal: 0,
          borderWidth: 0,
          borderTopWidth: 1,
          borderRadius: 0,
        }}
      >
        {[
          ['01', 'Make it yours', 'Write a card or turn any subject into a deck with AI.'],
          ['02', 'Keep it fresh', 'Practice a few cards at a time, even when you are offline.'],
        ].map(([number, title, detail]) => (
          <View key={number} style={[s.row, { alignItems: 'flex-start', gap: 14 }]}>
            <View
              style={{
                width: 36,
                height: 36,
                borderRadius: 12,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.yellow,
              }}
            >
              <Text style={[s.label, { fontSize: 12 }]}>{number}</Text>
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[s.label, { fontSize: 17, lineHeight: 23 }]}>{title}</Text>
              <Text style={s.body}>{detail}</Text>
            </View>
          </View>
        ))}
      </Panel>
      {developmentAuthEnabled && (
        <Panel>
          <Text style={s.label}>Development environment</Text>
          <Field
            label="Test account email"
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <Button
            title="Sign in to development"
            variant="secondary"
            loading={busy}
            disabled={!email.includes('@')}
            onPress={() => void signIn(true)}
          />
        </Panel>
      )}
      <ReleaseStamp />
    </Screen>
  );
}
