import { createContext } from 'react';
import { Platform } from 'react-native';

export const colors = {
  background: '#F0EEE6',
  paper: '#FAF9F5',
  ink: '#20221E',
  muted: '#65685F',
  accent: '#343AE7',
  pale: '#E9E7FB',
  yellow: '#E7ED9B',
  lilac: '#DDD9E8',
  line: '#D4D2C9',
  danger: '#A43232',
};

export const fonts = {
  regular: 'Manrope-Regular',
  semibold: 'Manrope-SemiBold',
  bold: 'Manrope-Bold',
  extraBold: 'Manrope-ExtraBold',
  editorial: 'InstrumentSerif-Italic',
  mono: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
};

export const TypographyContext = createContext(false);
