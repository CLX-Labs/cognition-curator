import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, StatusBar, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { previewIntervals } from '@recollect/scheduler';
import { useStore } from './store';
import { activeDeck, dueCards, type LocalSnapshot } from './repository';
import { Back, Button, Panel, Screen, Text, colors, reportError, s } from './ui';
import ReviewCard from './review-card';
import { createReviewHaptics } from './review-haptics';
import { ReviewFeedbackCue, type ReviewFeedback } from './review-feedback';
import { ReviewReadingSheet } from './review-reading-sheet';
import { BrandPattern } from './brand-patterns';

type ReviewParams = { deckId?: string; practice?: string; cardId?: string; id?: string };
type ReadingSection = 'card' | 'hint' | 'context';
function eligibleCard(data: LocalSnapshot, id: string, practice: boolean, now = Date.now()) {
  const card = data.cards.find((item) => item.id === id && !item.deletedAt);
  const deck = card && data.decks.find((item) => item.id === card.deckId && !item.deletedAt);
  return card &&
    deck &&
    (practice || (activeDeck(deck, now) && Date.parse(card.schedule.dueAt) <= now))
    ? card
    : undefined;
}
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
  const specific = params.cardId ?? params.id;
  // Widget fallbacks can intentionally open a card that is not due. Keep that
  // session in practice mode even after its own rating changes the due date.
  const [practice] = useState(() => {
    const selected =
      specific && data.cards.find((card) => card.id.toLowerCase() === specific.toLowerCase());
    return (
      params.practice === 'true' || Boolean(selected && !eligibleCard(data, selected.id, false))
    );
  });
  const [queue, setQueue] = useState(() => {
    const ids = (
      specific
        ? data.cards.filter((c) => c.id.toLowerCase() === specific.toLowerCase())
        : practice
          ? data.cards
          : dueCards(data)
    )
      .filter((c) => !params.deckId || c.deckId === params.deckId)
      .map((c) => c.id);
    if (!params.deckId && !specific) {
      for (let i = ids.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [ids[i], ids[j]] = [ids[j]!, ids[i]!];
      }
    }
    return ids;
  });
  const [reviewed, setReviewed] = useState(0);
  const [revealedCard, setRevealedCard] = useState<string | null>(null);
  const [reader, setReader] = useState<{ cardId: string; section: ReadingSection } | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<ReviewFeedback | null>(null);
  const [haptics] = useState(createReviewHaptics);
  const feedbackSequence = useRef(0);
  const active = useRef(true);
  const focused = useRef(true);
  const foreground = useRef(
    AppState.currentState !== 'background' && AppState.currentState !== 'inactive',
  );
  const saving = useRef(false);
  const leaving = useRef(false);
  const started = useRef(Date.now());
  const latestData = useRef(data);
  latestData.current = data;
  const savingCard = useRef<string | null>(null);
  // Revalidate the original order; sync must never add cards to this session.
  // The current save refreshes SQLite before its promise resolves, so retain
  // that one card until answer() consumes it exactly once.
  const eligibleIds = useMemo(() => {
    const decks = new Set(data.decks.filter((deck) => !deck.deletedAt).map((deck) => deck.id));
    const cards = practice ? data.cards : dueCards(data);
    return new Set(
      cards.filter((card) => !card.deletedAt && decks.has(card.deckId)).map((card) => card.id),
    );
  }, [data, practice]);
  const availableQueue = queue.filter((id) => id === savingCard.current || eligibleIds.has(id));
  const card = data.cards.find((item) => item.id === availableQueue[0] && !item.deletedAt);
  const currentCard = useRef(card?.id);
  currentCard.current = card?.id;
  const revealed = !!card && revealedCard === card.id;
  const reading = card && reader?.cardId === card.id ? reader.section : null;
  const total = reviewed + availableQueue.length;
  useEffect(() => {
    setQueue((current) => {
      const next = current.filter((id) => id === savingCard.current || eligibleIds.has(id));
      return next.length === current.length ? current : next;
    });
  }, [eligibleIds, busy]);

  function setReading(section: ReadingSection | null) {
    setReader(section && card ? { cardId: card.id, section } : null);
  }
  useEffect(() => {
    active.current = true;
    foreground.current =
      AppState.currentState !== 'background' && AppState.currentState !== 'inactive';
    haptics.setActive(focused.current && foreground.current);
    const subscription = AppState.addEventListener('change', (state) => {
      foreground.current = state === 'active';
      haptics.setActive(focused.current && foreground.current);
    });
    return () => {
      active.current = false;
      haptics.setActive(false);
      subscription.remove();
    };
  }, [haptics]);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      haptics.setActive(foreground.current);
      return () => {
        focused.current = false;
        haptics.setActive(false);
      };
    }, [haptics]),
  );
  useEffect(() => {
    if (!feedback) return;
    const timeout = setTimeout(() => {
      setFeedback((current) => (current?.id === feedback.id ? null : current));
    }, 500);
    return () => clearTimeout(timeout);
  }, [feedback]);
  useEffect(() => {
    started.current = Date.now();
  }, [card?.id]);

  function advance(cardId: string) {
    setRevealedCard(null);
    setReader(null);
    setQueue((current) => current.filter((id) => id !== cardId));
    setReviewed((count) => count + 1);
  }
  async function answer(remembered: boolean) {
    if (
      !card ||
      card.id !== currentCard.current ||
      !active.current ||
      !focused.current ||
      saving.current ||
      leaving.current ||
      reading
    )
      return;
    if (!eligibleCard(latestData.current, card.id, practice)) {
      setQueue((current) => current.filter((id) => id !== card.id));
      return;
    }
    haptics.cancel();
    saving.current = true;
    savingCard.current = card.id;
    setBusy(true);
    setFeedback(null);
    try {
      await mutate((repo) =>
        repo.rateCard(card.id, remembered ? 'good' : 'again', Date.now() - started.current),
      );
      if (!active.current) return;
      setFeedback({ id: ++feedbackSequence.current, remembered });
      haptics.answer(remembered);
      advance(card.id);
    } catch (error) {
      if (active.current) reportError(error);
    } finally {
      saving.current = false;
      savingCard.current = null;
      if (active.current) setBusy(false);
    }
  }

  function openReading(section: 'card' | 'hint' | 'context') {
    if (!active.current || !focused.current || saving.current || leaving.current || busy || reading)
      return;
    if (section === 'hint') haptics.reveal();
    else haptics.cancel();
    setReading(section);
  }

  function manageCard() {
    if (
      !card ||
      card.id !== currentCard.current ||
      !reading ||
      !active.current ||
      !focused.current ||
      saving.current ||
      leaving.current
    )
      return;
    leaving.current = true;
    haptics.setActive(false);
    setBusy(true);
    setReading(null);
    router.replace({ pathname: '/cards/[id]', params: { id: card.id } });
  }

  if (!card)
    return (
      <Screen
        syncFeedback="errors"
        title={reviewed ? 'Nicely done.' : 'All caught up.'}
        eyebrow={practice ? 'PRACTICE COMPLETE' : 'SESSION COMPLETE'}
        action={<BrandPattern variant="orbit" width={56} height={56} />}
        subtitle={
          reviewed
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
          <Text style={[s.metric, { fontSize: 72 }]}>{reviewed}</Text>
          <Text style={s.body}>
            {practice
              ? 'cards practiced. Your next review dates are saved.'
              : 'cards reviewed. Your next review dates are saved.'}
          </Text>
        </Panel>
        <Text style={s.editorial}>A little more stays.</Text>
        {!reviewed &&
          data.cards.some((item) => !params.deckId || item.deckId === params.deckId) && (
            <Button
              title="Practice all cards"
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
      subtitle={
        practice
          ? specific && Date.parse(card.schedule.dueAt) > Date.now()
            ? 'Practice · Next scheduled review ' +
              new Date(card.schedule.dueAt).toLocaleDateString()
            : 'Practice includes cards that are not due yet.'
          : undefined
      }
      leading={
        <View style={s.between}>
          <Back label="Finish later" color={colors.paper} />
          <Text style={[s.eyebrow, { color: colors.paper, marginBottom: 0 }]}>
            {String(reviewed + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}
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
        accessibilityValue={{ min: 0, max: total, now: reviewed }}
        accessibilityLabel="Cards reviewed"
        style={{ height: 3, backgroundColor: '#FFFFFF40' }}
      >
        <View
          style={{
            height: 3,
            backgroundColor: colors.yellow,
            width: `${(reviewed / total) * 100}%`,
          }}
        />
      </View>
      <ReviewCard
        key={card.id}
        card={card}
        revealed={revealed}
        disabled={busy || !!reading}
        onFlip={() => {
          if (
            !active.current ||
            !focused.current ||
            saving.current ||
            leaving.current ||
            busy ||
            reading
          )
            return;
          if (!revealed) haptics.reveal();
          else haptics.cancel();
          setRevealedCard(revealed ? null : card.id);
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
            onPress={() => openReading('card')}
          />
        </View>
        {!revealed && !!card.hint && (
          <View style={{ flex: 1 }}>
            <Button
              title="Show a hint"
              variant="secondary"
              size="compact"
              disabled={busy}
              onPress={() => openReading('hint')}
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
              onPress={() => openReading('context')}
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
          onManage={manageCard}
        />
      )}
    </Screen>
  );
}
