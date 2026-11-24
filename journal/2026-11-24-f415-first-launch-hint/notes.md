# F415: first-launch hint on every signed install's end

## What I did
- `web/app/core/installroute.js`: `FIRST_LAUNCH_HINT` (the grey line's text) and `sayFirstLaunch(page, text)`, which calls
  `page.help(text, {label: ""})`, so there is no button. `web/app/core/apprun.js`: `firstLaunchHint(rows)` (null unless
  an app signed with a profile installed, not the jailbreak helper's and not our own IPA).
- Failed first: a module of its own (`core/firstlaunch.js`) went over the startup module limit, as it brought
  `core/apprun.js` in through `signing/common.js`.
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
- Headless Chromium showed the iOS 6 style's Log line and Apps list line as meant. The iOS 26 style's colours were not
  judged (the scratch page loaded only part of its CSS). Nothing on a phone, and no real install was run.
