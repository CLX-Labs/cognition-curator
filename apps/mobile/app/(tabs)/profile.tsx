import React, { useEffect, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import {
  importResponseSchema,
  type ImportRequest,
  type ImportResponse,
} from '@recollect/contracts';
import { useStore } from '../../src/store';
import { api, ApiError } from '../../src/api';
import { Button, Panel, Screen, colors, reportError, s, Text } from '../../src/ui';
import { shareExistingFile, shareJSON } from '../../src/export';
import {
  exportLegacyStore,
  inspectLegacyStore,
  type LegacyExport,
  type LegacyInspection,
} from '../../modules/legacy-storage';
import { planMigration, type MigrationPlan } from '../../src/migration';
import type { LocalIssue } from '../../src/repository';
import ReleasePanel from '../../src/release-panel';
import ProfileEditor from '../../src/profile-editor';
import { BrandPattern } from '../../src/brand-patterns';
import PublicLinks from '../../src/public-links';
import { AIPermissionPanel, useAIConsent } from '../../src/ai-consent-ui';
import { AccountDeletionPanel } from '../../src/account-deletion';

type ImportWorkflow = {
  legacy: LegacyExport;
  plan: MigrationPlan;
  request: ImportRequest | null;
  result: ImportResponse | null;
};
const IMPORT_KEY = 'legacyImport';
export default function ProfileScreen() {
  const {
    session,
    data,
    repository,
    signOut,
    sync,
    syncState,
    syncError,
    widgetError,
    mutate,
    refresh,
  } = useStore();
  const [busy, setBusy] = useState<string | null>(null);
  const aiConsent = useAIConsent(repository);
  const [inspection, setInspection] = useState<LegacyInspection | null>(null);
  const [workflow, setWorkflow] = useState<ImportWorkflow | null>(null);
  const [migrationError, setMigrationError] = useState<string | null>(null);
  const [recoveryBackup, setRecoveryBackup] = useState<string | null>(null);
  const [freshAuthRequired, setFreshAuthRequired] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  useEffect(() => {
    let active = true;
    void inspectLegacyStore()
      .then((result) => {
        if (active) setInspection(result);
      })
      .catch((cause) => {
        if (active) reportError(cause);
      });
    if (repository)
      void repository
        .getState<ImportWorkflow>(IMPORT_KEY)
        .then((saved) => {
          if (active) setWorkflow(saved);
          if (active && saved) setRecoveryOpen(true);
        })
        .catch((cause) => {
          if (active) reportError(cause);
        });
    return () => {
      active = false;
    };
  }, [repository]);
  async function run(label: string, action: () => Promise<unknown>) {
    setBusy(label);
    try {
      await action();
    } catch (cause) {
      reportError(cause);
    } finally {
      setBusy(null);
    }
  }
  async function inspectAndExport() {
    if (!repository || !session) return;
    const legacy = await exportLegacyStore();
    if (legacy.status !== 'exported') {
      setMigrationError(legacy.message);
      setRecoveryBackup(legacy.backupFileUri ?? null);
      return;
    }
    const plan = planMigration(legacy, session.user.id, repository.newId());
    const next: ImportWorkflow = { legacy, plan, request: null, result: null };
    await repository.setState(IMPORT_KEY, next);
    setWorkflow(next);
    setMigrationError(null);
  }
  async function submitImport() {
    if (!repository || !workflow?.plan.request) return;
    setBusy('import');
    setMigrationError(null);
    try {
      const request = workflow.request ?? {
        ...workflow.plan.request,
        ownershipConfirmed: true,
      };
      const pending = { ...workflow, request };
      await repository.setState(IMPORT_KEY, pending);
      setWorkflow(pending);
      const result = importResponseSchema.parse(
        await api.request('/v1/imports', {
          method: 'POST',
          body: request,
          ownerId: repository.ownerId,
        }),
      );
      const complete = { ...pending, result };
      await repository.setState(IMPORT_KEY, complete);
      setWorkflow(complete);
      setFreshAuthRequired(false);
      await sync();
      await refresh();
    } catch (cause) {
      setMigrationError(
        cause instanceof Error
          ? cause.message
          : 'The import could not be completed. Your export and request are saved.',
      );
      if (
        cause instanceof ApiError &&
        (cause.code === 'reauthentication_required' ||
          cause.code === 'fresh_auth_required' ||
          cause.code === 'FRESH_AUTH_REQUIRED')
      )
        setFreshAuthRequired(true);
    } finally {
      setBusy(null);
    }
  }
  function confirmImport() {
    Alert.alert(
      'Is this your library?',
      'Import ' +
        workflow?.legacy.cards.length +
        ' cards into ' +
        (session?.user.email ?? session?.user.name ?? 'this signed-in account') +
        '? The device’s old account hints are not proof of ownership. Confirm only if these are your cards and you have reviewed the migration notes.',
      [
        { text: 'Review again', style: 'cancel' },
        { text: 'This is my library', onPress: () => void submitImport() },
      ],
    );
  }
  function resolve(issue: LocalIssue, action: 'server' | 'retry') {
    const title = action === 'server' ? 'Use the server version?' : 'Submit your version again?';
    const detail =
      action === 'server'
        ? 'This replaces the visible local version and its queued edits with the server version. A recovery copy of every replaced change remains in your export.'
        : 'This creates a new command based on the latest server version. The previous attempt stays in your recovery export. If another device changes the record again, you will be asked to resolve it.';
    Alert.alert(title, detail, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: action === 'server' ? 'Use server' : 'Retry my version',
        onPress: () =>
          void run('resolve', () => mutate((repo) => repo.resolveIssue(issue.id, action))),
      },
    ]);
  }
  return (
    <Screen
      title="You"
      eyebrow="04 / YOUR SPACE"
      action={<BrandPattern variant="weave" width={64} height={64} />}
      subtitle="Your account, library, and app updates."
    >
      <Panel>
        <ProfileEditor email={session?.user.email ?? null} />
        <View style={s.divider} />
        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={[s.sectionTitle, { fontSize: 26 }]}>{data.decks.length}</Text>
            <Text style={s.caption}>Decks in your library</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.sectionTitle, { fontSize: 26 }]}>{data.cards.length}</Text>
            <Text style={s.caption}>Cards to remember</Text>
          </View>
        </View>
      </Panel>
      <Panel>
        <Text style={s.sectionTitle}>Learn with friends</Text>
        <Text style={s.body}>
          Exchange decks and explore the recall history you choose to share.
        </Text>
        <Button
          title="Friends & shared decks"
          variant="secondary"
          size="compact"
          onPress={() => router.push('/friends')}
        />
      </Panel>
      <Panel>
        <Text style={s.sectionTitle}>Your marketplace</Text>
        <Text style={s.body}>
          Manage public decks and choose whether your downloaded cards contribute to broad practice
          trends.
        </Text>
        <Button
          title="Marketplace & publications"
          variant="secondary"
          size="compact"
          onPress={() => router.push('/marketplace')}
        />
        <Button
          title="Downloads & practice privacy"
          variant="ghost"
          size="compact"
          onPress={() => router.push('/marketplace/downloads')}
        />
      </Panel>
      <ReleasePanel />
      <AIPermissionPanel consent={aiConsent} settings />
      <Panel>
        <View style={s.between}>
          <Text style={s.sectionTitle}>Your library</Text>
          <View
            style={[
              s.pill,
              {
                backgroundColor: syncError || data.issues.length ? colors.pale : colors.yellow,
              },
            ]}
          >
            <Text
              style={[
                s.pillText,
                { color: syncError || data.issues.length ? colors.accent : colors.ink },
              ]}
            >
              {data.issues.length
                ? 'Needs attention'
                : syncState === 'offline'
                  ? 'Saved offline'
                  : data.pending
                    ? 'Sync pending'
                    : 'Up to date'}
            </Text>
          </View>
        </View>
        <Text style={s.body}>
          {data.pending
            ? data.pending + ' changes waiting to synchronize.'
            : syncState === 'idle'
              ? 'Your cards and reviews are saved on this device.'
              : 'Your cards remain available on this device.'}
        </Text>
        {!!widgetError && (
          <Text style={{ color: colors.danger, lineHeight: 22 }}>
            Widget refresh unavailable: {widgetError}
          </Text>
        )}
        {!!syncError && <Text style={{ color: colors.danger, lineHeight: 22 }}>{syncError}</Text>}
        <View style={[s.row, { alignItems: 'stretch' }]}>
          <View style={{ flex: 1 }}>
            <Button
              title="Sync now"
              size="compact"
              variant="secondary"
              loading={syncState === 'syncing'}
              disabled={busy !== null}
              onPress={() => void sync()}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              title="Export library"
              size="compact"
              variant="secondary"
              loading={busy === 'export'}
              disabled={busy !== null}
              onPress={() =>
                void run('export', async () => {
                  if (repository)
                    await shareJSON('recollect-library', await repository.exportData());
                })
              }
            />
          </View>
        </View>
        <Text style={s.caption}>Export a copy of your cards, reviews, and saved drafts.</Text>
      </Panel>
      {data.issues.length > 0 && (
        <>
          <Text style={s.sectionTitle}>Changes that need you</Text>
          {data.issues.map((issue) => {
            const operation = issue.operation;
            const content = operation.payload;
            return (
              <Panel key={issue.id}>
                <Text style={s.label}>{operation.type.replace('.', ' · ')}</Text>
                <Text style={s.body}>{issue.message}</Text>
                {'name' in content && <Text style={s.sectionTitle}>{content.name}</Text>}
                {'front' in content && (
                  <>
                    <Text style={s.label}>Your question</Text>
                    <Text style={s.body}>{content.front}</Text>
                    <Text style={s.label}>Your answer</Text>
                    <Text style={s.body}>{content.back}</Text>
                  </>
                )}
                {issue.canonical && (
                  <View
                    style={{
                      gap: 8,
                      padding: 14,
                      borderRadius: 12,
                      backgroundColor: colors.background,
                    }}
                  >
                    <Text style={s.label}>Server version</Text>
                    <Text style={s.body}>
                      {'name' in issue.canonical ? issue.canonical.name : issue.canonical.front}
                    </Text>
                    {'back' in issue.canonical && (
                      <Text style={s.body}>{issue.canonical.back}</Text>
                    )}
                    {!!issue.canonical.deletedAt && (
                      <Text style={s.caption}>Deleted on the server</Text>
                    )}
                  </View>
                )}
                <Button
                  title="Retry my version"
                  onPress={() => resolve(issue, 'retry')}
                  disabled={busy !== null}
                />
                <Button
                  title="Use server version & keep recovery copy"
                  variant="secondary"
                  onPress={() => resolve(issue, 'server')}
                  disabled={busy !== null}
                />
              </Panel>
            );
          })}
        </>
      )}
      <Panel>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: recoveryOpen }}
          accessibilityLabel="Recover your original library"
          onPress={() => setRecoveryOpen((open) => !open)}
          style={[s.between, { minHeight: 44 }]}
        >
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={s.sectionTitle}>Recover an old library</Text>
            <Text style={s.caption}>
              {workflow
                ? 'Your saved import is ready to review'
                : inspection?.status === 'found' || inspection?.status === 'needs_recovery'
                  ? 'An original iOS library was found'
                  : 'Bring cards over from the original app'}
            </Text>
          </View>
          <Text style={{ fontSize: 21, color: colors.muted }}>{recoveryOpen ? '−' : '+'}</Text>
        </Pressable>
        {recoveryOpen && (
          <>
            <Text style={s.body}>
              {inspection?.message ?? 'Checking for the original iOS library…'}
            </Text>
            <Text style={s.caption}>
              Recovery reads a protected copy of the original SwiftData store. It does not erase the
              original. You can export the copy and review ownership before any upload.
            </Text>
            <Text style={s.caption}>
              An approved import sends the cards and their non-secret recovery archive, including
              original reviews, preferences, and pending sync records, to your configured server.
            </Text>
            {(inspection?.status === 'found' || inspection?.status === 'needs_recovery') &&
              !workflow && (
                <Button
                  title="Prepare a local recovery copy"
                  loading={busy === 'recovery'}
                  onPress={() => void run('recovery', inspectAndExport)}
                />
              )}
            {!!migrationError && (
              <Text style={{ color: colors.danger, lineHeight: 22 }}>{migrationError}</Text>
            )}
            {!!recoveryBackup && (
              <Button
                title="Export preserved database snapshot"
                variant="secondary"
                onPress={() => void run('backup', () => shareExistingFile(recoveryBackup))}
              />
            )}
            {!!workflow && (
              <>
                <View style={s.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.metric}>{workflow.legacy.decks.length}</Text>
                    <Text style={s.caption}>ORIGINAL DECKS</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.metric}>{workflow.legacy.cards.length}</Text>
                    <Text style={s.caption}>ORIGINAL CARDS</Text>
                  </View>
                </View>
                <Button
                  title="Export original library as JSON"
                  variant="secondary"
                  onPress={() =>
                    void run('legacy-export', () =>
                      shareExistingFile(workflow.legacy.manifest.exportFileUri),
                    )
                  }
                />
                <Button
                  title="Export protected database snapshot"
                  variant="secondary"
                  onPress={() =>
                    void run('legacy-backup', () =>
                      shareExistingFile(workflow.legacy.manifest.backupFileUri),
                    )
                  }
                />
                {workflow.plan.notes.map((note, index) => (
                  <Text key={index} style={s.caption}>
                    • {note}
                  </Text>
                ))}
                {workflow.plan.problems.map((problem, index) => (
                  <Text key={index} style={{ color: colors.danger, lineHeight: 21 }}>
                    • {problem}
                  </Text>
                ))}
                {!workflow.result && workflow.plan.request && (
                  <Button
                    title={
                      workflow.request ? 'Retry the saved import' : 'Review ownership & import'
                    }
                    loading={busy === 'import'}
                    disabled={busy !== null && busy !== 'import'}
                    onPress={() => (workflow.request ? void submitImport() : confirmImport())}
                  />
                )}
                {!workflow.plan.request && (
                  <Text style={s.body}>
                    The source is preserved. Resolve these account or data issues before importing;
                    this screen will not guess, discard records, or clamp your schedule.
                  </Text>
                )}
                {!workflow.request && !workflow.result && (
                  <Button
                    title="Recheck the original library"
                    variant="secondary"
                    disabled={busy !== null}
                    onPress={() =>
                      void run('recheck', async () => {
                        if (repository)
                          await repository.archive({ previousMigrationPlan: workflow });
                        await inspectAndExport();
                      })
                    }
                  />
                )}
                {freshAuthRequired && (
                  <Button
                    title="Confirm your Apple sign-in again"
                    variant="secondary"
                    onPress={() =>
                      void run('reauth', async () => {
                        await api.signInApple();
                        setFreshAuthRequired(false);
                      })
                    }
                  />
                )}
                {!!workflow.result && (
                  <>
                    <Text style={s.sectionTitle}>
                      {workflow.result.conflicts.length
                        ? 'Imported with records to reconcile'
                        : 'Import recorded by the server'}
                    </Text>
                    <Text style={s.body}>
                      {workflow.result.importedDeckIds.length} decks and{' '}
                      {workflow.result.importedCardIds.length} cards imported.{' '}
                      {workflow.result.conflicts.length} existing records were preserved without
                      overwrite.
                    </Text>
                    {workflow.result.conflicts.map((conflict) => (
                      <Text
                        key={conflict.entity + conflict.id}
                        style={{ color: colors.danger, lineHeight: 21 }}
                      >
                        {conflict.entity} {conflict.id}: {conflict.reason}
                      </Text>
                    ))}
                    <Text style={s.caption}>
                      Your original files and complete migration receipt remain available here and
                      in your export. Synchronize to load the imported cards.
                    </Text>
                  </>
                )}
              </>
            )}
          </>
        )}
      </Panel>
      <Text style={s.caption}>
        Cards and practice work offline. Connect to generate suggestions and sync between devices.
      </Text>
      <PublicLinks />
      <AccountDeletionPanel />
      <Button
        title="Sign out"
        size="compact"
        variant="ghost"
        disabled={busy !== null}
        onPress={() =>
          Alert.alert(
            'Sign out of this account?',
            data.pending
              ? 'Your pending changes remain on this device. Sign back into this same account to synchronize them.'
              : 'Your local library stays on this device, isolated from other accounts.',
            [
              { text: 'Stay signed in', style: 'cancel' },
              {
                text: 'Sign out',
                style: 'destructive',
                onPress: () => void run('signout', signOut),
              },
            ],
          )
        }
      />
    </Screen>
  );
}
