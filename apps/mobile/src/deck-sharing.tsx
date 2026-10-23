import React, { useRef, useState } from 'react';
import { Pressable, Switch, View } from 'react-native';
import { router } from 'expo-router';
import type { DeckShare } from '@recollect/contracts';
import {
  communityApi,
  otherParticipant,
  progressVisible,
  useCommunityResource,
} from './community-api';
import { useStore } from './store';
import { Back, Button, Panel, Text, colors, s } from './ui';
import { DeckArtwork } from './brand-patterns';
import Avatar from './avatar';
import { downloadSharedDeck, publishSyncedDeck } from './shared-deck-sync';

export function CommunityFeedback({
  loading,
  error,
  retry,
}: {
  loading: boolean;
  error: string | null;
  retry(): void;
}) {
  if (error)
    return (
      <View style={{ gap: 10 }}>
        <Text accessibilityRole="alert" style={[s.body, { color: colors.danger }]}>
          {error}
        </Text>
        <Button title="Try again" size="compact" variant="secondary" onPress={retry} />
      </View>
    );
  return loading ? (
    <Text accessibilityLiveRegion="polite" style={s.caption}>
      Loading your connections…
    </Text>
  ) : null;
}

export function RecallConsent({
  value,
  onChange,
  disabled = false,
  name,
}: {
  value: boolean;
  onChange(value: boolean): void;
  disabled?: boolean;
  name: string;
}) {
  return (
    <View style={{ gap: 8 }}>
      <View style={s.between}>
        <Text style={[s.label, { flex: 1 }]}>Share my detailed recall with {name}</Text>
        <Switch
          accessibilityLabel={'Share my detailed recall with ' + name}
          value={value}
          onValueChange={onChange}
          disabled={disabled}
          trackColor={{ false: colors.line, true: colors.accent }}
        />
      </View>
      <Text style={s.caption}>
        This shares past and future recall on the shared cards: remembered or unsure, answers, and
        review timelines. Your other decks stay private. You can turn this off at any time.
      </Text>
    </View>
  );
}

export function SharedDeckSummary({
  share,
  ownerId,
  onPress,
}: {
  share: DeckShare;
  ownerId: string;
  onPress(): void;
}) {
  const outgoing = share.sender.id === ownerId;
  const person = otherParticipant(share, ownerId);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={'View shared deck ' + share.deck.name}
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
    >
      <Panel style={{ padding: 16, gap: 12 }}>
        <View style={s.row}>
          <DeckArtwork
            id={share.deck.id}
            color={share.deck.color}
            icon={share.deck.icon}
            size={48}
          />
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={s.label}>{share.deck.name}</Text>
            <Text style={s.caption}>
              {share.cardCount} cards · {outgoing ? 'To ' : 'From '}
              {person.name}
            </Text>
          </View>
          <Text style={{ fontSize: 24, color: colors.accent }}>›</Text>
        </View>
        <Text style={s.caption}>
          {share.acceptedAt
            ? 'Accepted · independent copy'
            : outgoing
              ? 'Waiting for your friend to accept'
              : 'Preview and add to your library'}
        </Text>
      </Panel>
    </Pressable>
  );
}

export default function DeckSharing({ deckId }: { deckId: string }) {
  const { repository, sync } = useStore();
  const [open, setOpen] = useState(false);
  const [friendId, setFriendId] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const operation = useRef<{ key: string; id: string } | null>(null);
  const community = useCommunityResource('share-deck:' + deckId, communityApi.overview, open);
  const friend = community.data?.friends.find((person) => person.id === friendId);
  const shares =
    community.data?.shares.filter(
      (share) => share.sourceDeckId === deckId || share.recipientDeckId === deckId,
    ) ?? [];
  async function submit() {
    if (!friend || !repository || community.busy) return;
    const key = deckId + ':' + friend.id + ':' + consent;
    if (operation.current?.key !== key) operation.current = { key, id: repository.newId() };
    const operationId = operation.current.id;
    const result = await community.run('share', async (ownerId) => {
      if (repository.ownerId !== ownerId) throw new Error('The signed-in account changed.');
      return publishSyncedDeck(repository, sync, () =>
        communityApi.createShare(ownerId, {
          operationId,
          friendId: friend.id,
          deckId,
          shareProgress: consent,
        }),
      );
    });
    if (result) {
      operation.current = null;
      setFriendId(null);
      setConsent(false);
      router.push({ pathname: '/friends/[id]', params: { id: friend.id, shareId: result.id } });
    }
  }
  return (
    <Panel style={{ padding: 18 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel="Share this deck with friends"
        style={[s.between, { minHeight: 44 }]}
        onPress={() => setOpen((value) => !value)}
      >
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={s.sectionTitle}>Share this deck</Text>
          <Text style={s.caption}>Learn together, at your own pace.</Text>
        </View>
        <Text style={{ fontSize: 22, color: colors.accent }}>{open ? '−' : '+'}</Text>
      </Pressable>
      {open && (
        <>
          <Text style={s.body}>
            Send a copy to a friend. Their cards and review schedule are independent; later edits do
            not update either copy.
          </Text>
          <CommunityFeedback
            loading={community.loading}
            error={community.error}
            retry={() => void community.refresh()}
          />
          {!!community.data && (
            <>
              {!community.data.friends.length && (
                <Button
                  title="Invite a friend"
                  variant="secondary"
                  size="compact"
                  onPress={() => router.push('/friends')}
                />
              )}
              {community.data.friends.map((person) => (
                <Pressable
                  key={person.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: friendId === person.id }}
                  accessibilityLabel={'Share with ' + person.name}
                  disabled={community.busy !== null}
                  onPress={() => {
                    setFriendId(person.id);
                    setConsent(false);
                  }}
                  style={[
                    s.row,
                    {
                      minHeight: 54,
                      padding: 10,
                      borderWidth: 1,
                      borderColor: friendId === person.id ? colors.accent : colors.line,
                      borderRadius: 6,
                    },
                  ]}
                >
                  <Avatar name={person.name} photoDataUrl={person.photoDataUrl} size={36} />
                  <Text style={[s.label, { flex: 1 }]}>{person.name}</Text>
                  <Text style={{ color: colors.accent }}>{friendId === person.id ? '●' : '○'}</Text>
                </Pressable>
              ))}
              {!!friend && (
                <>
                  <RecallConsent
                    value={consent}
                    onChange={setConsent}
                    name={friend.name}
                    disabled={community.busy !== null}
                  />
                  <Button
                    title={'Share with ' + friend.name}
                    size="compact"
                    loading={community.busy === 'share'}
                    onPress={() => void submit()}
                  />
                </>
              )}
              {!!shares.length && <Text style={s.eyebrow}>SHARED COPIES</Text>}
              {shares.map((share) => (
                <SharedDeckSummary
                  key={share.id}
                  share={share}
                  ownerId={community.ownerId!}
                  onPress={() =>
                    router.push({
                      pathname: '/friends/[id]',
                      params: {
                        id: otherParticipant(share, community.ownerId!).id,
                        shareId: share.id,
                      },
                    })
                  }
                />
              ))}
            </>
          )}
        </>
      )}
    </Panel>
  );
}

export function SharedDeckPreview({
  shareId,
  close,
  updated,
}: {
  shareId: string;
  close(): void;
  updated(): Promise<void>;
}) {
  const { data, repository, sync, refresh } = useStore();
  const detail = useCommunityResource('share:' + shareId, (ownerId) =>
    communityApi.detail(ownerId, shareId),
  );
  const [consent, setConsent] = useState(false);
  const [visible, setVisible] = useState(10);
  const share = detail.data?.share;
  const ownerId = detail.ownerId;
  const person = share && ownerId ? otherParticipant(share, ownerId) : null;
  const localCopy =
    share?.recipient.id === ownerId &&
    !!share.recipientDeckId &&
    data.decks.some((deck) => deck.id === share.recipientDeckId);
  async function accept() {
    const result = await detail.run('accept', async (owner) => {
      const accepted = await communityApi.acceptShare(owner, shareId, consent);
      await sync();
      await refresh();
      return accepted;
    });
    if (result) {
      await detail.refresh();
      await updated();
    }
  }
  async function toggle(enabled: boolean) {
    const result = await detail.run('permission', (owner) =>
      communityApi.permission(owner, shareId, enabled),
    );
    if (result) {
      await detail.refresh();
      await updated();
    }
  }
  async function download() {
    if (!repository || !share?.recipientDeckId) return;
    const deckId = share.recipientDeckId;
    await detail.run('download', async (owner) => {
      if (repository.ownerId !== owner) throw new Error('The signed-in account changed.');
      await downloadSharedDeck(repository, deckId, sync, refresh);
      return true;
    });
  }
  async function revoke() {
    const result = await detail.run('revoke', async (owner) => {
      await communityApi.revoke(owner, shareId);
      return true;
    });
    if (result) {
      close();
      await updated();
    }
  }
  return (
    <Panel style={{ borderColor: colors.accent }}>
      <Back label="Shared decks" onPress={close} />
      <CommunityFeedback
        loading={detail.loading}
        error={detail.error}
        retry={() => void detail.refresh()}
      />
      {!!share && !!ownerId && !!person && (
        <>
          <View style={s.row}>
            <DeckArtwork
              id={share.deck.id}
              color={share.deck.color}
              icon={share.deck.icon}
              size={56}
            />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={s.sectionTitle}>{share.deck.name}</Text>
              <Text style={s.caption}>
                {share.cardCount} cards · Shared by {share.sender.name}
              </Text>
            </View>
          </View>
          {!!share.deck.description && <Text style={s.body}>{share.deck.description}</Text>}
          <Text style={s.caption}>
            Snapshot shared {new Date(share.createdAt).toLocaleDateString()}. Imported cards are
            independent copies with fresh review schedules. Changes to either library do not
            propagate.
          </Text>
          {!!share.acceptedAt && (
            <>
              <Text style={s.label}>
                Accepted {new Date(share.acceptedAt).toLocaleDateString()}
              </Text>
              {!!localCopy && (
                <Button
                  title="Open my copy"
                  variant="secondary"
                  size="compact"
                  onPress={() =>
                    router.push({ pathname: '/decks/[id]', params: { id: share.recipientDeckId! } })
                  }
                />
              )}
              {share.recipient.id === ownerId && !!share.recipientDeckId && !localCopy && (
                <>
                  <Text accessibilityLiveRegion="polite" style={s.body}>
                    Accepted. Sync to download your copy.
                  </Text>
                  <Button
                    title="Sync to download my copy"
                    variant="secondary"
                    size="compact"
                    disabled={detail.busy !== null}
                    loading={detail.busy === 'download'}
                    onPress={() => void download()}
                  />
                  <Text style={s.caption}>
                    If you removed your copy, syncing will keep that deletion. You can ask your
                    friend for a new share.
                  </Text>
                </>
              )}
            </>
          )}
          <Text style={s.eyebrow}>REVIEW THE SHARED CARDS</Text>
          {detail.data!.cards.slice(0, visible).map((card, index) => (
            <View
              key={card.id}
              style={{ gap: 6, paddingTop: 12, borderTopWidth: 1, borderColor: colors.line }}
            >
              <Text style={s.caption}>
                {index + 1} / {share.cardCount}
              </Text>
              <Text style={s.label}>{card.front}</Text>
              <Text style={s.body}>{card.back}</Text>
              {!!card.hint && <Text style={s.caption}>Hint: {card.hint}</Text>}
            </View>
          ))}
          {visible < detail.data!.cards.length && (
            <Button
              title="Show more shared cards"
              size="compact"
              variant="secondary"
              onPress={() => setVisible((count) => count + 20)}
            />
          )}
          {!share.acceptedAt && share.recipient.id === ownerId ? (
            <>
              <RecallConsent
                value={consent}
                onChange={setConsent}
                name={person.name}
                disabled={detail.busy !== null}
              />
              <Button
                title="Add to my decks"
                loading={detail.busy === 'accept'}
                disabled={detail.busy !== null}
                onPress={() => void accept()}
              />
            </>
          ) : (
            <>
              <RecallConsent
                value={progressVisible(share, ownerId)}
                onChange={(value) => void toggle(value)}
                name={person.name}
                disabled={detail.busy !== null}
              />
              {!share.acceptedAt && (
                <Text style={s.caption}>Your friend has not added this deck yet.</Text>
              )}
            </>
          )}
          {!!share.acceptedAt && progressVisible(share, person.id) && (
            <Button
              title={'View ' + person.name + '’s recall'}
              variant="secondary"
              size="compact"
              onPress={() =>
                router.push({
                  pathname: '/insights',
                  params: { shareId, userId: person.id, name: person.name },
                })
              }
            />
          )}
          {!!share.acceptedAt && !progressVisible(share, person.id) && (
            <Text style={s.caption}>
              {person.name} is keeping their recall private for this deck.
            </Text>
          )}
          {!!share.acceptedAt && (
            <Button
              title="My recall on these cards"
              variant="secondary"
              size="compact"
              onPress={() =>
                router.push({ pathname: '/insights', params: { shareId, userId: ownerId } })
              }
            />
          )}
          <Button
            title={detail.busy === 'revoke' ? 'Stopping sharing…' : 'Stop sharing this deck'}
            variant="ghost"
            size="compact"
            disabled={detail.busy !== null}
            onPress={() => void revoke()}
          />
          <Text style={s.caption}>
            Stopping sharing immediately removes recall access for both of you. Imported copies stay
            in each library.
          </Text>
        </>
      )}
    </Panel>
  );
}
