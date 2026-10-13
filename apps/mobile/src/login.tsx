import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Text, View } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { api, developmentAuthEnabled } from './api';
import { Button, Field, Panel, Screen, colors, reportError, s } from './ui';
import { ReleaseStamp } from './release-panel';

export default function Login() {
  const [available, setAvailable] = useState<boolean | null>(
    Platform.OS === 'ios' ? null : false,
  );
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
      footer={
        <View style={{ gap: 10 }}>
          {available ? (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
              buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
              cornerRadius={16}
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
      <View style={{ paddingTop: 20, gap: 20 }}>
        <View
          style={{
            width: 62,
            height: 62,
            backgroundColor: colors.ink,
            borderRadius: 22,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 36, color: colors.green }}>r.</Text>
        </View>
        <View style={{ gap: 10 }}>
          <Text style={s.eyebrow}>RECOLLECT AI</Text>
          <Text style={[s.title, { fontSize: 39, lineHeight: 45 }]}>
            Learn a little.{'\n'}Remember more.
          </Text>
          <Text style={[s.body, { fontSize: 17, lineHeight: 26 }]}>
            A home for what you want to know, and a simple way to keep it with you.
          </Text>
        </View>
      </View>
      <Panel style={{ marginTop: 8, gap: 20 }}>
        {[
          ['01', 'Make it yours', 'Write a card or turn any subject into a deck with AI.'],
          [
            '02',
            'Keep it fresh',
            'Practice a few cards at a time, even when you are offline.',
          ],
        ].map(([number, title, detail]) => (
          <View key={number} style={[s.row, { alignItems: 'flex-start', gap: 14 }]}>
            <View
              style={{
                width: 36,
                height: 36,
                borderRadius: 12,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.green,
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
