# Project deployment rules

- Never manually deploy to Netlify or App Store Connect. Always use CI/CD.
- Publish website updates by merging or pushing the reviewed changes to `main` and verifying the automatic Netlify deployment.
- Deliver mobile updates and native App Store Connect builds through the repository’s automated release workflows.
- If automatic deployment fails or is missing, inspect and fix the CI/CD connection or pipeline. Do not fall back to a local CLI deploy, dashboard file upload, or manual build submission.
- Website-only, documentation-only, and release-configuration-only changes must not publish an OTA or native app release.
- Backend-only merges deploy through Railway without publishing an Expo update, creating a native build, or bumping the app version. Automatic mobile releases require changes to the app or its shared runtime/build dependencies; an explicit CI workflow dispatch may force a release.
