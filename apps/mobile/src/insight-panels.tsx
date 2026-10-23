import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import type {
  InsightDays,
  RecallCardInsights,
  RecallInsights,
  RecallTrend,
} from '@recollect/contracts';
import { Button, Empty, Field, Panel, Text, colors, s } from './ui';

export function InsightRange({
  days,
  onChange,
}: {
  days: InsightDays;
  onChange(days: InsightDays): void;
}) {
  return (
    <View accessibilityLabel="Insight time range" style={[s.row, { gap: 8 }]}>
      {([7, 30, 90, null] as const).map((value) => (
        <Pressable
          key={value ?? 'all'}
          accessibilityRole="button"
          accessibilityState={{ selected: value === days }}
          accessibilityLabel={value === null ? 'All recorded history' : `Last ${value} days`}
          onPress={() => onChange(value)}
          style={{
            flex: 1,
            minHeight: 44,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 8,
            backgroundColor: value === days ? colors.ink : colors.paper,
            borderWidth: 1,
            borderColor: colors.line,
          }}
        >
          <Text
            style={{
              fontSize: 13,
              fontWeight: '700',
              color: value === days ? colors.paper : colors.ink,
            }}
          >
            {value === null ? 'All time' : `${value} days`}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export function trendLabel(trend: RecallTrend) {
  if (trend.direction === 'insufficient') return 'Building a history';
  if (trend.direction === 'steady') return 'Holding steady';
  return `${trend.direction === 'improving' ? '↑ Improving' : '↓ More uncertainty'} · ${Math.abs(Math.round(trend.changePoints ?? 0))} points`;
}

export function InsightSummary({ insights }: { insights: RecallInsights }) {
  const summary = insights.summary;
  const periods = insights.weekly.slice(-8);
  const highest = Math.max(1, ...periods.map((period) => period.reviewCount));
  return (
    <>
      <Panel tint>
        <Text style={s.eyebrow}>SELF-REPORTED RECALL</Text>
        <View style={[s.row, { alignItems: 'baseline' }]}>
          <Text style={[s.metric, { fontSize: 58 }]}>
            {summary.recallRate === null ? '—' : `${Math.round(summary.recallRate)}%`}
          </Text>
          <Text style={[s.body, { flex: 1 }]}>
            {summary.rememberedCount} remembered{'\n'}of {summary.reviewCount} responses
          </Text>
        </View>
        <Text style={s.label}>{trendLabel(summary.trend)}</Text>
        <Text style={s.caption}>
          {summary.trend.direction === 'insufficient'
            ? 'A trend needs at least three responses in both this period and the previous period.'
            : `Compared with the preceding ${summary.trend.comparisonDays} days. Recall reflects how responses were rated.`}
        </Text>
      </Panel>
      <View style={[s.row, { alignItems: 'stretch' }]}>
        <View style={{ flex: 1 }}>
          <Panel style={{ flex: 1, padding: 16 }}>
            <Text style={s.metric}>{summary.repeatUnsureCardCount}</Text>
            <Text style={s.caption}>Cards repeatedly unsure</Text>
          </Panel>
        </View>
        <View style={{ flex: 1 }}>
          <Panel style={{ flex: 1, padding: 16 }}>
            <Text style={s.metric}>{summary.consistentRememberedCardCount}</Text>
            <Text style={s.caption}>Cards consistently remembered</Text>
          </Panel>
        </View>
      </View>
      <Text style={s.caption}>
        {summary.reviewedCardCount} of {summary.cardCount} cards reviewed · {summary.activeDays}{' '}
        days active in this period.
      </Text>
      <Panel>
        <Text style={s.sectionTitle}>Recall over time</Text>
        <Text style={s.caption}>
          Weekly responses ·{' '}
          {periods.length > 0
            ? 'up to the last eight weeks in this range'
            : 'your history will appear here'}
        </Text>
        {periods.length > 0 ? (
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, minHeight: 130 }}>
            {periods.map((period) => (
              <View
                key={period.weekStart}
                accessible
                accessibilityLabel={`Week of ${period.weekStart}: ${period.rememberedCount} remembered, ${period.unsureCount} unsure`}
                style={{ flex: 1, alignItems: 'center', gap: 7 }}
              >
                <Text style={[s.caption, { fontSize: 11 }]}>{period.reviewCount}</Text>
                <View
                  style={{
                    width: '100%',
                    maxWidth: 28,
                    justifyContent: 'flex-end',
                    height: Math.max(3, (period.reviewCount / highest) * 80),
                    backgroundColor: colors.line,
                    borderRadius: 3,
                    overflow: 'hidden',
                  }}
                >
                  <View
                    style={{
                      height: `${(period.unsureCount / Math.max(1, period.reviewCount)) * 100}%`,
                      backgroundColor: colors.lilac,
                    }}
                  />
                  <View
                    style={{
                      height: `${(period.rememberedCount / Math.max(1, period.reviewCount)) * 100}%`,
                      backgroundColor: colors.accent,
                    }}
                  />
                </View>
                <Text style={[s.caption, { fontSize: 10 }]}>{period.weekStart.slice(5)}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={s.body}>Complete a few reviews to start seeing patterns.</Text>
        )}
        <Text style={s.caption}>Cobalt: remembered · Lilac: unsure</Text>
      </Panel>
      {insights.excludedEditedCardCount > 0 && (
        <Text style={s.caption}>
          {insights.excludedEditedCardCount} cards changed after sharing and are excluded from this
          shared view. Personal edits stay private.
        </Text>
      )}
    </>
  );
}

type CardFilter = 'all' | 'unsure' | 'consistent' | 'improving';
export function InsightCards({
  insights,
  onSelect,
}: {
  insights: RecallInsights;
  onSelect(card: RecallCardInsights): void;
}) {
  const [filter, setFilter] = useState<CardFilter>('all');
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(20);
  const cards = useMemo(
    () =>
      insights.cards
        .filter((card) => {
          if (filter === 'unsure' && !card.repeatUnsure) return false;
          if (filter === 'consistent' && !card.consistentRemembered) return false;
          if (filter === 'improving' && card.trend.direction !== 'improving') return false;
          return `${card.front} ${card.back} ${card.deckName}`
            .toLocaleLowerCase()
            .includes(search.trim().toLocaleLowerCase());
        })
        .sort(
          (a, b) =>
            Number(b.repeatUnsure) - Number(a.repeatUnsure) ||
            b.unsureCount - a.unsureCount ||
            a.front.localeCompare(b.front),
        ),
    [insights, filter, search],
  );
  return (
    <>
      <View style={s.between}>
        <Text style={s.sectionTitle}>Card by card</Text>
        <Text style={s.caption}>{cards.length} cards</Text>
      </View>
      <Text style={s.caption}>
        Repeatedly unsure: at least two of the last three responses. Consistent: at least three
        remembered in a row, within this range.
      </Text>
      <Field
        label="Find a card"
        placeholder="Card title, answer, or deck"
        value={search}
        onChangeText={(value) => {
          setSearch(value);
          setLimit(20);
        }}
      />
      <View style={[s.row, { flexWrap: 'wrap', gap: 8 }]}>
        {(
          [
            ['all', 'All cards'],
            ['unsure', 'Needs practice'],
            ['consistent', 'Consistent'],
            ['improving', 'Improving'],
          ] as const
        ).map(([value, title]) => (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityState={{ selected: filter === value }}
            onPress={() => {
              setFilter(value);
              setLimit(20);
            }}
            style={{
              minHeight: 44,
              paddingHorizontal: 13,
              justifyContent: 'center',
              borderRadius: 22,
              backgroundColor: filter === value ? colors.ink : colors.paper,
              borderWidth: 1,
              borderColor: colors.line,
            }}
          >
            <Text
              style={{
                fontSize: 12,
                fontWeight: '600',
                color: filter === value ? colors.paper : colors.ink,
              }}
            >
              {title}
            </Text>
          </Pressable>
        ))}
      </View>
      {cards.slice(0, limit).map((card) => (
        <Pressable
          key={card.id}
          accessibilityRole="button"
          accessibilityLabel={`Recall history for ${card.front}, ${card.rememberedCount} remembered, ${card.unsureCount} unsure`}
          onPress={() => onSelect(card)}
        >
          <Panel style={{ gap: 8 }}>
            <Text style={s.eyebrow} numberOfLines={1}>
              {card.deckName}
            </Text>
            <View style={s.between}>
              <Text numberOfLines={2} style={[s.label, { fontSize: 18, lineHeight: 24, flex: 1 }]}>
                {card.front}
              </Text>
              <Text style={s.body}>↗</Text>
            </View>
            <Text style={s.caption}>
              {card.reviewCount
                ? `${card.rememberedCount} remembered · ${card.unsureCount} unsure · ${Math.round(card.recallRate ?? 0)}% recall`
                : 'No recorded responses in this period'}
            </Text>
            {card.reviewCount > 0 && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
                {card.history.slice(-10).map((event) => (
                  <View
                    key={event.id}
                    accessible
                    accessibilityLabel={`${event.reviewedAt}: ${event.remembered ? 'remembered' : 'unsure'}`}
                    style={{
                      width: 13,
                      height: 13,
                      borderRadius: 7,
                      backgroundColor: event.remembered ? colors.accent : colors.lilac,
                      borderWidth: 1,
                      borderColor: event.remembered ? colors.accent : colors.muted,
                    }}
                  />
                ))}
              </View>
            )}
            <Text style={s.caption}>
              {card.repeatUnsure
                ? '↺ Repeated uncertainty'
                : card.consistentRemembered
                  ? '✓ Consistently remembered'
                  : trendLabel(card.trend)}
            </Text>
          </Panel>
        </Pressable>
      ))}
      {!cards.length && (
        <Empty title="No cards in this view" detail="Try another time range or filter." />
      )}
      {cards.length > limit && (
        <Button
          title={`Show more (${cards.length - limit} remaining)`}
          variant="secondary"
          onPress={() => setLimit((value) => value + 20)}
        />
      )}
    </>
  );
}

export function InsightCardHistory({ card }: { card: RecallCardInsights }) {
  const events = [...card.history].reverse();
  return (
    <>
      <Panel tint>
        <Text style={s.eyebrow}>{card.deckName}</Text>
        <Text style={s.sectionTitle}>{card.front}</Text>
        <Text style={s.body}>{card.back}</Text>
      </Panel>
      <Panel>
        <Text style={s.sectionTitle}>
          {card.recallRate === null
            ? 'No recall history yet'
            : `${Math.round(card.recallRate)}% self-reported recall`}
        </Text>
        <Text style={s.body}>
          {card.rememberedCount} remembered · {card.unsureCount} unsure · {card.reviewCount}{' '}
          responses
        </Text>
        <Text style={s.label}>{trendLabel(card.trend)}</Text>
        <Text style={s.caption}>
          Current run:{' '}
          {card.rememberedStreak
            ? `${card.rememberedStreak} remembered`
            : card.unsureStreak
              ? `${card.unsureStreak} unsure`
              : 'no responses'}
          .
        </Text>
      </Panel>
      <Text style={s.sectionTitle}>Response history</Text>
      <Text style={s.caption}>
        Latest first. Card text reflects the current shared version or your current card; older
        responses may predate edits.
      </Text>
      {events.map((event) => (
        <View
          key={event.id}
          style={[
            s.between,
            { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.line },
          ]}
        >
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={s.label}>
              {event.remembered ? '✓ Remembered' : '↺ Not sure'}
              {event.rating === 'hard' ? ' (hard)' : event.rating === 'easy' ? ' (easy)' : ''}
            </Text>
            <Text style={s.caption}>{new Date(event.reviewedAt).toLocaleString()}</Text>
          </View>
          <Text style={s.caption}>{Math.round(event.elapsedMs / 1000)}s</Text>
        </View>
      ))}
      {!events.length && (
        <Empty
          title="A fresh start"
          detail="This card has no recorded responses in the selected period."
        />
      )}
      {card.historyTruncated && (
        <Text style={s.caption}>
          Showing the latest 100 of {card.historyTotal} responses in this period. Totals include
          every recorded response.
        </Text>
      )}
    </>
  );
}
