# Recollect landing page

A buildless, responsive landing page. Publish this directory as the site root; the API and mobile application are separate.

## Preview

From the repository root:

```sh
python3 -m http.server 4178 --bind 127.0.0.1 --directory apps/landing
```

## Publish on Netlify

Project: `recollect-ai` in the Collect Software team, ID `97e0b691-ea61-4f19-a2ce-28ca29ecb524`. Public URL: <https://recollect-ai.netlify.app/>. Dashboard: <https://app.netlify.com/projects/recollect-ai>.

Upload this directory through Netlify's manual deploy interface, or use the root `netlify.toml` when connecting the repository. No build command or framework is required. The deploy contains only these public website files.

Set `downloadUrl` in `site-config.js` to a verified public App Store or TestFlight URL when one is available. Until then, the primary calls to action lead to the email waitlist, and “Try a card” opens the working card preview.

## Interest signups

The `recollect-waitlist` form uses Netlify Forms. It collects email, optional learning interest, the landing-page source, and the signup purpose. It includes a honeypot and a native POST fallback when JavaScript is unavailable. No emails are sent automatically.

Before the first live deployment, enable **Forms → Enable form detection** in the Netlify project, then deploy. Confirm that `recollect-waitlist` appears in Active forms and verify a test submission. Signups, counts, spam review, and CSV exports are available under **Forms → recollect-waitlist**. The form requires Netlify hosting; local and file previews explicitly say that no signup was saved.

The enhanced submission locks while saving, preserves entries on failure, and confirms signup only after the server accepts it. Email addresses are never logged or put in analytics, URLs, or browser storage. This tracks submitted interest; anonymous traffic and demo interactions are not instrumented.

The interactive cards are illustrative examples. They run entirely in browser memory and do not call the production API, collect user information, or save review schedules.

The original app icon is copied without changes from `apps/mobile/assets/icon.png`. Fonts are served by Google Fonts, with system and Georgia fallbacks. Security headers for Netlify are declared in `_headers`.
