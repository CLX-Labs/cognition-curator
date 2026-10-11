import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Recollect AI',
  slug: 'recollect-ai',
  version: '2.0.0',
  icon: './assets/icon.png',
  backgroundColor: '#F7F5F0',
  orientation: 'portrait',
  scheme: 'cognitioncurator',
  userInterfaceStyle: 'light',
  platforms: ['ios', 'android'],
  ios: {
    bundleIdentifier: 'collect.software.cognition-curator',
    appleTeamId: 'KF8643NB33',
    supportsTablet: true,
    usesAppleSignIn: true,
    entitlements: {
      'com.apple.security.application-groups': ['group.collect.software.cognition-curator'],
    },
    infoPlist: { ITSAppUsesNonExemptEncryption: false },
  },
  android: { package: 'collect.software.cognitioncurator' },
  plugins: [
    'expo-router',
    'expo-apple-authentication',
    'expo-secure-store',
    'expo-sqlite',
    [
      'expo-splash-screen',
      {
        image: './assets/icon.png',
        imageWidth: 160,
        resizeMode: 'contain',
        backgroundColor: '#F7F5F0',
      },
    ],
    ['expo-build-properties', { ios: { deploymentTarget: '18.4' } }],
    './plugins/withRecollectWidget.cjs',
  ],
  runtimeVersion: { policy: 'fingerprint' },
  ...(process.env.EXPO_PUBLIC_EAS_PROJECT_ID
    ? {
        updates: { url: `https://u.expo.dev/${process.env.EXPO_PUBLIC_EAS_PROJECT_ID}` },
        extra: { eas: { projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID } },
      }
    : {}),
});
