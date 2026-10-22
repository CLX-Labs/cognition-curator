import React, { useEffect, useRef, useState } from 'react';
import { StatusBar, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { previewIntervals } from '@recollect/scheduler';
import { useStore } from './store';
import { dueCards } from './repository';
import { Back, Button, Panel, Screen, Text, colors, reportError, s } from './ui';
import ReviewCard from './review-card';
import { playReviewHaptic } from './review-haptics';
import { ReviewFeedbackCue, type ReviewFeedback } from './review-feedback';
import { ReviewReadingSheet } from './review-reading-sheet';

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
  const [reading, setReading] = useState<'card' | 'hint' | 'context' | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<ReviewFeedback | null>(null);
  const feedbackSequence = useRef(0);
  const active = useRef(true);
  const saving = useRef(false);
  const started = useRef(Date.now());
  const card = data.cards.find((c) => c.id === queue[index]);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    if (!feedback) return;
    const timeout = setTimeout(() => {
      setFeedback((current) => (current?.id === feedback.id ? null : current));
    }, 500);
    return () => clearTimeout(timeout);
  }, [feedback]);
  useEffect(() => {
    started.current = Date.now();
    saving.current = false;
  }, [index]);

  function advance() {
    setRevealed(false);
    setReading(null);
    setIndex((i) => i + 1);
  }
  async function answer(remembered: boolean) {
    if (!card || saving.current || reading) return;
    saving.current = true;
    setBusy(true);
    setFeedback(null);
    try {
      await mutate((repo) =>
        repo.rateCard(card.id, remembered ? 'good' : 'again', Date.now() - started.current),
      );
      if (!active.current) return;
      setFeedback({ id: ++feedbackSequence.current, remembered });
      playReviewHaptic(remembered);
      advance();
    } catch (error) {
      if (active.current) reportError(error);
    } finally {
      saving.current = false;
      if (active.current) setBusy(false);
    }
  }

  if (!card)
    return (
      <Screen
        syncFeedback="errors"
        title={queue.length ? 'Nicely done.' : 'All caught up.'}
        eyebrow={practice ? 'PRACTICE COMPLETE' : 'SESSION COMPLETE'}
        subtitle={
          queue.length
            ? 'A little practice, a lasting memory.'
            : 'Your next cards will be here when they are ready.'
        }
        footer={
          <>
            <Button
              title={params.deckId ? 'Back to deck' : 'Back to today'}
              onPress={() =>
                params.deckId
                  ? router.dismissTo({ pathname: '/decks/[id]', params: { id: params.deckId } })
                  : router.dismissTo('/')
              }
            />
            <ReviewFeedbackCue feedback={feedback} />
          </>
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
      scrollable={false}
      syncFeedback="errors"
      title={deck?.name ?? 'Your review'}
      appearance="focus"
      eyebrow={practice ? 'FREE PRACTICE' : 'DAILY REVIEW'}
      leading={
        <View style={s.between}>
          <Back label="Finish later" color={colors.paper} />
          <Text style={[s.eyebrow, { color: colors.paper, marginBottom: 0 }]}>
            {String(index + 1).padStart(2, '0')} / {String(queue.length).padStart(2, '0')}
          </Text>
        </View>
      }
      footer={
        <>
          <View style={s.row}>
            <View style={{ flex: 1 }}>
              <Button
                title="← Not sure"
                size="compact"
                variant="secondary"
                disabled={busy || !!reading}
                onPress={() => void answer(false)}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                title="I remember →"
                size="compact"
                variant="highlight"
                disabled={busy || !!reading}
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
          <ReviewFeedbackCue feedback={feedback} />
        </>
      }
    >
      <StatusBar barStyle="light-content" />
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
        disabled={busy || !!reading}
        onFlip={() => {
          if (!reading) setRevealed((value) => !value);
        }}
        onAnswer={(remembered) => void answer(remembered)}
      />
      <View style={[s.row, { justifyContent: 'space-between', marginBottom: 36 }]}>
        <View style={{ flex: 1 }}>
          <Button
            title="Read in full"
            variant="secondary"
            size="compact"
            disabled={busy}
            onPress={() => setReading('card')}
          />
        </View>
        {!revealed && !!card.hint && (
          <View style={{ flex: 1 }}>
            <Button
              title="Show a hint"
              variant="secondary"
              size="compact"
              disabled={busy}
              onPress={() => setReading('hint')}
            />
          </View>
        )}
        {revealed && !!card.explanation && (
          <View style={{ flex: 1 }}>
            <Button
              title="More context"
              variant="secondary"
              size="compact"
              disabled={busy}
              onPress={() => setReading('context')}
            />
          </View>
        )}
      </View>
      {reading && (
        <ReviewReadingSheet
          card={card}
          revealed={revealed}
          section={reading}
          onClose={() => setReading(null)}
        />
      )}
    </Screen>
  );
}
