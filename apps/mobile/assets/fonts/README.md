# Brand fonts

These fonts are bundled so the app's typography works offline and can be delivered as an Expo update.

- Manrope Regular, SemiBold, Bold, and ExtraBold: static TrueType files from the official [Expo Google Fonts Manrope package](https://github.com/expo/google-fonts/tree/master/font-packages/manrope). Copyright and SIL Open Font License are in `Manrope-LICENSE.txt`.
- Instrument Serif Italic: TrueType file from [Google Fonts](https://github.com/google/fonts/tree/main/ofl/instrumentserif). Copyright and SIL Open Font License are in `InstrumentSerif-LICENSE.txt`.

`app/_layout.tsx` loads them with the existing Expo font module. The shared `Text` component selects a static Manrope weight; the editorial style uses Instrument Serif Italic. No native font config plugin is required.
