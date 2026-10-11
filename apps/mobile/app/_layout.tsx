import React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StoreProvider, useStore } from '../src/store';
import Login from '../src/login';
import { colors, s } from '../src/ui';

function AppNavigation() {
  const { ready, session, initializationError, repository } = useStore();
  if (!ready)
    return (
      <View style={[s.safe, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={colors.ink} />
      </View>
    );
  if (initializationError)
    return (
      <View style={[s.safe, { padding: 32, justifyContent: 'center', gap: 14 }]}>
        <Text style={s.sectionTitle}>Your library needs attention</Text>
        <Text style={s.body}>{initializationError}</Text>
        <Text style={s.body}>
          Your stored data has been preserved. Close and reopen the app to retry.
        </Text>
      </View>
    );
  if (!session) return <Login />;
  if (!repository)
    return (
      <View style={[s.safe, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={colors.ink} />
        <Text style={s.body}>Opening your library…</Text>
      </View>
    );
  return (
    <Stack
      key={session.user.id}
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}
    />
  );
}
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StoreProvider>
        <StatusBar style="dark" />
        <AppNavigation />
      </StoreProvider>
    </SafeAreaProvider>
  );
}
