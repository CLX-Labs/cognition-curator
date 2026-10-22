import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StatusBar, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { previewIntervals } from '@recollect/scheduler';
import { useStore } from './store';
import { dueCards } from './repository';
import { Back, Button, Panel, Screen, Text, colors, reportError, s } from './ui';
import ReviewCard from './review-card';

type ReviewParams = { deckId?: string; practice?: string; cardId?: string; id?: string };
function duration(seconds: number) {
  if (seconds < 3600) return Math.round(seconds / 60) + 'm';
  if (seconds < 86400) return Math.round(seconds / 3600) + 'h';
  return Math.round(seconds / 86400) + 'd';
}

export default function ReviewScreen() {
  const params = useLocalSearchParams<ReviewParams>();
  return (
    <ReviewSession
      key={[params.deckId, params.practice, params.cardId ?? params.id].join(':')}
      params={params}
    />
  );
}

function ReviewSession({ params }: { params: ReviewParams }) {
  const { data, mutate } = useStore();
  const practice = params.practice === 'true';
  const specific = params.cardId ?? params.id;
  const [queue] = useState(() =>
    (specific
      ? data.cards.filter((c) => c.id.toLowerCase() === specific.toLowerCase())
      : practice
        ? data.cards
        : dueCards(data)
    )
      .filter((c) => !params.deckId || c.deckId === params.deckId)
      .map((c) => c.id),
  );
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const scroll = useRef<ScrollView>(null);
  const started = useRef(Date.now());
  const card = data.cards.find((c) => c.id === queue[index]);
  useEffect(() => {
    started.current = Date.now();
    saving.current = false;
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, [index]);

  function advance() {
    setRevealed(false);
    setShowHint(false);
    setIndex((i) => i + 1);
  }
  async function answer(remembered: boolean) {
    if (!card || saving.current) return;
    saving.current = true;
    setBusy(true);
    try {
      await mutate((repo) =>
        repo.rateCard(card.id, remembered ? 'good' : 'again', Date.now() - started.current),
      );
      advance();
    } catch (error) {
      reportError(error);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  if (!card)
    return (
      <Screen
        scrollRef={scroll}
        syncFeedback="errors"
        title={queue.length ? 'Nicely done.' : 'All caught up.'}
        eyebrow={practice ? 'PRACTICE COMPLETE' : 'SESSION COMPLETE'}
        subtitle={
          queue.length
            ? 'A little practice, a lasting memory.'
            : 'Your next cards will be here when they are ready.'
        }
        footer={
          <Button
            title={params.deckId ? 'Back to deck' : 'Back to today'}
            onPress={() =>
              params.deckId
                ? router.dismissTo({ pathname: '/decks/[id]', params: { id: params.deckId } })
                : router.dismissTo('/')
            }
          />
        }
      >
        <Panel tint>
          <Text style={[s.metric, { fontSize: 72 }]}>{index}</Text>
          <Text style={s.body}>
            {practice
              ? 'cards practiced. Your next review dates are saved.'
              : 'cards reviewed. Your next review dates are saved.'}
          </Text>
        </Panel>
        <Text style={s.editorial}>A little more stays.</Text>
        {!queue.length &&
          data.cards.some((item) => !params.deckId || item.deckId === params.deckId) && (
            <Button
              title="Practice anytime"
              variant="secondary"
              onPress={() =>
                router.replace({
                  pathname: '/review',
                  params: { practice: 'true', ...(params.deckId ? { deckId: params.deckId } : {}) },
                })
              }
            />
          )}
      </Screen>
    );

  const deck = data.decks.find((d) => d.id === card.deckId);
  const intervals = previewIntervals(
    card.schedule,
    new Date(
      Math.max(Date.now(), Date.parse(card.schedule.lastReviewedAt ?? '') || 0),
    ).toISOString(),
  );
  return (
    <Screen
      scrollRef={scroll}
      syncFeedback="errors"
      title={deck?.name ?? 'Your review'}
      appearance="focus"
      eyebrow={practice ? 'FREE PRACTICE' : 'DAILY REVIEW'}
      leading={<Back label="Finish later" color={colors.paper} />}
      footer={
        <>
          <View style={s.row}>
            <View style={{ flex: 1 }}>
              <Button
                title="← Not sure"
                size="compact"
                variant="secondary"
                disabled={busy}
                onPress={() => void answer(false)}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                title="I remember →"
                size="compact"
                variant="highlight"
                disabled={busy}
                onPress={() => void answer(true)}
              />
            </View>
          </View>
          <Text style={[s.caption, { textAlign: 'center', color: colors.paper }]}>
            {'Not sure: ' +
              duration(intervals.again) +
              ' · Remembered: ' +
              duration(intervals.good)}
          </Text>
        </>
      }
    >
      <StatusBar barStyle="light-content" />
      <View style={s.between}>
        <Text style={[s.eyebrow, { color: colors.paper }]}>
          {String(index + 1).padStart(2, '0')} / {String(queue.length).padStart(2, '0')}
        </Text>
        <Text style={[s.caption, { color: colors.paper }]}>
          {practice ? 'At your own pace' : index + ' reviewed'}
        </Text>
      </View>
      <View
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: queue.length, now: index }}
        accessibilityLabel="Cards reviewed"
        style={{ height: 3, backgroundColor: '#FFFFFF40' }}
      >
        <View
          style={{
            height: 3,
            backgroundColor: colors.yellow,
            width: `${(index / queue.length) * 100}%`,
          }}
        />
      </View>
      <ReviewCard
        key={index + ':' + card.id}
        card={card}
        revealed={revealed}
        disabled={busy}
        onFlip={() => setRevealed((value) => !value)}
        onAnswer={(remembered) => void answer(remembered)}
      />
      <Text style={[s.caption, { textAlign: 'center', color: colors.paper }]}>
        Swipe left if unsure. Swipe right if you remember.
      </Text>
      {!revealed && !!card.hint && (
        <>
          <Button
            title={showHint ? 'Hide hint' : 'Show a hint'}
            variant="secondary"
            size="compact"
            onPress={() => setShowHint(!showHint)}
          />
          {showHint && (
            <Panel tint>
              <Text style={s.label}>A small hint</Text>
              <Text style={s.body}>{card.hint}</Text>
            </Panel>
          )}
        </>
      )}
      {revealed && !!card.explanation && (
        <Panel>
          <Text style={s.label}>A little more context</Text>
          <Text style={s.body}>{card.explanation}</Text>
        </Panel>
      )}
    </Screen>
  );
}
