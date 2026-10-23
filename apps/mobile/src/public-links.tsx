import React from 'react';
import { Linking, View } from 'react-native';
import { Button, reportError, s } from './ui';

export default function PublicLinks() {
  return (
    <View style={s.row}>
      <View style={{ flex: 1 }}>
        <Button
          title="Privacy policy"
          variant="ghost"
          size="compact"
          onPress={() =>
            void Linking.openURL('https://recollect-ai.netlify.app/privacy/').catch(reportError)
          }
        />
      </View>
      <View style={{ flex: 1 }}>
        <Button
          title="Support"
          variant="ghost"
          size="compact"
          onPress={() =>
            void Linking.openURL('https://recollect-ai.netlify.app/support/').catch(reportError)
          }
        />
      </View>
    </View>
  );
}
