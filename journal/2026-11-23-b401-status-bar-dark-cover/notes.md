# B401 Status bar stays light over a dark cover

While a dark cover is up, the status bar text turns light. The cover is a black strip or a dimmed page that
the status bar sits over, so dark text there was unreadable.

How it works:

- `web/app/nav/statusbar.js` has `coverDark()`, `darkCovered()` and `onDarkCover()`.
- `showSheet` (`web/app/nav/sheet.js`) covers for `.console` sheets and for every card sheet (iOS 13 and 26).
- `openProgress` `hide()`/`show()` ends and resumes the cover (not in card styles).
- `zoomShots` (`altstore.js`) and Move and Scale (`appicon.js`) cover too.
- `screens/settings.js` `tellShell` resends the last `app.theme` without the statusBar while covered and with it
  after. The cover is released as the slide down starts.

Why card sheets count: Chromium shots at 375x667 (20 pt inset) and 402x874 (62 pt inset) showed the page behind a
sheet sinking onto black. So in iOS 13 and 26 light the status bar sits over black even for plain sheets, and for
iOS 26's run page, which itself follows the theme. At 402x874 the black strip is 35 pt, so the status bar sits
partly over the dimmed nav bar.

The saved launch theme: `Theme.apply` (`Bridge.swift`) saves only style and palettes, which don't change. No native
change.

Audit: alert, action sheet and share scrims only dim the page, so they are left alone.

`coverDark` lives in `statusbar.js` because a new startup module would hit the module-graph bound in
`module-graph.test.js` (117 of 118).

Verification:

- Chromium with the fake bridge: the `app.theme` sequence dark, light, dark was checked for the run page, a sheet
  and a photo in iOS 7, 13 and 26 light, at both sizes. Tests cover iOS 6, 7, 13 and 26 in light and dark.
- iPhone 7 (Chromium draws no status bar): four web files and a temporary `index.html` were swapped in. The
  `index.html` overrode `localStorage` `getItem` to iOS 7 light and opened a run page by script; nothing was
  installed. `iphone7-ios7-light.png` shows before, open and closed. The files were restored (md5 checked) and the
  app relaunched.
- First phone attempt failed: the app did not close, and someone tapped Cancel on the phone mid-run, so it showed
  the old build. The second failed too: a Home press right before `open` closed the app again. A pause before
  `open` fixed it.

Review: `hide()` in a card style kept the page sunk on black while sending dark text. Fixed: the cover stays until
close. Card sheets keep the dark cover, as above.

Not verified:

- A real iPhone with iOS 13 or 26 card sheets. On Dynamic Island phones the status text sits partly over the dimmed
  bar.
- Move and Scale, by hand or on a phone.
- A real install run on the iPhone 7. The page was opened by script.
