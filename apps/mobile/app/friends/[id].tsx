import React, { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import {
  communityApi,
  progressVisible,
  sharesWith,
  useCommunityResource,
} from '../../src/community-api';
import { CommunityFeedback, SharedDeckPreview, SharedDeckSummary } from '../../src/deck-sharing';
import Avatar from '../../src/avatar';
import { Back, Button, Empty, Panel, Screen, Text, s } from '../../src/ui';
import { FriendSafety } from '../../src/community-safety';

export default function FriendScreen() {
  const { id, shareId } = useLocalSearchParams<{ id: string; shareId?: string }>();
  const community = useCommunityResource('friend:' + id, communityApi.overview);
  const [previewId, setPreviewId] = useState<string | null>(shareId ?? null);
  useEffect(() => {
    setPreviewId(shareId ?? null);
  }, [id, shareId]);
  const friend = community.data?.friends.find((person) => person.id === id);
  const shares =
    community.data && community.ownerId ? sharesWith(community.data, community.ownerId, id) : [];
  const visibleRecall = shares.some((share) => share.acceptedAt && progressVisible(share, id));
  function remove() {
    if (!friend) return;
    Alert.alert(
      'Remove ' + friend.name + '?',
      'This stops access to all shared recall between you. Imported deck copies remain in each library. You can connect again with a new invite.',
      [
        { text: 'Keep friend', style: 'cancel' },
        {
          text: 'Remove friend',
          style: 'destructive',
          onPress: () =>
            void community
              .run('remove', async (ownerId) => {
                await communityApi.removeFriend(ownerId, id);
                return true;
              })
              .then((removed) => {
                if (removed) router.dismissTo('/friends');
              }),
        },
      ],
    );
  }
  return (
    <Screen
      title={friend?.name ?? 'Friend'}
      eyebrow="YOUR CONNECTION"
      leading={<Back label="Friends" onPress={() => router.dismissTo('/friends')} />}
      action={
        friend ? (
          <Avatar name={friend.name} photoDataUrl={friend.photoDataUrl} size={56} />
        ) : undefined
      }
      subtitle={friend ? 'Shared decks, personal learning journeys.' : undefined}
    >
      <CommunityFeedback
        loading={community.loading}
        error={community.error}
        retry={() => void community.refresh()}
      />
      {!!community.data && !friend && (
        <Empty
          title="This connection is unavailable"
          detail="You may no longer be connected. Invite your friend again to share decks."
          action={
            <Button
              title="Back to friends"
              variant="secondary"
              onPress={() => router.dismissTo('/friends')}
            />
          }
        />
      )}
      {!!friend && (
        <>
          {visibleRecall ? (
            <Panel tint>
              <Text style={s.sectionTitle}>See what is sticking.</Text>
              <Text style={s.body}>
                Explore {friend.name}’s card-by-card recall, repeat struggles, and review history
                across the shared decks they have enabled.
              </Text>
              <Button
                title={'View ' + friend.name + '’s recall'}
                onPress={() =>
                  router.push({
                    pathname: '/insights',
                    params: { friendId: id, name: friend.name },
                  })
                }
              />
              <Text style={s.caption}>
                Recall reflects their own “I remember” and “Not sure” responses.
              </Text>
            </Panel>
          ) : (
            <Panel>
              <Text style={s.sectionTitle}>Learning stays personal.</Text>
              <Text style={s.body}>
                {friend.name} can enable detailed recall separately for each shared deck. Accept a
                shared deck to start learning together.
              </Text>
            </Panel>
          )}
          {!!previewId && (
            <SharedDeckPreview
              key={previewId}
              shareId={previewId}
              close={() => setPreviewId(null)}
              updated={community.refresh}
            />
          )}
          <View style={s.between}>
            <Text style={s.sectionTitle}>Your shared decks</Text>
            <Text style={s.caption}>{shares.length}</Text>
          </View>
          {!shares.length && (
            <Empty
              title="Share your first deck"
              detail="Open a deck in your library, choose Share this deck, and select your friend."
              action={
                <Button
                  title="Choose a deck"
                  variant="secondary"
                  onPress={() => router.dismissTo('/decks')}
                />
              }
            />
          )}
          {shares.map((share) => (
            <SharedDeckSummary
              key={share.id}
              share={share}
              ownerId={community.ownerId!}
              onPress={() => setPreviewId(share.id)}
            />
          ))}
          <Text style={s.caption}>
            You each control your recall visibility. Turning it off removes your friend’s access to
            past and future reviews immediately. Editing a copied card makes its new content
            private.
          </Text>
          <Button
            title="Refresh shared decks"
            variant="secondary"
            size="compact"
            disabled={community.loading || community.busy !== null}
            onPress={() => void community.refresh()}
          />
          <Button
            title="Remove friend"
            variant="ghost"
            size="compact"
            disabled={community.busy !== null}
            loading={community.busy === 'remove'}
            onPress={remove}
          />
          <FriendSafety
            key={friend.id}
            userId={friend.id}
            name={friend.name}
            shareId={previewId ?? undefined}
          />
        </>
      )}
    </Screen>
  );
}
