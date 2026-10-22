import React, { useContext } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text as NativeText,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useSegments } from 'expo-router';
import { useStore } from './store';
import { colors, fonts, TypographyContext } from './brand';

export { colors, fonts } from './brand';

export function Text({ style, ...props }: TextProps) {
  const loaded = useContext(TypographyContext);
  const resolved = StyleSheet.flatten(style);
  const weight = Number(resolved?.fontWeight ?? 400);
  const family =
    resolved?.fontFamily ??
    (weight >= 800
      ? fonts.extraBold
      : weight >= 700
        ? fonts.bold
        : weight >= 500
          ? fonts.semibold
          : fonts.regular);
  const custom = Object.values(fonts).includes(family) && family !== fonts.mono;
  return (
    <NativeText
      {...props}
      style={[
        { color: colors.ink },
        style,
        custom && {
          fontFamily: loaded ? family : undefined,
          fontWeight: loaded ? 'normal' : resolved?.fontWeight,
        },
      ]}
    />
  );
}
export function reportError(error: unknown) {
  Alert.alert('Could not finish', error instanceof Error ? error.message : 'Please try again.');
}
export function BrandHeader() {
  return (
    <View
      style={[
        s.between,
        { paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: colors.line },
      ]}
    >
      <View style={[s.row, { gap: 8 }]}>
        <Image
          source={require('../assets/icon.png')}
          accessible={false}
          style={{ width: 30, height: 30, borderRadius: 7 }}
        />
        <Text style={s.wordmark}>recollect</Text>
      </View>
      <Text style={[s.eyebrow, { marginBottom: 0, letterSpacing: 0.4 }]}>FOR THE CURIOUS</Text>
    </View>
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
  scrollable = true,
  syncFeedback = 'all',
  appearance = 'default',
}: {
  children: React.ReactNode;
  title?: string;
  eyebrow?: string;
  action?: React.ReactNode;
  leading?: React.ReactNode;
  subtitle?: string;
  footer?: React.ReactNode;
  scrollRef?: React.Ref<ScrollView>;
  scrollable?: boolean;
  syncFeedback?: 'all' | 'errors';
  appearance?: 'default' | 'focus';
}) {
  const { data, syncState, sync } = useStore();
  const segments = useSegments();
  const showSyncFeedback =
    data.issues.length > 0 ||
    syncState === 'offline' ||
    (syncFeedback === 'all' && (data.pending > 0 || syncState === 'syncing'));
  const contentStyle = [
    s.content,
    appearance === 'focus' && { gap: 14, paddingTop: 6 },
    !scrollable && { flex: 1, minHeight: 0, paddingTop: 6, paddingBottom: 12, gap: 10 },
  ];
  const content = (
    <>
      {leading}
      {(title || eyebrow || subtitle) && (
        <View
          style={[
            s.header,
            appearance === 'focus' && { borderBottomColor: '#FFFFFF40', paddingBottom: 14 },
            !scrollable && { paddingBottom: 8 },
          ]}
        >
          <View style={{ flex: 1, minWidth: 0 }}>
            {eyebrow && (
              <Text
                style={[
                  s.eyebrow,
                  appearance === 'focus' && { color: colors.paper },
                  !scrollable && { marginBottom: 4 },
                ]}
              >
                {eyebrow.toUpperCase()}
              </Text>
            )}
            {title && (
              <Text
                numberOfLines={!scrollable && appearance === 'focus' ? 1 : undefined}
                accessibilityLabel={title}
                style={[
                  s.title,
                  appearance === 'focus' && {
                    color: colors.paper,
                    fontSize: scrollable ? 32 : 24,
                    lineHeight: scrollable ? 38 : 30,
                  },
                ]}
              >
                {title}
              </Text>
            )}
            {subtitle && (
              <Text
                style={[
                  s.body,
                  { marginTop: 10 },
                  appearance === 'focus' && { color: colors.paper },
                ]}
              >
                {subtitle}
              </Text>
            )}
          </View>
          {action}
        </View>
      )}
      {showSyncFeedback && (
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
              : syncState === 'offline'
                ? 'Offline · your library is available'
                : syncState === 'syncing'
                  ? 'Synchronizing your library…'
                  : data.pending + ' changes saved on this device'}
          </Text>
          <Text style={s.syncText}>↗</Text>
        </Pressable>
      )}
      {children}
    </>
  );
  return (
    <SafeAreaView
      style={[s.safe, appearance === 'focus' && { backgroundColor: colors.accent }]}
      edges={['top', 'left', 'right']}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {scrollable ? (
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={contentStyle}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
          >
            {content}
          </ScrollView>
        ) : (
          <View testID="fixed-screen-content" style={contentStyle}>
            {content}
          </View>
        )}
        {footer && (
          <SafeAreaView
            edges={segments[0] === '(tabs)' ? [] : ['bottom']}
            style={[
              s.footer,
              appearance === 'focus' && {
                backgroundColor: colors.accent,
                borderTopColor: '#FFFFFF40',
              },
            ]}
          >
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
  variant?: 'primary' | 'secondary' | 'highlight' | 'danger' | 'ghost';
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
        variant === 'highlight' && { backgroundColor: colors.yellow },
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
            color={
              variant === 'secondary' || variant === 'ghost' || variant === 'highlight'
                ? colors.ink
                : colors.paper
            }
          />
        )}
        <Text
          style={[
            s.buttonText,
            size === 'compact' && { fontSize: 14, lineHeight: 20 },
            (variant === 'secondary' || variant === 'ghost' || variant === 'highlight') && {
              color: colors.ink,
            },
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
    <View style={[s.panel, tint && { backgroundColor: colors.yellow }, style]}>{children}</View>
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
  const fontsLoaded = useContext(TypographyContext);
  return (
    <View style={{ gap: 8 }}>
      <View style={s.between}>
        <Text style={[s.label, { flexShrink: 1 }]}>{label}</Text>
        {labelAction}
      </View>
      <TextInput
        ref={inputRef}
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        {...props}
        style={[
          s.input,
          !fontsLoaded && { fontFamily: undefined },
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
export function Back({
  label = 'Back',
  onPress,
  color = colors.accent,
}: {
  label?: string;
  onPress?(): void;
  color?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress ?? (() => (router.canGoBack() ? router.back() : router.replace('/')))}
      style={({ pressed }) => [s.back, pressed && { opacity: 0.65 }]}
    >
      <Text style={{ color, fontWeight: '700', fontSize: 15 }}>← {label}</Text>
    </Pressable>
  );
}
export const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: {
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 32,
    gap: 24,
    maxWidth: 760,
    width: '100%',
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    paddingBottom: 22,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
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
    fontFamily: fonts.mono,
    fontSize: 10,
    lineHeight: 17,
    letterSpacing: 1.2,
    fontWeight: '400',
    color: colors.muted,
    marginBottom: 9,
  },
  title: {
    fontSize: 38,
    lineHeight: 43,
    fontWeight: '800',
    letterSpacing: -1.7,
    color: colors.ink,
  },
  editorial: {
    fontFamily: fonts.editorial,
    fontSize: 58,
    lineHeight: 64,
    fontWeight: '400',
    letterSpacing: -1.3,
    color: colors.accent,
  },
  wordmark: {
    fontSize: 25,
    lineHeight: 32,
    fontWeight: '800',
    letterSpacing: -1.5,
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
    borderRadius: 8,
    padding: 20,
    gap: 14,
    borderWidth: 1,
    borderColor: colors.line,
  },
  button: {
    backgroundColor: colors.accent,
    paddingVertical: 15,
    paddingHorizontal: 20,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 54,
  },
  secondary: { backgroundColor: colors.pale },
  danger: { backgroundColor: colors.danger },
  ghost: { backgroundColor: 'transparent' },
  compactButton: {
    minHeight: 44,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 6,
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
    color: colors.paper,
    textAlign: 'center',
    flexShrink: 1,
  },
  label: { fontSize: 14, lineHeight: 20, fontWeight: '700', color: colors.ink },
  input: {
    backgroundColor: colors.paper,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 8,
    padding: 15,
    fontSize: 16,
    color: colors.ink,
    fontFamily: fonts.regular,
    minHeight: 54,
  },
  row: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  between: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  metric: { fontSize: 42, fontWeight: '800', color: colors.ink, letterSpacing: -2 },
  pill: {
    alignSelf: 'flex-start',
    borderRadius: 4,
    paddingHorizontal: 11,
    paddingVertical: 6,
    backgroundColor: colors.pale,
  },
  pillText: {
    color: colors.accent,
    fontFamily: fonts.mono,
    fontSize: 10,
    lineHeight: 16,
    fontWeight: '400',
    letterSpacing: 0.5,
  },
  tabs: { backgroundColor: colors.background, borderTopWidth: 1, borderTopColor: colors.line },
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
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabIcon: { fontSize: 23, lineHeight: 27, color: colors.muted },
  tabLabel: { fontSize: 11, lineHeight: 16, fontWeight: '600', color: colors.muted },
  sync: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: colors.yellow,
    borderRadius: 6,
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
