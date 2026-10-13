import React, { useEffect, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { api, developmentAuthEnabled } from './api';
import { Button, Field, Panel, Screen, colors, reportError, s } from './ui';
import { ReleaseStamp } from './release-panel';

export default function Login() {
  const [available, setAvailable] = useState(false);
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
    <Screen>
      <ReleaseStamp />
      <View style={{ paddingTop: 36, gap: 18 }}>
        <View
          style={{
            width: 68,
            height: 68,
            backgroundColor: colors.ink,
            borderRadius: 22,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 36, color: colors.green }}>r.</Text>
        </View>
        <Text style={s.eyebrow}>RECOLLECT AI</Text>
        <Text style={[s.title, { fontSize: 48, lineHeight: 52 }]}>
          A little practice.{'\n'}A lasting memory.
        </Text>
        <Text style={[s.body, { fontSize: 17, lineHeight: 26 }]}>
          Turn what you want to know into cards you actually remember.
        </Text>
      </View>
      <Panel tint>
        <Text style={s.sectionTitle}>Your knowledge, growing.</Text>
        <Text style={s.body}>
          Create a deck. Make your own cards or draft them with AI. Review a few at a time,
          even offline.
        </Text>
        <View style={s.row}>
          <View style={s.pill}>
            <Text style={s.pillText}>SMALL DAILY SESSIONS</Text>
          </View>
        </View>
      </Panel>
      <View style={{ gap: 12, marginTop: 10 }}>
        {available ? (
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
            cornerRadius={15}
            style={{ width: '100%', height: 56, opacity: busy ? 0.5 : 1 }}
            onPress={() => {
              if (!busy) void signIn();
            }}
          />
        ) : (
          <Text style={s.body}>
            {Platform.OS === 'ios'
              ? 'Sign in with Apple is not available on this device.'
              : 'The first release uses Sign in with Apple on iPhone and iPad.'}
          </Text>
        )}
        <Text style={[s.caption, { textAlign: 'center' }]}>
          Your library stays separate from other accounts on this device.
        </Text>
      </View>
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
    </Screen>
  );
}
