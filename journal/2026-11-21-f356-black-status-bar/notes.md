# F356: black status bar and a 44 pt nav bar (iOS 6 era, app)

## What changed

- `web/app/style.css` / `ios6.css`: `.navbar::before` is the top inset tall and painted `--site-strip` (#000 in the
  iOS 6 era) everywhere; only the app's iOS 7/13 eras keep the old 22 pt stretch of the bar's art
  (`html[data-shell="app"]:is([data-style="ios7"], [data-style="ios13"])`). Sheets and the console (`.navbar`
  too) get the same black strip.
- Every `env(safe-area-inset-top)` in `web/app/*.css` is `var(--top-inset, env(safe-area-inset-top))`;
  `--top-inset` is set only for `html[data-shell="app"]` outside iOS 7/13, from the shell's `--status-bar-bottom`.
- `native/Sources/App.swift`: `TopInset` sets `--status-bar-bottom` (document-start user script, then on
  `viewSafeAreaInsetsDidChange` and every commit). Status-bar text was already light for every iOS 6 theme
  (only iOS 7's White asks for dark); the comment now says why.

## iPhone 15 Pro (iOS 27, Lite build), why the phone

Chromium can't show iOS's own status bar text or the Dynamic Island, so the native colour and the island clearance
needed the device.

- Light Classic: status bar text white on the black strip (`ref/15/screens/f356-a.png`).
- Safe area top 59 pt: the strip ends at 177 px in the shot. Status bar frame 54 pt and the resting island at
  11.33 to 48.33 pt (37.33 pt tall, the safe area 32/3 pt under it) are the 15 Pro's known geometry, not read off
  the screen: the shot can't show the island.
- Screenshots (go-ios screenshotr) leave the island out entirely, so its touched size can't be captured on this
  rig. It doesn't matter here: at 54 pt the bar would sit only 5.67 pt under the *resting* island, already under the
  6 pt minimum before any touch growth or compact Live Activity. So the rule falls back to the safe area: the bar
  starts at 59 pt (10.67 pt under the resting island), same position as before, with the strip now black.
- A 16 Pro (safe area 62, status bar 54) has its island lower still, so it falls back too. Notch and Home-button
  phones: status bar == safe area, unchanged.

## Not done here

The launch screen (`native/launch/`, storyboard compiled on the Mac) still draws the bar's gloss through the strip,
so the splash-to-page hand-over shows the strip turn black. Queued as its own task.
