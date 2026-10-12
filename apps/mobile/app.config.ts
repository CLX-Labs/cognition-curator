import type { ConfigContext, ExpoConfig } from 'expo/config';
import { readFileSync } from 'node:fs';

// The evaluated version belongs in the fingerprint; importing this JSON as a
// module would also fingerprint the new file and invalidate existing binaries.
const nativeVersion = JSON.parse(readFileSync(`${__dirname}/native-version.json`, 'utf8')) as {
  version: string;
};

const easProjectId =
  process.env.EXPO_PUBLIC_EAS_PROJECT_ID || '2d6f42f7-8c17-4f27-9c69-7ce868abdb74';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Recollect AI',
  slug: 'recollect-ai',
  owner: 'collectsoftware',
  version: nativeVersion.version,
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
  ...(easProjectId
    ? {
        updates: { url: `https://u.expo.dev/${easProjectId}` },
        extra: { eas: { projectId: easProjectId } },
      }
    : {}),
});
