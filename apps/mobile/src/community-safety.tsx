import React, { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { blockedUsersSchema, contentReportReceiptSchema } from '@recollect/contracts';
import { api } from './api';
import { useCommunityResource } from './community-api';
import { Button, Field, Panel, Text, colors, s } from './ui';
import { CommunityFeedback } from './deck-sharing';

const reasons = [
  ['inappropriate', 'Inappropriate content'],
  ['harassment', 'Harassment'],
  ['spam', 'Spam'],
  ['other', 'Something else'],
] as const;
export function FriendSafety({
  userId,
  name,
  shareId,
}: {
  userId: string;
  name: string;
  shareId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<(typeof reasons)[number][0]>('inappropriate');
  const [details, setDetails] = useState('');
  const [sent, setSent] = useState(false);
  const action = useCommunityResource('safety:' + userId, async () => true, false);
  async function report() {
    const result = await action.run('report', async (ownerId) =>
      contentReportReceiptSchema.parse(
        await api.request('/v1/community/reports', {
          ownerId,
          method: 'POST',
          body: {
            targetUserId: userId,
            ...(shareId ? { shareId } : {}),
            reason,
            ...(details.trim() ? { details: details.trim() } : {}),
          },
        }),
      ),
    );
    if (result) {
      setSent(true);
      setOpen(false);
      setDetails('');
    }
  }
  function block() {
    Alert.alert(
      'Block ' + name + '?',
      'This removes your friendship and shared recall access, and prevents new invites or shares between you. You will no longer see each other’s marketplace decks, and practice contributions between you stop. Imported deck copies stay in your libraries. Unblocking will not restore the friendship or sharing permissions.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: () =>
            void action
              .run('block', async (ownerId) => {
                await api.request('/v1/community/blocks/' + encodeURIComponent(userId), {
                  ownerId,
                  method: 'POST',
                });
                return true;
              })
              .then((done) => {
                if (done) router.dismissTo('/friends');
              }),
        },
      ],
    );
  }
  return (
    <Panel>
      <Text style={s.sectionTitle}>Your comfort comes first.</Text>
      <Text style={s.caption}>
        Report a concern for review, or block this person to stop contact and sharing. Reporting
        does not automatically block them.
      </Text>
      {!!sent && (
        <Text accessibilityLiveRegion="polite" style={s.label}>
          Report received. Thank you for letting us know.
        </Text>
      )}
      <CommunityFeedback loading={false} error={action.error} retry={() => setOpen(true)} />
      {open && (
        <>
          {reasons.map(([value, title]) => (
            <Pressable
              key={value}
              accessibilityRole="radio"
              accessibilityState={{ selected: reason === value }}
              onPress={() => setReason(value)}
              style={[s.row, { minHeight: 44 }]}
            >
              <Text style={{ color: colors.accent }}>{reason === value ? '●' : '○'}</Text>
              <Text style={s.label}>{title}</Text>
            </Pressable>
          ))}
          <Field
            label="Anything else we should know?"
            hint="Optional. Include enough context to review your concern; avoid passwords or unrelated personal information."
            value={details}
            onChangeText={setDetails}
            multiline
            maxLength={2000}
            editable={!action.busy}
          />
          <Button
            title="Send report"
            size="compact"
            loading={action.busy === 'report'}
            disabled={action.busy !== null}
            onPress={() => void report()}
          />
          <Button
            title="Cancel report"
            size="compact"
            variant="ghost"
            disabled={action.busy !== null}
            onPress={() => setOpen(false)}
          />
        </>
      )}
      {!open && (
        <Button
          title={shareId ? 'Report this shared deck or person' : 'Report a concern'}
          variant="secondary"
          size="compact"
          disabled={action.busy !== null}
          onPress={() => {
            setSent(false);
            setOpen(true);
          }}
        />
      )}
      <Button
        title={'Block ' + name}
        variant="ghost"
        size="compact"
        loading={action.busy === 'block'}
        disabled={action.busy !== null}
        onPress={block}
      />
    </Panel>
  );
}

export function BlockedPeople() {
  const [open, setOpen] = useState(false);
  const blocked = useCommunityResource(
    'blocked-people',
    async (ownerId) =>
      blockedUsersSchema.parse(await api.request('/v1/community/blocks', { ownerId })),
    open,
  );
  async function unblock(id: string) {
    const result = await blocked.run(id, async (ownerId) => {
      await api.request('/v1/community/blocks/' + encodeURIComponent(id), {
        ownerId,
        method: 'DELETE',
      });
      return true;
    });
    if (result) await blocked.refresh();
  }
  return (
    <Panel>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={[s.between, { minHeight: 44 }]}
        onPress={() => setOpen((value) => !value)}
      >
        <Text style={s.label}>Blocked people</Text>
        <Text style={s.body}>{open ? '−' : '+'}</Text>
      </Pressable>
      {open && (
        <>
          <CommunityFeedback
            loading={blocked.loading}
            error={blocked.error}
            retry={() => void blocked.refresh()}
          />
          {blocked.data?.users.length === 0 && (
            <Text style={s.caption}>You have not blocked anyone.</Text>
          )}
          {blocked.data?.users.map((user) => (
            <View key={user.id} style={s.between}>
              <Text style={[s.label, { flex: 1 }]}>{user.name}</Text>
              <Button
                title="Unblock"
                size="compact"
                variant="secondary"
                loading={blocked.busy === user.id}
                disabled={blocked.busy !== null}
                onPress={() => void unblock(user.id)}
              />
            </View>
          ))}
          <Text style={s.caption}>
            Unblocking allows a new invite. Previous friendships and sharing permissions stay
            removed. Marketplace practice contributions stay off until enabled again.
          </Text>
        </>
      )}
    </Panel>
  );
}
