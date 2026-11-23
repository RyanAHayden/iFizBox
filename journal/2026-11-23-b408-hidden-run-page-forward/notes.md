# B408 Hiding a run leaves the page behind sunk

Hiding a queue run (the run page's Hide, `openProgress` `hide()`) in a card style (iOS 13 and 26) left the app
scaled to 0.92 and dimmed on black. The run was out of sight, but the page behind the sheet stayed sunk.

How it works:

- `nav/sheet.js` `close.cover(on)` is replaced by `close.away(on)`, called by `progress.js` `hide()` and `show()`.
- `away(true)` releases the dark cover in every style (the old `!card` guard is gone) and brings the page forward,
  unless another card sheet is up.
- `away(false)` pushes the page back.
- `cards` counts only shown card sheets, so closing a hidden run moves nothing.
- Show during the 300 ms forward slide: `pushBack` starts from the current computed transform and reuses the old
  target (the `coming` WeakMap). Rects measured mid-scale would be wrong, and starting from none would jump.

Verification:

- `progress.test.js`: a new B408 test, and the B401 cover test changed for hidden cards.
- Headless Chromium with the real modules on a small harness page. The computed transform of the tab bar was
  checked through open, hide, show, a quick hide and show, and close.

Not verified:

- A real iPhone with iOS 13 or 26 card styles.
- A real queue run hidden by its Hide button. The page was driven by script.
