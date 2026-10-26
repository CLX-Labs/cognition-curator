import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import type { Card } from '@recollect/contracts';
import { Text, colors, s } from './ui';
import { isHorizontalReviewDrag, reviewSwipe } from './review-gesture';
import { useReducedMotion } from './use-reduced-motion';

export default function ReviewCard({
  card,
  revealed,
  disabled,
  onFlip,
  onAnswer,
}: {
  card: Card;
  revealed: boolean;
  disabled: boolean;
  onFlip(): void;
  onAnswer(remembered: boolean): void;
}) {
  const reduceMotion = useReducedMotion();
  const { fontScale } = useWindowDimensions();
  const [width, setWidth] = useState(320);
  const [faceHeight, setFaceHeight] = useState(0);
  const drag = useRef(new Animated.Value(0)).current;
  const flip = useRef(new Animated.Value(1)).current;
  const previousFace = useRef(revealed);
  const dragged = useRef(false);
  const cancelled = useRef(false);
  const latest = useRef({ disabled, onAnswer, width, reduceMotion });
  latest.current = { disabled, onAnswer, width, reduceMotion };

  useEffect(() => {
    const changed = previousFace.current !== revealed;
    previousFace.current = revealed;
    if (reduceMotion || !changed) {
      flip.setValue(1);
      return;
    }
    flip.setValue(0);
    const animation = Animated.timing(flip, {
      toValue: 1,
      duration: 180,
      useNativeDriver: Platform.OS !== 'web',
    });
    animation.start();
    return () => animation.stop();
  }, [revealed, reduceMotion, flip]);
  useEffect(
    () => () => {
      drag.stopAnimation();
      flip.stopAnimation();
    },
    [drag, flip],
  );

  const [responder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gesture) =>
        !latest.current.disabled && isHorizontalReviewDrag(gesture),
      onMoveShouldSetPanResponderCapture: (_, gesture) => {
        if (
          Math.abs(gesture.dx) > 12 ||
          Math.abs(gesture.dy) > 12 ||
          gesture.numberActiveTouches > 1
        )
          dragged.current = true;
        return !latest.current.disabled && isHorizontalReviewDrag(gesture);
      },
      onPanResponderGrant: () => {
        dragged.current = true;
        cancelled.current = false;
        drag.stopAnimation();
      },
      onPanResponderStart: (_, gesture) => {
        if (gesture.numberActiveTouches > 1) {
          cancelled.current = true;
          resetDrag();
        }
      },
      onPanResponderMove: (_, gesture) => {
        if (gesture.numberActiveTouches !== 1) {
          cancelled.current = true;
          resetDrag();
          return;
        }
        if (!latest.current.disabled && !cancelled.current) drag.setValue(gesture.dx);
      },
      onPanResponderRelease: (_, gesture) => {
        const answer = reviewSwipe(gesture, latest.current.width);
        if (!latest.current.disabled && !cancelled.current && answer)
          latest.current.onAnswer(answer === 'remembered');
        resetDrag();
      },
      onPanResponderTerminationRequest: () => true,
      onPanResponderTerminate: () => {
        cancelled.current = true;
        resetDrag();
      },
    }),
  );

  function resetDrag() {
    if (latest.current.reduceMotion) drag.setValue(0);
    else
      Animated.spring(drag, {
        toValue: 0,
        speed: 24,
        bounciness: 0,
        useNativeDriver: Platform.OS !== 'web',
      }).start();
  }

  const turn = drag.interpolate({
    inputRange: [-240, 0, 240],
    outputRange: ['-9deg', '0deg', '9deg'],
    extrapolate: 'clamp',
  });
  const faceTurn = flip.interpolate({ inputRange: [0, 1], outputRange: ['-85deg', '0deg'] });
  const visibleLines = Math.max(
    1,
    Math.floor(faceHeight / ((revealed ? 33 : 40) * Math.max(1, fontScale))),
  );
  return (
    <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={styles.stage}>
      <Animated.View
        testID="review-gesture"
        {...responder.panHandlers}
        style={[
          styles.gesture,
          {
            transform: [
              { perspective: 1000 },
              { translateX: drag },
              { rotate: reduceMotion ? '0deg' : turn },
              { rotateY: faceTurn },
            ],
          },
        ]}
      >
        <Pressable
          testID="review-card"
          accessibilityRole="button"
          accessibilityLabel={
            revealed
              ? 'Answer: ' + card.back
              : 'Front: ' + card.front
          }
          accessibilityHint={
            revealed
              ? 'Tap to flip back. Swipe right if you remember, or left if you are not sure.'
              : 'Tap to show the answer. Swipe right if you remember, or left if you are not sure.'
          }
          accessibilityState={{ disabled, busy: disabled }}
          accessibilityActions={[
            { name: 'remembered', label: 'I remember' },
            { name: 'missed', label: 'Not sure' },
          ]}
          onAccessibilityAction={(event) => {
            if (disabled) return;
            if (event.nativeEvent.actionName === 'remembered') onAnswer(true);
            if (event.nativeEvent.actionName === 'missed') onAnswer(false);
          }}
          disabled={disabled}
          onPressIn={() => {
            dragged.current = false;
          }}
          onPress={() => {
            if (!dragged.current && !disabled) onFlip();
          }}
          style={[styles.card, revealed && { backgroundColor: colors.yellow }]}
        >
          <View style={s.between}>
            <Text
              numberOfLines={1}
              style={[s.eyebrow, { marginBottom: 0, color: colors.ink, flexShrink: 1 }]}
            >
              {revealed ? '02 / ANSWER' : '01 / FRONT'}
            </Text>
            <Text style={[s.caption, { color: colors.ink }]}>↻</Text>
          </View>
          <View
            testID="review-card-face"
            onLayout={(event) => setFaceHeight(event.nativeEvent.layout.height)}
            style={styles.face}
          >
            <Text
              testID="review-card-text"
              numberOfLines={visibleLines}
              ellipsizeMode="tail"
              style={revealed ? styles.answer : styles.question}
            >
              {revealed ? card.back : card.front}
            </Text>
          </View>
          <View style={styles.cardFooter}>
            <Text numberOfLines={1} style={[s.caption, { color: colors.ink, flexShrink: 1 }]}>
              {revealed ? 'Tap to flip back' : 'Tap to reveal the answer'}
            </Text>
            <Text style={{ fontSize: 22, color: colors.accent }}>↗</Text>
          </View>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1, minHeight: 0 },
  gesture: { flex: 1, minHeight: 0 },
  card: {
    flex: 1,
    minHeight: 0,
    borderRadius: 10,
    backgroundColor: colors.paper,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.line,
    gap: 12,
  },
  face: { minHeight: 0, flex: 1, justifyContent: 'center', overflow: 'hidden' },
  question: {
    fontSize: 32,
    lineHeight: 40,
    fontWeight: '800',
    letterSpacing: -1.2,
    color: colors.ink,
  },
  answer: { fontSize: 23, lineHeight: 33, fontWeight: '600', color: colors.ink },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: '#20221E30',
    paddingTop: 10,
  },
});
