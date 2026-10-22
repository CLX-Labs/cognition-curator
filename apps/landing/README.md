# Recollect landing page

A buildless, responsive landing page. Publish this directory as the site root; the API and mobile application are separate.

## Preview

From the repository root:

```sh
python3 -m http.server 4178 --bind 127.0.0.1 --directory apps/landing
```

## Publish on Netlify

Upload this directory through Netlify's manual deploy interface, or use the root `netlify.toml` when connecting the repository. No build command or framework is required. The deploy contains only these public website files.

Set `downloadUrl` in `site-config.js` to a verified public App Store or TestFlight URL when one is available. Until then, the page's calls to action lead to the working card preview. There is no fake download link or email signup.

The interactive cards are illustrative examples. They run entirely in browser memory and do not call the production API, collect user information, or save review schedules.

The original app icon is copied without changes from `apps/mobile/assets/icon.png`. Fonts are served by Google Fonts, with system and Georgia fallbacks. Security headers for Netlify are declared in `_headers`.
