import React, { useRef, useState } from 'react';
import { Platform, Text } from 'react-native';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { Button, Panel, colors, s } from './ui';
import { downloadCompatibleUpdate, release, releaseLabel } from './release';

export function ReleaseStamp() {
  return (
    <Text selectable style={s.caption}>
      Release · {releaseLabel(release.id, __DEV__, release.version)}
    </Text>
  );
}

export default function ReleasePanel() {
  const { currentlyRunning, isUpdatePending, isChecking, isDownloading } =
    Updates.useUpdates();
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const development = Platform.OS === 'web' || __DEV__;
  const enabled = !development && Updates.isEnabled;
  // The installed binary's number is independent of the changeable OTA manifest.
  const build =
    Constants.platform?.ios?.buildNumber ?? Constants.platform?.android?.versionCode;
  const pending = ready || isUpdatePending;
  async function check() {
    if (!enabled || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await downloadCompatibleUpdate(Updates);
      setReady(result === 'ready');
      setMessage(
        result === 'ready'
          ? 'Update downloaded. Restart to run it; the release label changes after restart.'
          : result === 'none'
            ? 'No OTA update is available for this build. For a newer native release, update through TestFlight.'
            : 'The update was not downloaded. Your running version is unchanged; try again.',
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
      await Updates.reloadAsync();
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
      <Text style={s.sectionTitle}>App version</Text>
      <Text selectable style={s.label}>
        {releaseLabel(release.id, development, release.version)}
      </Text>
      <Text style={s.body}>
        Native {Constants.expoConfig?.version ?? 'unknown'} ·{' '}
        {currentlyRunning.channel === 'testflight' ? 'TestFlight build' : 'Build'}{' '}
        {build ?? (development ? 'development' : 'unknown')}
      </Text>
      <Text style={s.caption}>
        {development
          ? 'Development preview'
          : !Updates.isEnabled || currentlyRunning.isEmbeddedLaunch
            ? 'Running the version included in this build'
            : 'Running an OTA update'}
        {currentlyRunning.channel ? ' · ' + currentlyRunning.channel : ''}
      </Text>
      {release.commit && (
        <Text selectable style={s.caption}>
          Commit {release.commit.slice(0, 7)}
        </Text>
      )}
      {currentlyRunning.updateId && (
        <Text selectable style={s.caption}>
          Update {currentlyRunning.updateId}
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
            loading={busy}
            onPress={() => void restart()}
          />
        ) : (
          <Button
            title="Check for updates"
            variant="secondary"
            loading={busy || isChecking || isDownloading}
            onPress={() => void check()}
          />
        )
      ) : (
        <Text style={s.caption}>OTA checks are available in installed release builds.</Text>
      )}
    </Panel>
  );
}
