import React, { useEffect, useRef } from 'react';
import { Animated, Platform, StyleSheet } from 'react-native';
import { Text, colors } from './ui';
import { useReducedMotion } from './use-reduced-motion';

export type ReviewFeedback = { id: number; remembered: boolean };

export function ReviewFeedbackCue({ feedback }: { feedback: ReviewFeedback | null }) {
  const reduceMotion = useReducedMotion();
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    opacity.setValue(1);
    if (!feedback || reduceMotion) return;
    const animation = Animated.timing(opacity, {
      toValue: 0,
      delay: 360,
      duration: 140,
      useNativeDriver: Platform.OS !== 'web',
    });
    animation.start();
    return () => animation.stop();
  }, [feedback, reduceMotion, opacity]);

  if (!feedback) return null;
  return (
    <Animated.View
      testID="review-feedback"
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.badge,
        { backgroundColor: feedback.remembered ? colors.yellow : colors.lilac, opacity },
      ]}
    >
      <Text style={styles.label}>{feedback.remembered ? '✓ Remembered' : '↺ Review later'}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    top: -40,
    right: 22,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  label: { color: colors.ink, fontSize: 13, lineHeight: 18, fontWeight: '700' },
});
