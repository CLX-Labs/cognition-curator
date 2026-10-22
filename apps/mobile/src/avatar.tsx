import React, { useState } from 'react';
import { Image, View } from 'react-native';
import { Text, colors } from './ui';

export default function Avatar({
  name,
  photoDataUrl,
  size = 54,
}: {
  name: string;
  photoDataUrl: string | null;
  size?: number;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        overflow: 'hidden',
        backgroundColor: colors.yellow,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {photoDataUrl && failed !== photoDataUrl ? (
        <Image
          source={{ uri: photoDataUrl }}
          style={{ width: size, height: size }}
          resizeMode="cover"
          accessible={false}
          onError={() => setFailed(photoDataUrl)}
        />
      ) : (
        <Text style={{ fontSize: Math.round(size * 0.4), fontWeight: '700', color: colors.ink }}>
          {(name.trim() || 'R').charAt(0).toUpperCase()}
        </Text>
      )}
    </View>
  );
}
