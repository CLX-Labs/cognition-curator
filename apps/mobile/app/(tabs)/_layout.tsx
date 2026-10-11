import React from 'react';
import { Tabs } from 'expo-router/js-tabs';
import BottomNavigation, { tabs } from '../../src/bottom-navigation';
import { colors } from '../../src/ui';

export default function TabLayout() {
  return (
    <Tabs
      initialRouteName="index"
      backBehavior="none"
      screenOptions={{
        headerShown: false,
        animation: 'none',
        lazy: true,
        sceneStyle: { backgroundColor: colors.background },
      }}
      tabBar={(props) => <BottomNavigation {...props} />}
    >
      {tabs.map((tab) => (
        <Tabs.Screen key={tab.name} name={tab.name} options={{ title: tab.label }} />
      ))}
    </Tabs>
  );
}
