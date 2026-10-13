import React from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useSegments } from 'expo-router';
import { useStore } from './store';

export const colors = {
  background: '#F7F5EF',
  paper: '#FFFFFF',
  ink: '#203C31',
  muted: '#65746A',
  accent: '#AE492D',
  pale: '#FAEADF',
  green: '#E6EDDF',
  line: '#E2E6DD',
  danger: '#A43232',
};
export function reportError(error: unknown) {
  Alert.alert(
    'Could not finish',
    error instanceof Error ? error.message : 'Please try again.',
  );
}
export function Screen({
  children,
  title,
  eyebrow,
  action,
  leading,
  subtitle,
  footer,
  scrollRef,
}: {
  children: React.ReactNode;
  title?: string;
  eyebrow?: string;
  action?: React.ReactNode;
  leading?: React.ReactNode;
  subtitle?: string;
  footer?: React.ReactNode;
  scrollRef?: React.Ref<ScrollView>;
}) {
  const { data, syncState, sync } = useStore();
  const segments = useSegments();
  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={s.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          {leading}
          {(title || eyebrow || subtitle) && (
            <View style={s.header}>
              <View style={{ flex: 1 }}>
                {eyebrow && <Text style={s.eyebrow}>{eyebrow.toUpperCase()}</Text>}
                {title && <Text style={s.title}>{title}</Text>}
                {subtitle && <Text style={[s.body, { marginTop: 10 }]}>{subtitle}</Text>}
              </View>
              {action}
            </View>
          )}
          {(data.pending > 0 || data.issues.length > 0 || syncState !== 'idle') && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                data.issues.length ? 'Review synchronization issues' : 'Synchronize library'
              }
              style={s.sync}
              onPress={() => {
                if (!data.issues.length) void sync();
                else if (segments[0] === '(tabs)') router.navigate('/profile');
                else router.dismissTo('/profile');
              }}
            >
              <Text style={s.syncText}>
                {data.issues.length
                  ? data.issues.length + ' changes need attention'
                  : syncState === 'syncing'
                    ? 'Synchronizing your library…'
                    : data.pending
                      ? data.pending + ' changes saved on this device'
                      : 'Offline · your library is available'}
              </Text>
              <Text style={s.syncText}>↗</Text>
            </Pressable>
          )}
          {children}
        </ScrollView>
        {footer && (
          <SafeAreaView edges={segments[0] === '(tabs)' ? [] : ['bottom']} style={s.footer}>
            <View style={s.footerContent}>{footer}</View>
          </SafeAreaView>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  size = 'normal',
}: {
  title: string;
  onPress(): void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'compact' | 'normal';
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        variant === 'secondary' && s.secondary,
        variant === 'danger' && s.danger,
        variant === 'ghost' && s.ghost,
        size === 'compact' && s.compactButton,
        (disabled || loading) && { opacity: 0.45 },
        pressed && { opacity: 0.8 },
      ]}
    >
      <View style={s.buttonContents}>
        {loading && (
          <ActivityIndicator
            color={variant === 'secondary' || variant === 'ghost' ? colors.ink : '#fff'}
          />
        )}
        <Text
          style={[
            s.buttonText,
            size === 'compact' && { fontSize: 14, lineHeight: 20 },
            (variant === 'secondary' || variant === 'ghost') && { color: colors.ink },
          ]}
        >
          {title}
        </Text>
      </View>
    </Pressable>
  );
}
export function Panel({
  children,
  tint = false,
  style,
}: {
  children: React.ReactNode;
  tint?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[s.panel, tint && { backgroundColor: colors.green }, style]}>{children}</View>
  );
}
export function Field({
  label,
  hint,
  labelAction,
  inputRef,
  ...props
}: TextInputProps & {
  label: string;
  hint?: string;
  labelAction?: React.ReactNode;
  inputRef?: React.Ref<TextInput>;
}) {
  return (
    <View style={{ gap: 8 }}>
      <View style={s.between}>
        <Text style={[s.label, { flexShrink: 1 }]}>{label}</Text>
        {labelAction}
      </View>
      <TextInput
        ref={inputRef}
        accessibilityLabel={label}
        placeholderTextColor="#79857D"
        {...props}
        style={[
          s.input,
          props.multiline && { minHeight: 104, textAlignVertical: 'top' },
          props.style,
        ]}
      />
      {hint && <Text style={s.caption}>{hint}</Text>}
    </View>
  );
}
export function Empty({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: React.ReactNode;
}) {
  return (
    <Panel>
      <Text style={s.sectionTitle}>{title}</Text>
      <Text style={s.body}>{detail}</Text>
      {action}
    </Panel>
  );
}
export function Back({ label = 'Back', onPress }: { label?: string; onPress?(): void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress ?? (() => (router.canGoBack() ? router.back() : router.replace('/')))}
      style={({ pressed }) => [s.back, pressed && { opacity: 0.65 }]}
    >
      <Text style={{ color: colors.accent, fontWeight: '700', fontSize: 15 }}>← {label}</Text>
    </Pressable>
  );
}
export const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: {
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 32,
    gap: 20,
    maxWidth: 760,
    width: '100%',
    alignSelf: 'center',
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, marginBottom: 4 },
  footer: {
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  footerContent: {
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    paddingHorizontal: 22,
    paddingVertical: 12,
    gap: 10,
  },
  back: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', paddingRight: 16 },
  eyebrow: {
    fontSize: 12,
    lineHeight: 17,
    letterSpacing: 1.6,
    fontWeight: '800',
    color: colors.muted,
    marginBottom: 9,
  },
  title: {
    fontSize: 33,
    lineHeight: 39,
    fontWeight: '700',
    letterSpacing: -1.1,
    color: colors.ink,
  },
  sectionTitle: {
    fontSize: 21,
    lineHeight: 27,
    fontWeight: '700',
    letterSpacing: -0.5,
    color: colors.ink,
  },
  body: { fontSize: 16, lineHeight: 24, color: colors.muted },
  caption: { fontSize: 13, lineHeight: 19, color: colors.muted },
  panel: {
    backgroundColor: colors.paper,
    borderRadius: 24,
    padding: 20,
    gap: 14,
    borderWidth: 1,
    borderColor: colors.line,
  },
  button: {
    backgroundColor: colors.ink,
    paddingVertical: 15,
    paddingHorizontal: 20,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 54,
  },
  secondary: { backgroundColor: '#E9EEE3' },
  danger: { backgroundColor: colors.danger },
  ghost: { backgroundColor: 'transparent' },
  compactButton: {
    minHeight: 44,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 13,
  },
  buttonContents: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  buttonText: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
    flexShrink: 1,
  },
  label: { fontSize: 14, lineHeight: 20, fontWeight: '700', color: colors.ink },
  input: {
    backgroundColor: '#fff',
    borderColor: '#D5DBD1',
    borderWidth: 1,
    borderRadius: 16,
    padding: 15,
    fontSize: 16,
    color: colors.ink,
    minHeight: 54,
  },
  row: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  between: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  metric: { fontSize: 38, fontWeight: '700', color: colors.ink, letterSpacing: -1.2 },
  pill: {
    alignSelf: 'flex-start',
    borderRadius: 20,
    paddingHorizontal: 11,
    paddingVertical: 7,
    backgroundColor: colors.pale,
  },
  pillText: { color: colors.accent, fontSize: 12, lineHeight: 16, fontWeight: '700' },
  tabs: { backgroundColor: colors.paper, borderTopWidth: 1, borderTopColor: colors.line },
  tabRow: {
    flexDirection: 'row',
    maxWidth: 760,
    width: '100%',
    alignSelf: 'center',
    paddingVertical: 8,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    paddingVertical: 3,
    paddingHorizontal: 2,
    minHeight: 58,
  },
  tabIconWell: {
    width: 44,
    height: 30,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabIcon: { fontSize: 23, lineHeight: 27, color: colors.muted },
  tabLabel: { fontSize: 11, lineHeight: 16, fontWeight: '600', color: colors.muted },
  sync: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#E8EDE2',
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 44,
  },
  syncText: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
    color: colors.ink,
    flexShrink: 1,
  },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: 6 },
});
