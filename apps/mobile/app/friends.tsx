import React, { useEffect, useState } from 'react';
import { Pressable, Share, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import type { FriendInvite } from '@recollect/contracts';
import { communityApi, otherParticipant, useCommunityResource } from '../src/community-api';
import { CommunityFeedback, SharedDeckSummary } from '../src/deck-sharing';
import { BrandPattern } from '../src/brand-patterns';
import Avatar from '../src/avatar';
import { Back, Button, Empty, Field, Panel, Screen, Text, colors, s } from '../src/ui';
import { friendInviteMessage, invitationCode } from '../src/friend-invite';

export default function FriendsScreen() {
  const params = useLocalSearchParams<{ invite?: string | string[] }>();
  const incomingCode = typeof params.invite === 'string' ? invitationCode(params.invite) : '';
  const community = useCommunityResource('community', communityApi.overview);
  const [code, setCode] = useState(incomingCode);
  const [invitation, setInvitation] = useState<{ ownerId: string; value: FriendInvite } | null>(
    null,
  );
  const [connected, setConnected] = useState<{ ownerId: string; name: string } | null>(null);
  useEffect(() => {
    if (params.invite !== undefined) setCode(incomingCode);
  }, [params.invite, incomingCode]);
  const savedInvite = invitation?.ownerId === community.ownerId ? invitation.value : null;
  async function invite() {
    const created = await community.run('invite', communityApi.invite);
    if (created && community.ownerId) {
      setInvitation({ ownerId: community.ownerId, value: created });
      await sendInvite(created);
      await community.refresh();
    }
  }
  async function sendInvite(value: FriendInvite) {
    await community.run('send', () =>
      Share.share({
        title: 'Learn together on Recollect',
        message: friendInviteMessage(value),
      }),
    );
  }
  async function accept() {
    const before = new Set(community.data?.friends.map((friend) => friend.id) ?? []);
    const result = await community.run('accept', (ownerId) =>
      communityApi.acceptInvite(ownerId, invitationCode(code)),
    );
    if (result) {
      setCode('');
      setConnected({
        ownerId: community.ownerId!,
        name: result.friends.find((friend) => !before.has(friend.id))?.name ?? 'Your friend',
      });
      await community.refresh();
    }
  }
  const inbox =
    community.data?.shares.filter((share) => share.recipient.id === community.ownerId) ?? [];
  const outbox =
    community.data?.shares.filter((share) => share.sender.id === community.ownerId) ?? [];
  const openShare = (share: NonNullable<typeof community.data>['shares'][number]) =>
    router.push({
      pathname: '/friends/[id]',
      params: { id: otherParticipant(share, community.ownerId!).id, shareId: share.id },
    });
  return (
    <Screen
      title="Friends"
      eyebrow="LEARN TOGETHER"
      subtitle="Share what interests you. Understand how you each learn."
      leading={<Back label="You" onPress={() => router.dismissTo('/profile')} />}
      action={<BrandPattern variant="weave" width={56} height={56} />}
    >
      <Panel tint>
        <Text style={s.sectionTitle}>A little company for your curiosity.</Text>
        <Text style={s.body}>
          Invite someone to exchange decks. Sharing a deck never shares your recall history unless
          you choose to.
        </Text>
        <Button
          title="Invite a friend"
          loading={community.busy === 'invite' || community.busy === 'send'}
          disabled={community.busy !== null}
          onPress={() => void invite()}
        />
        {!!savedInvite && (
          <>
            <Text style={s.label}>Your one-use invite code</Text>
            <Text selectable style={[s.body, { color: colors.ink }]}>
              {savedInvite.code}
            </Text>
            <Text style={s.caption}>
              Expires {new Date(savedInvite.expiresAt).toLocaleDateString()}. Anyone with this code
              can connect with you once.
            </Text>
            <Button
              title="Share this invite again"
              size="compact"
              variant="secondary"
              disabled={community.busy !== null}
              onPress={() => void sendInvite(savedInvite)}
            />
          </>
        )}
      </Panel>
      <Panel>
        <Field
          label="Have an invite?"
          placeholder="Paste an invite code or link"
          value={code}
          onChangeText={setCode}
          autoCapitalize="none"
          autoCorrect={false}
          editable={community.busy === null}
          maxLength={600}
          hint="Accepting connects you as friends. Recall history stays private until you enable it for a shared deck."
        />
        <Button
          title="Accept friend invite"
          variant="secondary"
          size="compact"
          loading={community.busy === 'accept'}
          disabled={community.busy !== null || !invitationCode(code)}
          onPress={() => void accept()}
        />
        {!!connected && connected.ownerId === community.ownerId && (
          <Text accessibilityLiveRegion="polite" style={s.caption}>
            {connected.name} is now in your friends.
          </Text>
        )}
      </Panel>
      <CommunityFeedback
        loading={community.loading}
        error={community.error}
        retry={() => void community.refresh()}
      />
      {!!community.data && (
        <>
          <View style={s.between}>
            <Text style={s.sectionTitle}>Your friends</Text>
            <Text style={s.caption}>{community.data.friends.length}</Text>
          </View>
          {!community.data.friends.length && (
            <Empty
              title="Make your first connection"
              detail="Invite a friend, then open any deck and choose Share this deck."
            />
          )}
          {community.data.friends.map((friend) => (
            <Pressable
              key={friend.id}
              accessibilityRole="button"
              accessibilityLabel={'View ' + friend.name}
              onPress={() => router.push({ pathname: '/friends/[id]', params: { id: friend.id } })}
              style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
            >
              <Panel style={{ padding: 16 }}>
                <View style={s.row}>
                  <Avatar name={friend.name} photoDataUrl={friend.photoDataUrl} size={48} />
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={s.label}>{friend.name}</Text>
                    <Text style={s.caption}>
                      {
                        community.data!.shares.filter(
                          (share) => otherParticipant(share, community.ownerId!).id === friend.id,
                        ).length
                      }{' '}
                      shared decks
                    </Text>
                  </View>
                  <Text style={{ color: colors.accent, fontSize: 24 }}>›</Text>
                </View>
              </Panel>
            </Pressable>
          ))}
          {!!inbox.length && (
            <>
              <Text style={s.sectionTitle}>Shared with you</Text>
              {inbox.map((share) => (
                <SharedDeckSummary
                  key={share.id}
                  share={share}
                  ownerId={community.ownerId!}
                  onPress={() => openShare(share)}
                />
              ))}
            </>
          )}
          {!!outbox.length && (
            <>
              <Text style={s.sectionTitle}>Shared by you</Text>
              {outbox.map((share) => (
                <SharedDeckSummary
                  key={share.id}
                  share={share}
                  ownerId={community.ownerId!}
                  onPress={() => openShare(share)}
                />
              ))}
            </>
          )}
          <Button
            title="Refresh friends and shared decks"
            variant="ghost"
            size="compact"
            disabled={community.busy !== null || community.loading}
            onPress={() => void community.refresh()}
          />
        </>
      )}
    </Screen>
  );
}
