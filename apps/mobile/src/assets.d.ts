declare module '*.ttf' {
  const asset: number;
  export default asset;
}

declare module '*.png' {
  const asset: import('react-native').ImageSourcePropType;
  export default asset;
}
