import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Card } from '@recollect/contracts';
import { Text, colors, s } from './ui';
import { useReducedMotion } from './use-reduced-motion';

export type ReviewReadingSection = 'card' | 'hint' | 'context';

export function ReviewReadingSheet({
  card,
  revealed,
  section,
  onClose,
}: {
  card: Card;
  revealed: boolean;
  section: ReviewReadingSection;
  onClose(): void;
}) {
  const reduceMotion = useReducedMotion();
  const title =
    section === 'hint'
      ? 'A small hint'
      : section === 'context'
        ? 'A little more context'
        : revealed
          ? 'The answer'
          : card.aiGenerated
            ? 'The concept'
            : 'The question';
  const content =
    section === 'hint'
      ? card.hint
      : section === 'context'
        ? card.explanation
        : revealed
          ? card.back
          : card.front;

  return (
    <Modal
      testID="review-reader"
      visible
      presentationStyle="fullScreen"
      animationType={reduceMotion ? 'none' : 'fade'}
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>
        <View style={styles.container} accessibilityViewIsModal>
          <View style={styles.header}>
            <Text style={[s.eyebrow, styles.eyebrow]}>READ IN FULL</Text>
            <Pressable
              testID="review-reader-close"
              accessibilityRole="button"
              accessibilityLabel="Close reading"
              onPress={onClose}
              style={({ pressed }) => [styles.close, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.closeText}>Close reading ×</Text>
            </Pressable>
          </View>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator
          >
            <Text accessibilityRole="header" style={styles.title}>
              {title}
            </Text>
            <Text testID="review-reader-text" selectable style={styles.body}>
              {content}
            </Text>
          </ScrollView>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  container: { flex: 1, width: '100%', maxWidth: 760, alignSelf: 'center' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 22,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  eyebrow: { marginBottom: 0, flexShrink: 1 },
  close: {
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: 10,
    paddingLeft: 8,
    flexShrink: 1,
  },
  closeText: { color: colors.accent, fontWeight: '700', fontSize: 15, lineHeight: 22 },
  scroll: { flex: 1 },
  content: { padding: 22, paddingBottom: 32, gap: 20 },
  title: { fontSize: 28, lineHeight: 36, fontWeight: '800', color: colors.ink },
  body: { fontSize: 21, lineHeight: 32, color: colors.ink },
});
