# Recollect landing page

A buildless, responsive landing page. Publish this directory as the site root; the API and mobile application are separate.

The visual direction is artful and editorial: Manrope and Instrument Serif, warm paper, cobalt, yellow, and an original transparent sculpture of collected cards. The design choices, palette, image prompt, and future mobile guidelines are in [the visual direction notes](../../docs/recollect-visual-direction.md).

## Preview

From the repository root:

```sh
python3 -m http.server 4178 --bind 127.0.0.1 --directory apps/landing
```

## Publish on Netlify

Project: `recollect-ai` in the Collect Software team, ID `97e0b691-ea61-4f19-a2ce-28ca29ecb524`. Public URL: <https://recollect-ai.netlify.app/>. Dashboard: <https://app.netlify.com/projects/recollect-ai>.

Upload this directory through Netlify's manual deploy interface, or use the root `netlify.toml` when connecting the repository. No build command or framework is required. The deploy contains only these public website files.

Set `downloadUrl` in `site-config.js` to a verified public App Store or TestFlight URL when one is available. Until then, the primary calls to action lead to the email waitlist, and “Try the cards” opens the working card preview.

## Friend invitations

Shared friend invitations use `https://recollect-ai.netlify.app/friends?invite=<code>`. The public page works before installation: it keeps the invite code visible, offers an explicit **Open Recollect** action for existing users, and explains how to return after installing or paste the code in **You → Friends**. Opening the page never accepts an invitation or attempts to detect whether the app is installed.

`friend-invite.js` validates codes against the API contract and rejects duplicate `invite` parameters. Clipboard access happens only after pressing **Copy invite code**, with manual selection if copying is unavailable. The code stays in the URL and page memory; this page does not call the API, use browser storage, or run analytics. Link preview metadata excludes the code, and the page uses a no-referrer policy for external resources and links.

The installation action uses the same public `downloadUrl` setting as the homepage, restricted to official App Store app pages or public TestFlight join URLs. Until a verified public link is configured, it offers the availability waitlist through the homepage, which does not grant beta access. Keep that setting `null` rather than substituting an unavailable App Store listing or a private TestFlight dashboard URL. Installing does not automatically transfer or accept the invitation; users return to the original link or use the visible code after signing in. Without JavaScript, the page still links to the waitlist or a configured download destination and explains how to copy the code from the invitation URL.

## Interest signups

The `recollect-waitlist` form uses Netlify Forms. It collects email, optional learning interest, the landing-page source, and the signup purpose. It includes a honeypot and a native POST fallback when JavaScript is unavailable. No emails are sent automatically.

Before the first live deployment, enable **Forms → Enable form detection** in the Netlify project, then deploy. Confirm that `recollect-waitlist` appears in Active forms and verify a test submission. Signups, counts, spam review, and CSV exports are available under **Forms → recollect-waitlist**. The form requires Netlify hosting; local and file previews explicitly say that no signup was saved.

The enhanced submission locks while saving, preserves entries on failure, and confirms signup only after the server accepts it. Email addresses are never logged or put in analytics, URLs, or browser storage. This tracks submitted interest; anonymous traffic and demo interactions are not instrumented.

The interactive cards are illustrative examples. They run entirely in browser memory and do not call the production API, collect user information, or save review schedules.

The original app icon is copied without changes from `apps/mobile/assets/icon.png`. Fonts are served by Google Fonts, with system and Georgia fallbacks. Security headers for Netlify are declared in `_headers`.

## Support, privacy, and community pages

The public pages live at `/support/`, `/privacy/`, and `/community-guidelines/`. The support form is named `recollect-support`; confirm Netlify form detection and a successful submission before relying on it for public support. Messages contain the provided email, category, and text; no attachment, tracking identifier, or automatic account data is included. JavaScript confirms success only after an accepted response, preserves text on errors, and does not submit from local previews. The native form action is `/support/thanks/`.

The owner-confirmed public publisher is Collect Software and the monitored support address is `collectsoftwarev2@gmail.com`, set in `site-config.js` and provided as a static contact link on support and privacy pages. Public policy copy must describe the final shipped deletion, consent, and community controls accurately. The launch review draft and outstanding confirmations are in [the App Store release notes](../../docs/app-store-release.md); those notes are outside this static publish directory.
