# Recollect landing page

A buildless, responsive landing page. Publish this directory as the site root; the API and mobile application are separate.

The visual direction is artful and editorial: Manrope and Instrument Serif, warm paper, cobalt, yellow, original geometric deck covers, and a working flashcard in the hero. The original sculpture appears in the offline-practice section. The design choices, palette, image prompt, and mobile guidelines are in [the visual direction notes](../../docs/recollect-visual-direction.md).

The homepage styles live in `editorial.css` and are scoped to `editorial-home`;
shared support, privacy, thanks and friend-invitation layouts retain `styles.css`.
The new cover artwork is a website design study, not a claim that downloaded app
decks already use these covers.

## Preview

From the repository root:

```sh
python3 -m http.server 4178 --bind 127.0.0.1 --directory apps/landing
```

## Publish on Netlify

Project: `recollect-ai` in the Collect Software team, ID `97e0b691-ea61-4f19-a2ce-28ca29ecb524`. Public URL: <https://recollect-ai.netlify.app/>. Dashboard: <https://app.netlify.com/projects/recollect-ai>.

Publish through CI/CD: merge reviewed website changes to `main` and let the connected Netlify Git deployment publish `apps/landing`, using the root `netlify.toml`. No build command or framework is required. Verify the resulting production deployment and public App Store links. Never deploy from a local CLI or upload files in the dashboard; repair the Git integration if automatic deployment is unavailable. Mobile releases likewise use the automated release workflows, with no manual App Store Connect submission.

Recollect AI version **7.0.0** was verified publicly available on the App Store on November 5, 2026. The primary calls to action download the app; “Try a card” opens the working card preview. The app supports iPhone and iPad and requires iOS/iPadOS 18.4 or later.

`downloadUrl` in `site-config.js` uses the region-neutral public URL `https://apps.apple.com/app/id6749138102`. Keep the static links in the homepage, invitation page, and thank-you page aligned so installation works without JavaScript. The verified US listing is `https://apps.apple.com/us/app/recollect-ai/id6749138102`. Future download destinations must remain official public App Store app pages or public TestFlight join URLs.

## Friend invitations

Shared friend invitations use `https://recollect-ai.netlify.app/friends?invite=<code>`. The public page works before installation: it keeps the invite code visible, offers an explicit **Open Recollect** action for existing users, and explains how to return after installing or paste the code in **You → Friends**. Opening the page never accepts an invitation or attempts to detect whether the app is installed.

`friend-invite.js` validates codes against the API contract and rejects duplicate `invite` parameters. Clipboard access happens only after pressing **Copy invite code**, with manual selection if copying is unavailable. The code stays in the URL and page memory; this page does not call the API, use browser storage, or run analytics. Link preview metadata excludes the code, and the page uses a no-referrer policy for external resources and links.

The installation action uses the same public `downloadUrl` setting as the homepage, restricted to official App Store app pages or public TestFlight join URLs. Missing or invalid configuration preserves the static, verified App Store link. Installing does not automatically transfer or accept the invitation; users return to the original link or use the visible code after signing in. Without JavaScript, the page still provides installation access and instructions for copying the code from the invitation URL.

## Interest signups

The optional updates form retains the Netlify Forms name `recollect-waitlist` so existing submissions remain available. It collects email, optional learning interest, the landing-page source, and the signup purpose `recollect-product-updates`. The form explains that new signups are for new decks and Recollect updates. Existing availability-update submissions keep their original purpose; this change does not backfill broader consent. It includes a honeypot and a native POST fallback when JavaScript is unavailable. No emails are sent automatically.

Netlify form detection is enabled and `recollect-waitlist` is an active form. After deployment, confirm it remains active. Signups, counts, spam review, and CSV exports are available under **Forms → recollect-waitlist**. The form requires Netlify hosting; local and file previews explicitly say that no signup was saved.

The enhanced submission locks while saving, preserves entries on failure, and confirms signup only after the server accepts it. Email addresses are never logged or put in analytics, URLs, or browser storage. This tracks submitted interest; anonymous traffic and demo interactions are not instrumented.

The interactive cards use three sample cards from each of seven official starter
decks. Tap or press Enter/Space to flip; swipe right to remember or left when
unsure. Visible buttons offer the same responses. Selecting a cover changes the
sample deck and returns to the hero. Vertical gestures remain page scrolling;
cancelled gestures never advance. Reduced motion disables drag transforms.
This demonstration runs entirely in browser memory and does not call the
production API, collect user information, or save review schedules.

The original app icon is copied without changes from `apps/mobile/assets/icon.png`. Fonts are served by Google Fonts, with system and Georgia fallbacks. Security headers for Netlify are declared in `_headers`.

## Support, privacy, and community pages

The public pages live at `/support/`, `/privacy/`, and `/community-guidelines/`. The support form is named `recollect-support`; confirm Netlify form detection and a successful submission before relying on it for public support. Messages contain the provided email, category, and text; no attachment, tracking identifier, or automatic account data is included. JavaScript confirms success only after an accepted response, preserves text on errors, and does not submit from local previews. The native form action is `/support/thanks/`.

The owner-confirmed public publisher is Collect Software and the monitored support address is `collectsoftwarev2@gmail.com`, set in `site-config.js` and provided as a static contact link on support and privacy pages. Public policy copy must describe the final shipped deletion, consent, and community controls accurately. The launch review draft and outstanding confirmations are in [the App Store release notes](../../docs/app-store-release.md); those notes are outside this static publish directory.
