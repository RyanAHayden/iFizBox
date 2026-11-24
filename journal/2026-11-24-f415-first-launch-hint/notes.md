# F415: first-launch hint on every signed install's end

## What I did
- `web/app/core/firstlaunch.js` (new): `FIRST_LAUNCH_HINT` (the grey line's text), `firstLaunchHint(rows)` (null
  unless an app signed with a profile installed, not the jailbreak helper's and not our own IPA) and
  `sayFirstLaunch(page, text)`, which calls `page.help(text, {label: ""})`, so there is no button.
- Shown through `nav/progress.js` `page.help` from `screens/apprun.js`, `signing/common.js` `finishHere`,
  `signing-sheet.js` `followInstall` and `signing/watch.js`.
- The app run's Apps list summary stays the run's last line step; the hint follows it through `page.help`.
  `.qr-hint` styles it under that summary (`progress.css`, `ios26.css`).
- `docs/signing.md` (progress page section): one bullet on the first-launch line, where it shows and where it doesn't.

## Decisions
- The task named `screens/installroute.js`, but that is the settings page and shows no install result, so it is not changed.
- The hint shows on every install, because the app can't tell whether iOS already checked the profile.

## Not verified
- The dialog itself: R96 couldn't reproduce it, and reproducing needs an un-validated profile.
- Appearance in a real browser or on a phone: unit tests with the fake DOM only.
