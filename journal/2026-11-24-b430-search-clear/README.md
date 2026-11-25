# B430: the x in a search field did nothing (iOS 26)

Symptom: on iOS 26 style, tapping the clear x in a search field with text did nothing.

## Why
On the iPhone 15 Pro (iOS 27, Lite 0.31.0, iOS 26 style, web inspector over pymobiledevice3), WebKit retargets finger taps near the x. `elementFromPoint` on the x returns the LABEL, but a real tap's click targets the INPUT (clientX moved e.g. 295 -> 283). The old handler only took a click on the label, so the tap hit the input and nothing happened.

Chromium (`probe.mjs` in this folder, CDP touch, `node .../probe.mjs [web/app dir] [route...]`) only partly reproduced it: a tap on the 19 px circle hit the label and cleared, taps just around it hit the input and did nothing.

## Fix
- JS: the handler moved from `app.js` into `nav/searchbar.js` as `clearTap()` (testable). It finds the field with `closest(".search-field")`.
- CSS, `packages.css`, iOS 26 only: `.search-field` gets `position: relative`, plus an invisible `::before` tap area 32 px wide at the right end, `z-index: 1`, shown only with text.

Both are kept. On the phone, CSS alone and JS alone each cleared the x. JS alone also cleared on a tap 15 px left of the circle's edge (840 px of 1179), because WebKit moved X into the area; with both, 840 px only moves the caret and the targets are exact.

## Checked
- iPhone 15 Pro, both on, injected: the x empties, the input event fires and results reset, focus and keyboard stay. Works on Search, Sources, Changes, Installed, My IPAs (iOS 26). Taps on the text keep the value. iOS 6, 7 and 13 styles on Search still clear (data-style set live).
- Chromium: all four styles on Search, Sources and Changes. Installed and My IPAs draw no field with the empty fake bridge, so they were not checked there.

## Not verified
- Settings has no search field in the app today (its only field is the theme preview's, a picture), so that page could not be checked.
- The built IPA with this change was not installed on the phone; the change was injected into 0.31.0.
- The iOS 6, 7 and 13 check ran on the iPhone 15 Pro, not on iOS 15.

## Mistake
The first phone script tapped a stale point on another page and opened the project's GitHub page from the app in Safari. Nothing was changed there.
