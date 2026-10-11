import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
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
  const started = useRef(Date.now());
  const card = data.cards.find((c) => c.id === queue[index]);
  useEffect(() => {
    started.current = Date.now();
    setRevealed(false);
    setShowHint(false);
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
        title={queue.length ? 'A little more yours.' : 'You are up to date.'}
        eyebrow={practice ? 'PRACTICE COMPLETE' : 'SESSION COMPLETE'}
        tabs={false}
      >
        <Panel tint>
          <Text style={[s.metric, { fontSize: 64 }]}>{index}</Text>
          <Text style={s.body}>
            {practice
              ? 'cards practiced. Your review schedule is unchanged.'
              : 'cards reviewed. Your next review dates are saved on this device.'}
          </Text>
        </Panel>
        <Text style={s.body}>
          Come back when your next cards are ready. A little, often, goes a long way.
        </Text>
        <Button title="Back to today" onPress={() => router.replace('/')} />
      </Screen>
    );
  const deck = data.decks.find((d) => d.id === card.deckId);
  const previewAt = new Date(
    Math.max(Date.now(), Date.parse(card.schedule.lastReviewedAt ?? '') || 0),
  ).toISOString();
  const intervals = previewIntervals(card.schedule, previewAt);
  return (
    <Screen
      title={deck?.name ?? 'Your review'}
      eyebrow={practice ? 'PRACTICE · NO SCHEDULE CHANGES' : 'REVIEW SESSION'}
      tabs={false}
    >
      <Back label="Finish later" />
      <View style={s.between}>
        <Text style={s.caption}>
          {index + 1} OF {queue.length}
        </Text>
        <Text style={s.caption}>{revealed ? 'ANSWER' : 'QUESTION'}</Text>
      </View>
      <View style={{ height: 5, backgroundColor: colors.line, borderRadius: 3 }}>
        <View
          style={{
            height: 5,
            borderRadius: 3,
            backgroundColor: colors.accent,
            width: `${((index + 1) / queue.length) * 100}%`,
          }}
        />
      </View>
      <Panel>
        <View style={{ minHeight: 220, justifyContent: 'center', gap: 24 }}>
          <Text style={{ fontSize: 25, lineHeight: 34, fontWeight: '600', color: colors.ink }}>
            {card.front}
          </Text>
          {revealed && (
            <>
              <View style={s.divider} />
              <Text style={{ fontSize: 22, lineHeight: 32, color: colors.ink }}>{card.back}</Text>
            </>
          )}
          {showHint && !revealed && <Text style={s.body}>{card.hint}</Text>}
        </View>
      </Panel>
      {!revealed ? (
        <>
          <Button title="Reveal answer" onPress={() => setRevealed(true)} />
          {!!card.hint && (
            <Button
              title={showHint ? 'Hide hint' : 'Show hint'}
              variant="secondary"
              onPress={() => setShowHint(!showHint)}
            />
          )}
        </>
      ) : practice ? (
        <Button title="Next card  →" onPress={() => setIndex((i) => i + 1)} />
      ) : (
        <>
          <Text style={[s.body, { textAlign: 'center' }]}>How well did you remember?</Text>
          <View style={{ gap: 10 }}>
            {(['again', 'hard', 'good', 'easy'] as const).map((rating) => (
              <Button
                key={rating}
                title={
                  rating.charAt(0).toUpperCase() +
                  rating.slice(1) +
                  ' · ' +
                  duration(intervals[rating])
                }
                variant={rating === 'good' ? 'primary' : 'secondary'}
                disabled={busy}
                onPress={() => void rate(rating)}
              />
            ))}
          </View>
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
