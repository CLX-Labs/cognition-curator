import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { StoreProvider, useStore } from '../src/store';
import Login from '../src/login';
import { colors, s, Text } from '../src/ui';
import { AppUpdateProvider, UpdateNotice } from '../src/app-updates';
import { TypographyContext } from '../src/brand';
import manropeRegular from '../assets/fonts/Manrope-Regular.ttf';
import manropeSemibold from '../assets/fonts/Manrope-SemiBold.ttf';
import manropeBold from '../assets/fonts/Manrope-Bold.ttf';
import manropeExtraBold from '../assets/fonts/Manrope-ExtraBold.ttf';
import instrumentSerifItalic from '../assets/fonts/InstrumentSerif-Italic.ttf';

const brandFonts = {
  'Manrope-Regular': manropeRegular,
  'Manrope-SemiBold': manropeSemibold,
  'Manrope-Bold': manropeBold,
  'Manrope-ExtraBold': manropeExtraBold,
  'InstrumentSerif-Italic': instrumentSerifItalic,
};

export const unstable_settings = { initialRouteName: '(tabs)' };

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
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="(tabs)" />
    </Stack>
  );
}
export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(brandFonts);
  return (
    <SafeAreaProvider>
      <TypographyContext.Provider value={fontsLoaded}>
        <StoreProvider>
          <AppUpdateProvider>
            <StatusBar style="dark" />
            <View style={{ flex: 1 }}>
              {fontsLoaded || fontError ? (
                <AppNavigation />
              ) : (
                <View style={[s.safe, { alignItems: 'center', justifyContent: 'center' }]}>
                  <ActivityIndicator color={colors.accent} />
                </View>
              )}
              <UpdateNotice />
            </View>
          </AppUpdateProvider>
        </StoreProvider>
      </TypographyContext.Provider>
    </SafeAreaProvider>
  );
}
