import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { colors, s } from './ui';

export const tabs = [
  { name: 'index', icon: '◉', label: 'Today' },
  { name: 'decks', icon: '▤', label: 'Practice' },
  { name: 'generate', icon: '+', label: 'Create' },
  { name: 'progress', icon: '↗', label: 'Progress' },
  { name: 'profile', icon: '◎', label: 'You' },
] as const;

export default function BottomNavigation({ state, navigation }: BottomTabBarProps) {
  return (
    <SafeAreaView edges={['bottom', 'left', 'right']} style={s.tabs}>
      <View style={s.tabRow}>
        {state.routes.map((route, index) => {
          const tab = tabs.find((tab) => tab.name === route.name);
          if (!tab) return null;
          const active = state.index === index;
          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={tab.label}
              onPress={() => {
                const event = navigation.emit({
                  type: 'tabPress',
                  target: route.key,
                  canPreventDefault: true,
                });
                if (!active && !event.defaultPrevented) navigation.navigate(route.name);
              }}
              onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
              style={s.tab}
            >
              <Text style={[s.tabIcon, active && { color: colors.accent }]}>{tab.icon}</Text>
              <Text style={[s.tabLabel, active && { color: colors.accent }]}>{tab.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}
