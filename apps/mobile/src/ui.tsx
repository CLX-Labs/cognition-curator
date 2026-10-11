import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, usePathname } from 'expo-router';
import { useStore } from './store';

export const colors = {
  background: '#F7F5F0',
  paper: '#FFFFFF',
  ink: '#1C3028',
  muted: '#6C7870',
  accent: '#D65E39',
  pale: '#FCECE3',
  green: '#DDE8D9',
  line: '#E4E7DE',
  danger: '#A43232',
};
export function reportError(error: unknown) {
  Alert.alert('Could not finish', error instanceof Error ? error.message : 'Please try again.');
}
export function Screen({
  children,
  title,
  eyebrow,
  action,
  tabs = true,
}: {
  children: React.ReactNode;
  title?: string;
  eyebrow?: string;
  action?: React.ReactNode;
  tabs?: boolean;
}) {
  const path = usePathname();
  const { data, syncState, sync } = useStore();
  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        {(title || eyebrow) && (
          <View style={s.header}>
            <View style={{ flex: 1 }}>
              {eyebrow && <Text style={s.eyebrow}>{eyebrow.toUpperCase()}</Text>}
              {title && <Text style={s.title}>{title}</Text>}
            </View>
            {action}
          </View>
        )}
        {(data.pending > 0 || data.issues.length > 0 || syncState !== 'idle') && (
          <Pressable
            style={s.sync}
            onPress={() => (data.issues.length ? router.push('/profile') : void sync())}
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
      {tabs && (
        <SafeAreaView edges={['bottom']} style={s.tabs}>
          <View style={s.tabRow}>
            {(
              [
                ['/', '◉', 'Today'],
                ['/decks', '▤', 'Library'],
                ['/progress', '↗', 'Progress'],
                ['/profile', '◎', 'You'],
              ] as const
            ).map(([href, icon, label]) => {
              const active = href === '/' ? path === '/' : path.startsWith(href);
              return (
                <Pressable
                  key={href}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={label}
                  onPress={() => router.replace(href)}
                  style={s.tab}
                >
                  <Text style={[s.tabIcon, active && { color: colors.accent }]}>{icon}</Text>
                  <Text style={[s.tabLabel, active && { color: colors.accent }]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
        </SafeAreaView>
      )}
    </SafeAreaView>
  );
}
export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
}: {
  title: string;
  onPress(): void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        variant === 'secondary' && s.secondary,
        variant === 'danger' && s.danger,
        (disabled || loading) && { opacity: 0.45 },
        pressed && { opacity: 0.8 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'secondary' ? colors.ink : '#fff'} />
      ) : (
        <Text style={[s.buttonText, variant === 'secondary' && { color: colors.ink }]}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}
export function Panel({ children, tint = false }: { children: React.ReactNode; tint?: boolean }) {
  return <View style={[s.panel, tint && { backgroundColor: colors.green }]}>{children}</View>;
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        placeholderTextColor="#94A098"
        {...props}
        style={[
          s.input,
          props.multiline && { minHeight: 104, textAlignVertical: 'top' },
          props.style,
        ]}
      />
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
export function Back({ label = 'Back' }: { label?: string }) {
  return (
    <Pressable
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      style={{ paddingVertical: 8, marginBottom: 12 }}
    >
      <Text style={{ color: colors.accent, fontWeight: '700' }}>← {label}</Text>
    </Pressable>
  );
}
export const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: {
    paddingHorizontal: 24,
    paddingTop: 22,
    paddingBottom: 32,
    gap: 18,
    maxWidth: 760,
    width: '100%',
    alignSelf: 'center',
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  eyebrow: {
    fontSize: 11,
    letterSpacing: 2.2,
    fontWeight: '800',
    color: colors.muted,
    marginBottom: 10,
  },
  title: {
    fontSize: 36,
    lineHeight: 42,
    fontWeight: '700',
    letterSpacing: -1.5,
    color: colors.ink,
  },
  sectionTitle: { fontSize: 21, fontWeight: '700', letterSpacing: -0.5, color: colors.ink },
  body: { fontSize: 15, lineHeight: 23, color: colors.muted },
  caption: { fontSize: 12, lineHeight: 18, color: colors.muted },
  panel: {
    backgroundColor: colors.paper,
    borderRadius: 22,
    padding: 22,
    gap: 14,
    borderWidth: 1,
    borderColor: colors.line,
  },
  button: {
    backgroundColor: colors.ink,
    paddingVertical: 17,
    paddingHorizontal: 20,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 54,
  },
  secondary: { backgroundColor: '#EAEDE5' },
  danger: { backgroundColor: colors.danger },
  buttonText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  label: { fontSize: 13, fontWeight: '700', color: colors.ink },
  input: {
    backgroundColor: '#fff',
    borderColor: '#D5DBD1',
    borderWidth: 1,
    borderRadius: 13,
    padding: 15,
    fontSize: 16,
    color: colors.ink,
  },
  row: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  metric: { fontSize: 38, fontWeight: '700', color: colors.ink, letterSpacing: -1 },
  pill: {
    alignSelf: 'flex-start',
    borderRadius: 20,
    paddingHorizontal: 11,
    paddingVertical: 6,
    backgroundColor: colors.pale,
  },
  pillText: { color: colors.accent, fontSize: 11, fontWeight: '700' },
  tabs: { backgroundColor: colors.paper, borderTopWidth: 1, borderTopColor: colors.line },
  tabRow: {
    flexDirection: 'row',
    maxWidth: 760,
    width: '100%',
    alignSelf: 'center',
    paddingVertical: 9,
  },
  tab: { flex: 1, alignItems: 'center', gap: 5, padding: 5, minHeight: 46 },
  tabIcon: { fontSize: 22, color: colors.muted },
  tabLabel: { fontSize: 10, fontWeight: '700', color: colors.muted },
  sync: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#E8EDE2',
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  syncText: { fontSize: 12, fontWeight: '600', color: colors.ink },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: 6 },
});
