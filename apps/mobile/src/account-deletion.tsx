import React, { useState } from 'react';
import { View } from 'react-native';
import { useStore } from './store';
import { shareJSON } from './export';
import { Button, Field, Panel, Screen, Text, colors, s } from './ui';
import PublicLinks from './public-links';

export function AccountDeletionPanel() {
  const { session, repository, data, requestAccountDeletion, deletionBusy } = useStore();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  async function exportFirst() {
    if (!repository || exporting) return;
    setExporting(true);
    setError(null);
    try {
      await shareJSON('recollect-before-deletion', await repository.exportData());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The export could not finish.');
    } finally {
      setExporting(false);
    }
  }
  async function submit() {
    if (!session || confirmation !== 'DELETE' || deletionBusy) return;
    setError(null);
    try {
      await requestAccountDeletion(session.user.id);
    } catch (cause) {
      if ((cause as { code?: string }).code !== 'ERR_REQUEST_CANCELED')
        setError(cause instanceof Error ? cause.message : 'The request could not be confirmed.');
    }
  }
  return (
    <Panel>
      <Text style={s.sectionTitle}>Delete your account</Text>
      {!open ? (
        <Button
          title="Delete account…"
          variant="ghost"
          size="compact"
          onPress={() => setOpen(true)}
        />
      ) : (
        <>
          <Text style={s.body}>
            Request permanent deletion of this Recollect account and its library. Access is disabled
            when the server accepts the request. Friends lose shared recall access; independent deck
            copies they already imported remain theirs.
          </Text>
          <Text style={s.caption}>
            After acceptance, this signed-in account’s current cards, drafts, profile cache and
            widget data are removed from this device. Permanent server deletion may remain pending
            while it is processed. This cannot be undone.
          </Text>
          <Text style={s.caption}>
            Files you exported and original legacy recovery stores are separate. They are not
            automatically erased because they may contain another account’s data. Contact support if
            you need help removing them.
          </Text>
          {!!data.pending && (
            <Text style={[s.body, { color: colors.danger }]}>
              {data.pending} unsynced changes will be removed from this device. Export a copy before
              continuing if you want to keep them.
            </Text>
          )}
          <Button
            title="Export my library first"
            variant="secondary"
            size="compact"
            loading={exporting}
            disabled={deletionBusy || exporting}
            onPress={() => void exportFirst()}
          />
          <Field
            label="Type DELETE to confirm"
            value={confirmation}
            onChangeText={setConfirmation}
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!deletionBusy}
            maxLength={6}
          />
          {!!error && (
            <Text accessibilityRole="alert" style={[s.body, { color: colors.danger }]}>
              {error}
            </Text>
          )}
          <Button
            title="Confirm with Apple & request deletion"
            variant="danger"
            size="compact"
            loading={deletionBusy}
            disabled={confirmation !== 'DELETE' || deletionBusy || exporting}
            onPress={() => void submit()}
          />
          <Button
            title="Keep my account"
            variant="ghost"
            size="compact"
            disabled={deletionBusy}
            onPress={() => {
              setOpen(false);
              setConfirmation('');
              setError(null);
            }}
          />
        </>
      )}
    </Panel>
  );
}

export function AccountDeletionRecoveryScreen() {
  const {
    deletionRecovery: record,
    deletionError,
    deletionBusy,
    retryAccountDeletion,
  } = useStore();
  if (!record) return null;
  const receipt = record.receipt;
  return (
    <Screen
      title={receipt ? 'Deletion request received' : 'Check your deletion request'}
      eyebrow="YOUR ACCOUNT"
      syncFeedback="errors"
    >
      <Panel>
        <Text style={s.body}>
          {receipt
            ? receipt.status === 'completed'
              ? 'The server confirmed permanent account deletion. Finish removing its data from this device.'
              : 'Your account is disabled and permanent deletion is pending. We are removing its data from this device.'
            : 'The connection ended before the deletion request could be confirmed. Confirm with Apple to safely check or retry the same request. This screen will not guess whether deletion completed.'}
        </Text>
        {!!deletionError && (
          <Text accessibilityRole="alert" style={[s.body, { color: colors.danger }]}>
            {deletionError}
          </Text>
        )}
        <Button
          title={receipt ? 'Finish removing local data' : 'Confirm with Apple & check request'}
          loading={deletionBusy}
          disabled={deletionBusy}
          onPress={() => void retryAccountDeletion()}
        />
        <Text selectable style={s.caption}>
          Request reference: {record.receipt?.requestId ?? record.operationId}
        </Text>
        <Text style={s.caption}>
          Your other accounts and their local libraries are not removed.
        </Text>
      </Panel>
      <PublicLinks />
    </Screen>
  );
}

export function DeletionReceiptNotice() {
  const {
    deletionRecovery: record,
    deletionError,
    deletionBusy,
    retryAccountDeletion,
  } = useStore();
  if (!record?.receipt || !record.localCleared) return null;
  const receipt = record.receipt;
  return (
    <Panel>
      <Text style={s.sectionTitle}>
        {receipt.status === 'completed' ? 'Your account was deleted' : 'Account deletion requested'}
      </Text>
      <Text style={s.body}>
        {receipt.status === 'completed'
          ? 'Permanent server deletion is complete. Its current Recollect library, sign-in and widget data were removed from this device.'
          : 'Your account is disabled. Its current Recollect library, sign-in and widget data were removed from this device. Permanent server deletion is still pending.'}
      </Text>
      <Text style={s.caption}>
        User-exported files and original legacy recovery stores are separate and may remain on this
        device. Support can help with those files.
      </Text>
      {receipt.status === 'pending' && (
        <>
          <Text style={s.caption}>
            {receipt.actionRequired === 'contact_support'
              ? 'Support needs to help finish this request. Use the support link below and include your request reference.'
              : receipt.actionRequired === 'reauthenticate'
                ? 'Confirm with Apple again to help finish deletion of your Sign in with Apple connection.'
                : 'The server will process this request. You can check its status with Apple.'}
          </Text>
          {receipt.estimatedCompletionDays !== null && (
            <Text style={s.caption}>
              Estimated completion: within {receipt.estimatedCompletionDays} days.
            </Text>
          )}
          <Button
            title="Check deletion status with Apple"
            variant="secondary"
            size="compact"
            loading={deletionBusy}
            disabled={deletionBusy}
            onPress={() => void retryAccountDeletion()}
          />
        </>
      )}
      {!!deletionError && (
        <Text accessibilityRole="alert" style={[s.caption, { color: colors.danger }]}>
          {deletionError}
        </Text>
      )}
      <Text selectable style={s.caption}>
        Request reference: {record.receipt.requestId}
      </Text>
    </Panel>
  );
}
