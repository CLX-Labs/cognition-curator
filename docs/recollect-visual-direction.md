# Recollect: for the curious

The selected direction is **artful and editorial**, with expressive typography and asymmetric layouts. The website and mobile app share this visual language.

## Visual language

- Warm paper, near-black typography, cobalt, and a restrained yellow accent.
- Manrope for bold headlines, labels, body copy, and controls; Instrument Serif for a few large, expressive words. Monospace labels provide quiet navigation and section indexes.
- Thin rules and generous space organize content. The hero pairs oversized type with an original sculptural image presented like a collected object.
- A cobalt practice section makes the actual card interaction the focus. A dark signup section gives the primary next step clear emphasis.
- Motion is limited to hover and focus feedback, with reduced-motion support. No autoplay video, scroll hijacking, or temporary success banners.

| Token            | Value     |
| ---------------- | --------- |
| Paper            | `#f0eee6` |
| Ink              | `#20221e` |
| Muted text       | `#65685f` |
| Cobalt           | `#343ae7` |
| Yellow           | `#e7ed9b` |
| Artwork backdrop | `#ddd9e8` |

## Mobile app

Manrope and Instrument Serif are bundled with the app, including their open font licenses. Fonts load at runtime through the existing Expo font module, preserving the installed iOS runtime for OTA delivery. The original app icon is unchanged.

Warm paper, thin rules, stronger headlines, yellow highlights, and cobalt actions carry through Today, Practice, Create, Progress, You, deck management, card editing, and sign-in. Review has a cobalt background with a paper question face and yellow answer face. The mobile layout keeps fixed review controls, comfortable tap targets, and the existing bottom tabs.

Card review uses a direct, binary interaction:

- Tap the card to flip between question and answer; this never records a rating.
- Swipe right to remember. A scheduled review saves `good` and advances.
- Swipe left when unsure. A scheduled review saves `again` and advances.
- Practice anytime includes cards that are not due yet. Each response updates the review schedule, just like daily review; missed cards do not repeat in the same session.
- “Not sure” schedules the next review in 3 days. “I remember” starts at 7 days and grows with repeated recall. Historical v1 review events retain their original scheduling rules when replayed.
- In You, Edit profile changes the account name and photo. Photos are cropped to a square, resized to 512 px, and saved as small private JPEGs; the home greeting and avatar use the saved profile.
- Visible buttons and accessible card actions provide the same choices without gestures.

Short or vertical drags, cancelled gestures, and multiple fingers do not record a response. Saves are guarded against duplicate actions, and a failed save keeps the current card available for retry. Library synchronization preserves the session queue and current face. Reduced motion disables the flip and spring animation. No transient saved banners appear in review.

Keep card fronts succinct. Saved cards, AI suggestions, and practice have distinct actions. The sculpture is used on sign-in; the app's learning screens remain focused on the user's own cards.

## References and original art

The [Promptsites gallery](https://www.promptsites.co/), including its [learning card presentation](https://www.promptsites.co/prompt/bite-sized-courses) and [editorial compositions](https://www.promptsites.co/prompt/prisma-landing), informed the use of depth, type scale, and visual hierarchy. The Recollect layout, copy, code, and hero illustration are original.

The hero asset is `apps/landing/assets/curiosity-sculpture.png`, generated with the **built-in imagegen tool**, on a transparent background. The existing `app-icon.png` is preserved unchanged.

Final image prompt:

> Use case: stylized-concept. Asset type: original 3D hero illustration for Recollect, a friendly flashcard learning app. Create one premium sculptural still life of a small fan of thick, blank, rounded flashcard tiles, playfully suspended in space with a glossy cobalt-blue looping ribbon threading around them and a soft sculptural asterisk. Main tile is buttery yellow, two supporting tiles pale lavender and warm white, one small pistachio-green sphere. Make it feel like an art-directed collectible object: tactile matte paper and rubber, polished blue enamel, a touch of chrome reflection, beautifully soft studio shadows and ambient occlusion. Orthographic three-quarter camera, strong depth and crisp silhouettes, large central composition filling most of a square frame with room around the entire sculpture, all objects fully visible. Isolated on a genuinely transparent background, no floor, no environment. This is an image asset to sit on a lilac webpage, not a screenshot of a website. No words, letters, numbers, logos, devices, people, watermarks, or extra scattered objects. Warm, curious, sophisticated, playful.
