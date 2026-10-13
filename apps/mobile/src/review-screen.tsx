import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { previewIntervals } from '@recollect/scheduler';
import type { Rating } from '@recollect/contracts';
import { useStore } from './store';
import { dueCards } from './repository';
import { Back, Button, Panel, Screen, colors, reportError, s } from './ui';
function duration(seconds: number) {
  if (seconds < 3600) return Math.round(seconds / 60) + 'm';
  if (seconds < 86400) return Math.round(seconds / 3600) + 'h';
  return Math.round(seconds / 86400) + 'd';
}
export default function ReviewScreen() {
  const params = useLocalSearchParams<{
    deckId?: string;
    practice?: string;
    cardId?: string;
    id?: string;
  }>();
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
  const scroll = useRef<ScrollView>(null);
  const started = useRef(Date.now());
  const card = data.cards.find((c) => c.id === queue[index]);
  useEffect(() => {
    started.current = Date.now();
    setRevealed(false);
    setShowHint(false);
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, [index]);
  async function rate(rating: Rating) {
    if (!card || busy) return;
    setBusy(true);
    try {
      await mutate((repo) => repo.rateCard(card.id, rating, Date.now() - started.current));
      setIndex((i) => i + 1);
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
    }
  }
  if (!card)
    return (
      <Screen
        scrollRef={scroll}
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
          <Text style={[s.metric, { fontSize: 64 }]}>{index}</Text>
          <Text style={s.body}>
            {practice
              ? 'cards practiced. Your review schedule is unchanged.'
              : 'cards reviewed. Your next review dates are saved.'}
          </Text>
        </Panel>
        <Text style={s.body}>
          Come back when your next cards are ready. A little, often, goes a long way.
        </Text>
        {!queue.length &&
          data.cards.some((item) => !params.deckId || item.deckId === params.deckId) && (
            <Button
              title="Practice anytime"
              variant="secondary"
              onPress={() =>
                router.replace({
                  pathname: '/review',
                  params: {
                    practice: 'true',
                    ...(params.deckId ? { deckId: params.deckId } : {}),
                  },
                })
              }
            />
          )}
      </Screen>
    );
  const deck = data.decks.find((d) => d.id === card.deckId);
  const previewAt = new Date(
    Math.max(Date.now(), Date.parse(card.schedule.lastReviewedAt ?? '') || 0),
  ).toISOString();
  const intervals = previewIntervals(card.schedule, previewAt);
  const controls = !revealed ? (
    <Button title="Reveal answer" onPress={() => setRevealed(true)} />
  ) : practice ? (
    <Button
      title={index + 1 === queue.length ? 'Finish practice' : 'Next card  →'}
      onPress={() => setIndex((i) => i + 1)}
    />
  ) : (
    <>
      <Text style={[s.caption, { textAlign: 'center', color: colors.ink }]}>
        {busy ? 'Saving your review…' : 'How well did you remember?'}
      </Text>
      {(
        [
          ['again', 'hard'],
          ['good', 'easy'],
        ] as const
      ).map((row, rowIndex) => (
        <View key={rowIndex} style={s.row}>
          {row.map((rating) => (
            <View key={rating} style={{ flex: 1 }}>
              <Button
                title={
                  rating.charAt(0).toUpperCase() +
                  rating.slice(1) +
                  ' · ' +
                  duration(intervals[rating])
                }
                variant={rating === 'good' ? 'primary' : 'secondary'}
                size="compact"
                disabled={busy}
                onPress={() => void rate(rating)}
              />
            </View>
          ))}
        </View>
      ))}
    </>
  );
  return (
    <Screen
      scrollRef={scroll}
      title={deck?.name ?? 'Your review'}
      eyebrow={practice ? 'PRACTICE AT YOUR OWN PACE' : 'REVIEW SESSION'}
      leading={<Back label="Finish later" />}
      footer={controls}
    >
      <View style={s.between}>
        <Text style={s.caption}>
          Card {index + 1} of {queue.length}
        </Text>
        <Text style={s.caption}>{practice ? 'Schedule unchanged' : index + ' reviewed'}</Text>
      </View>
      <View
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: queue.length, now: index }}
        accessibilityLabel="Cards reviewed"
        style={{ height: 5, backgroundColor: colors.line, borderRadius: 3 }}
      >
        <View
          style={{
            height: 5,
            borderRadius: 3,
            backgroundColor: colors.accent,
            width: `${(index / queue.length) * 100}%`,
          }}
        />
      </View>
      <Panel>
        <View style={{ minHeight: 220, justifyContent: 'center', gap: 18 }}>
          <Text style={s.eyebrow}>QUESTION</Text>
          <Text
            selectable
            style={{ fontSize: 26, lineHeight: 36, fontWeight: '600', color: colors.ink }}
          >
            {card.front}
          </Text>
          {revealed && (
            <>
              <View style={s.divider} />
              <Text style={s.eyebrow}>ANSWER</Text>
              <Text selectable style={{ fontSize: 22, lineHeight: 32, color: colors.ink }}>
                {card.back}
              </Text>
            </>
          )}
          {showHint && !revealed && (
            <View
              style={{
                padding: 14,
                borderRadius: 14,
                backgroundColor: colors.background,
                gap: 4,
              }}
            >
              <Text style={s.label}>A small hint</Text>
              <Text style={s.body}>{card.hint}</Text>
            </View>
          )}
        </View>
      </Panel>
      {!revealed && !!card.hint && (
        <Button
          title={showHint ? 'Hide hint' : 'Show a hint'}
          variant="ghost"
          size="compact"
          onPress={() => setShowHint(!showHint)}
        />
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
