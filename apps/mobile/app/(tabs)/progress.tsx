import React from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useStore } from '../../src/store';
import { Button, Panel, Screen, colors, s, Text } from '../../src/ui';
import { BrandPattern } from '../../src/brand-patterns';
export default function Progress() {
  const { data } = useStore();
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() - 6 + i);
    return date;
  });
  const values = days.map(
    (day) =>
      data.reviews.filter((r) => new Date(r.reviewedAt).toDateString() === day.toDateString())
        .length,
  );
  const total = values.reduce((a, b) => a + b, 0);
  const recent = data.reviews.filter(
    (r) => new Date(r.reviewedAt).getTime() >= new Date(days[0]!).setHours(0, 0, 0, 0),
  );
  const recalled = recent.filter((r) => r.rating === 'good' || r.rating === 'easy').length;
  const percent = recent.length ? Math.round((recalled / recent.length) * 100) : null;
  const activeDays = values.filter((value) => value > 0).length;
  const highest = Math.max(1, ...values);
  return (
    <Screen
      title="Your progress"
      eyebrow="03 / LITTLE BY LITTLE"
      action={<BrandPattern variant="orbit" width={56} height={56} />}
      subtitle="Small sessions add up to lasting knowledge."
    >
      <Panel tint>
        <View style={s.between}>
          <Text style={s.label}>This week</Text>
          <Text style={s.caption}>{activeDays} of 7 days active</Text>
        </View>
        <View style={[s.row, { alignItems: 'baseline' }]}>
          <Text style={[s.metric, { fontSize: 58 }]}>{total}</Text>
          <Text style={[s.body, { flex: 1, color: colors.ink }]}>reviews completed</Text>
        </View>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-end',
            height: 130,
            gap: 8,
            marginTop: 4,
          }}
        >
          {days.map((day, index) => (
            <View
              key={day.toDateString()}
              accessible
              accessibilityLabel={
                day.toLocaleDateString(undefined, {
                  weekday: 'long',
                  month: 'short',
                  day: 'numeric',
                }) +
                ': ' +
                values[index] +
                ' reviews'
              }
              style={{ flex: 1, alignItems: 'center', gap: 8 }}
            >
              <Text style={s.caption}>{values[index]}</Text>
              <View
                style={{
                  width: '100%',
                  maxWidth: 28,
                  height: Math.max(4, ((values[index] ?? 0) / highest) * 80),
                  backgroundColor: values[index]
                    ? index === 6
                      ? colors.accent
                      : colors.ink
                    : colors.line,
                  borderRadius: 2,
                }}
              />
              <Text style={[s.caption, { fontSize: 11 }]}>
                {day.toLocaleDateString(undefined, { weekday: 'short' })}
              </Text>
            </View>
          ))}
        </View>
        {!total && (
          <Button
            title="Start practicing"
            variant="secondary"
            onPress={() => router.navigate('/decks')}
          />
        )}
      </Panel>
      <Panel>
        <Text style={s.label}>How well it is sticking</Text>
        <Text style={s.metric}>{percent === null ? '—' : percent + '%'}</Text>
        <Text style={s.body}>
          {recent.length
            ? recalled + ' of ' + recent.length + ' reviews remembered this week.'
            : 'Complete a few reviews to see your recall trend.'}
        </Text>
        <Text style={s.caption}>
          Based on remembered answers during scheduled reviews. Practice mode does not change these
          totals.
        </Text>
      </Panel>
      <View style={s.row}>
        <View style={{ flex: 1 }}>
          <Panel>
            <Text style={s.metric}>{data.decks.length}</Text>
            <Text style={s.caption}>Decks</Text>
          </Panel>
        </View>
        <View style={{ flex: 1 }}>
          <Panel>
            <Text style={s.metric}>{data.reviews.length}</Text>
            <Text style={s.caption}>Reviews all time</Text>
          </Panel>
        </View>
      </View>
      <Panel>
        <Text style={s.sectionTitle}>Keep a little momentum</Text>
        <Text style={s.body}>
          A few cards each day is a good place to start. Review the cards that are due, or practice
          a favorite deck whenever you like.
        </Text>
        <Text style={s.caption}>
          Your history stays available offline and syncs with your account when you reconnect.
        </Text>
      </Panel>
    </Screen>
  );
}
