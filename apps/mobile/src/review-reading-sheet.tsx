import React from 'react';
import { Modal, Pressable, ScrollView, StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
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
  const label =
    section === 'hint'
      ? 'HINT'
      : section === 'context'
        ? 'CONTEXT'
        : revealed
          ? 'ANSWER'
          : card.aiGenerated
            ? 'CONCEPT'
            : 'QUESTION';
  const showQuestion = section !== 'card' || revealed;
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
      <SafeAreaProvider>
        <StatusBar barStyle="dark-content" />
        <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>
          <View style={styles.container} accessibilityViewIsModal onAccessibilityEscape={onClose}>
            <View style={styles.header}>
              <Pressable
                testID="review-reader-close"
                accessibilityRole="button"
                accessibilityLabel="Back to review"
                onPress={onClose}
                style={({ pressed }) => [styles.close, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.closeText}>← Back to review</Text>
              </Pressable>
            </View>
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.content}
              contentInsetAdjustmentBehavior="never"
              showsVerticalScrollIndicator
            >
              <View style={[styles.page, revealed && section === 'card' && styles.answerPage]}>
                {showQuestion && (
                  <Text
                    testID="review-reader-question"
                    accessibilityRole="header"
                    style={styles.question}
                  >
                    {card.front}
                  </Text>
                )}
                <View style={[styles.section, showQuestion && styles.divided]}>
                  <Text style={[s.eyebrow, styles.eyebrow]}>{label}</Text>
                  <Text
                    testID="review-reader-text"
                    accessibilityRole={showQuestion ? undefined : 'header'}
                    selectable
                    style={showQuestion ? styles.body : styles.front}
                  >
                    {content}
                  </Text>
                </View>
              </View>
            </ScrollView>
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  eyebrow: { marginBottom: 0, color: colors.muted },
  close: {
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: 10,
    paddingRight: 16,
  },
  closeText: { color: colors.accent, fontWeight: '700', fontSize: 15, lineHeight: 22 },
  scroll: { flex: 1 },
  content: { padding: 20, paddingBottom: 32, flexGrow: 1 },
  page: {
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
    backgroundColor: colors.paper,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 24,
    gap: 24,
  },
  answerPage: { backgroundColor: colors.yellow },
  question: { fontSize: 22, lineHeight: 32, fontWeight: '700', color: colors.ink },
  section: { gap: 16 },
  divided: { paddingTop: 24, borderTopWidth: 1, borderTopColor: colors.line },
  front: { fontSize: 28, lineHeight: 39, fontWeight: '700', color: colors.ink },
  body: { fontSize: 21, lineHeight: 33, color: colors.ink },
});
