import React, { useRef, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { Button, Panel, colors, s } from './ui';
import { release, releaseLabel } from './release';
import { useAppUpdates } from './app-updates';

export function ReleaseStamp() {
  return (
    <Text selectable style={s.caption}>
      Release · {releaseLabel(release.id, __DEV__, release.version)}
    </Text>
  );
}

export default function ReleasePanel() {
  const {
    currentlyRunning,
    pending,
    isChecking,
    isDownloading,
    enabled,
    check: checkUpdate,
    restart: applyUpdate,
    restarting,
  } = useAppUpdates();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const inFlight = useRef(false);
  const development = Platform.OS === 'web' || __DEV__;
  // The installed binary's number is independent of the changeable OTA manifest.
  const build =
    Constants.platform?.ios?.buildNumber ?? Constants.platform?.android?.versionCode;
  async function check() {
    if (!enabled || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await checkUpdate();
      setMessage(
        result === 'ready'
          ? 'Your update is ready. Restart to use the new version.'
          : result === 'none'
            ? 'You’re up to date for this build. New native releases appear in TestFlight.'
            : 'The update could not be downloaded. Try again when connected.',
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not check for updates. Your running version is unchanged.',
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function restart() {
    if (!enabled || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await applyUpdate();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not restart. Close and reopen the app to apply the update.',
      );
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <Panel>
      <View style={s.between}>
        <Text style={s.sectionTitle}>App version</Text>
        {pending && (
          <View style={s.pill}>
            <Text style={s.pillText}>Update ready</Text>
          </View>
        )}
      </View>
      <Text selectable style={[s.label, { fontSize: 18, lineHeight: 26 }]}>
        {releaseLabel(release.id, development, release.version)}
      </Text>
      {release.commit && (
        <Text selectable style={s.caption}>
          Commit {release.commit.slice(0, 7)}
        </Text>
      )}
      {currentlyRunning.isEmergencyLaunch && (
        <Text style={{ color: colors.danger }}>
          An update failed to start. The app has returned to its built-in version.
        </Text>
      )}
      {message && <Text style={s.body}>{message}</Text>}
      {error && <Text style={{ color: colors.danger }}>{error}</Text>}
      {enabled ? (
        pending ? (
          <Button
            title="Restart to apply update"
            size="compact"
            loading={busy || restarting}
            onPress={() => void restart()}
          />
        ) : (
          <Button
            title="Check for updates"
            variant="secondary"
            size="compact"
            loading={busy || isChecking || isDownloading}
            onPress={() => void check()}
          />
        )
      ) : (
        <Text style={s.caption}>
          App updates are available in your installed TestFlight build.
        </Text>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: detailsOpen }}
        accessibilityLabel="Build details"
        onPress={() => setDetailsOpen((open) => !open)}
        style={[s.between, { minHeight: 44 }]}
      >
        <Text style={s.caption}>Build details</Text>
        <Text style={{ color: colors.muted }}>{detailsOpen ? '−' : '+'}</Text>
      </Pressable>
      {detailsOpen && (
        <View style={{ gap: 6 }}>
          <Text style={s.caption}>
            Native {Constants.expoConfig?.version ?? 'unknown'} ·{' '}
            {currentlyRunning.channel === 'testflight' ? 'TestFlight build' : 'Build'}{' '}
            {build ?? (development ? 'development' : 'unknown')}
          </Text>
          <Text style={s.caption}>
            {development
              ? 'Development preview'
              : !Updates.isEnabled || currentlyRunning.isEmbeddedLaunch
                ? 'Included in this build'
                : 'Running an OTA update'}
            {currentlyRunning.channel ? ' · ' + currentlyRunning.channel : ''}
          </Text>
          {currentlyRunning.updateId && (
            <Text selectable style={s.caption}>
              Update {currentlyRunning.updateId}
            </Text>
          )}
        </View>
      )}
    </Panel>
  );
}
