# B336: a source's own repo counts as the app's code when the source says so

Andarium (Kernarium's AltStore source) showed Source Code: Not Public. `appGithub` counted the repo holding the
source JSON only when that repo is named for the app (Kernarium vs Andarium fails).

## What changed

- `core/altparse.js` `parseAltSource`: each parsed app carries `sourceWebsite` (the source's `website`) and
  `sourceApps` (how many apps the source lists). `appStanza` spreads the app into `ipa`, so both land next to
  `sourceUrl` without changing `appStanza` or its callers (catalog.js is not on this task's files).
- `core/previews.js` `appGithub`: the source's repo (and a release in it) is the app's when it is named for the app,
  when the source's website names that same repo, or when the source lists exactly one app. A many-app source repo
  whose website names no repo (or another one) still gives null.
- `core/previews.test.js`: a case shaped like Kernarium's source.json (fetched once to check its shape: `website`
  is `https://github.com/imxieyi/Kernarium`, one app) gives `{ owner: imxieyi, repo: Kernarium }`, plus the
  website-only and one-app-only paths and two many-app nulls. The existing many-app case (app C) still gives
  nothing.

## Tried and failed

Nothing.

## Not verified

- The app page on a phone or in Chromium: the change is in `core/` and covered by node tests; the row in
  `screens/safety.js` reads `appGithub`'s result directly.
- Catalogs cached before this change: their ipa objects lack the two new fields until the source is parsed again
  (next refresh), so Andarium may show Not Public until then. Not checked how long that cache lives.
