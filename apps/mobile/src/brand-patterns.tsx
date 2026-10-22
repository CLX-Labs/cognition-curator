import React from 'react';
import { Image, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import weave from '../../landing/assets/patterns/weave.png';
import flow from '../../landing/assets/patterns/flow.png';
import orbit from '../../landing/assets/patterns/orbit.png';
import { colors } from './brand';

export type BrandPatternVariant = 'weave' | 'flow' | 'orbit';

const artwork = { weave, flow, orbit };
const families: BrandPatternVariant[] = ['weave', 'flow', 'orbit'];

export function BrandPattern({
  variant,
  width = 64,
  height = 64,
  style,
}: {
  variant: BrandPatternVariant;
  width?: number;
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      pointerEvents="none"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.pattern, { width, height }, style]}
    >
      <Image
        source={artwork[variant]}
        resizeMode="cover"
        accessible={false}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

export function DeckArtwork({
  id,
  color,
  icon,
  size = 72,
}: {
  id: string;
  color: string;
  icon: string | null | undefined;
  size?: number;
}) {
  const hash = Array.from(id).reduce(
    (value, character) => (value * 31 + character.charCodeAt(0)) | 0,
    0,
  );
  const variant = families[(hash >>> 0) % families.length]!;
  const chipSize = Math.max(24, Math.round(size * 0.42));
  return (
    <View
      pointerEvents="none"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.deck, { width: size, height: size }]}
    >
      <BrandPattern variant={variant} width={size} height={size} />
      <View
        style={[
          styles.icon,
          {
            width: chipSize,
            height: chipSize,
            borderRadius: chipSize / 2,
            backgroundColor: color || colors.paper,
          },
        ]}
      >
        <Text
          accessible={false}
          style={{ fontSize: Math.round(chipSize * 0.6), lineHeight: chipSize - 3 }}
        >
          {icon || '▤'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pattern: { overflow: 'hidden', borderRadius: 6, flexShrink: 0 },
  deck: { position: 'relative', overflow: 'hidden', borderRadius: 8, flexShrink: 0 },
  icon: {
    position: 'absolute',
    right: 5,
    bottom: 5,
    borderWidth: 2,
    borderColor: colors.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
