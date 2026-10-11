import React from 'react';
import { Text, View } from 'react-native';
import { useStore } from '../src/store';
import { Panel, Screen, colors, s } from '../src/ui';
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
  return (
    <Screen title="Little by little." eyebrow="YOUR PROGRESS">
      <Panel tint>
        <Text style={s.eyebrow}>THE LAST SEVEN DAYS</Text>
        <Text style={[s.metric, { fontSize: 64 }]}>{total}</Text>
        <Text style={s.body}>reviews completed</Text>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-end',
            height: 130,
            gap: 10,
            marginTop: 12,
          }}
        >
          {days.map((day, index) => (
            <View key={day.toDateString()} style={{ flex: 1, alignItems: 'center', gap: 8 }}>
              <Text style={s.caption}>{values[index]}</Text>
              <View
                style={{
                  width: '100%',
                  height: Math.max(4, ((values[index] ?? 0) / Math.max(1, ...values)) * 80),
                  backgroundColor: colors.ink,
                  borderRadius: 6,
                }}
              />
              <Text style={s.caption}>
                {day.toLocaleDateString(undefined, { weekday: 'narrow' })}
              </Text>
            </View>
          ))}
        </View>
      </Panel>
      <Panel>
        <Text style={s.eyebrow}>SELF-RATED RECALL</Text>
        <Text style={s.metric}>{percent === null ? '—' : percent + '%'}</Text>
        <Text style={s.body}>
          {recent.length
            ? recalled + ' of ' + recent.length + ' reviews rated Good or Easy this week.'
            : 'Complete a few reviews to see your recall trend.'}
        </Text>
        <Text style={s.caption}>
          Based on your own ratings, not a test of answer accuracy. Practice mode does not change
          these totals.
        </Text>
      </Panel>
      <View style={s.row}>
        <View style={{ flex: 1 }}>
          <Panel>
            <Text style={s.metric}>{data.decks.length}</Text>
            <Text style={s.caption}>DECKS</Text>
          </Panel>
        </View>
        <View style={{ flex: 1 }}>
          <Panel>
            <Text style={s.metric}>{data.reviews.length}</Text>
            <Text style={s.caption}>RECORDED REVIEWS</Text>
          </Panel>
        </View>
      </View>
      <Panel>
        <Text style={s.sectionTitle}>Showing up adds up.</Text>
        <Text style={s.body}>
          Your review history stays available offline and synchronizes with your account when you
          reconnect.
        </Text>
        <Text style={s.caption}>
          These totals reflect review events in this version. Original-app review records remain in
          your migration archive and are not counted again as new reviews.
        </Text>
      </Panel>
    </Screen>
  );
}
