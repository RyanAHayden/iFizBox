# B314: iOS 26 OLED Black search Cancel without a box

## What I did

- ios26.css's dark block now sets `--search-cancel-edge`, `-edge-top` and `-edge-bottom` transparent, as the light
  block does.
- Those tokens alone would not have fixed it: packages.css's `html[data-theme="dark"] .search-cancel` rule sets
  `border-color: var(--dk-btn-edge)`, and ios26.css's dark block points `--dk-btn-edge` at the glass rim
  (rgba white .14). That rim is the box that showed. So ios26.css's dark Cancel rule (which already cleared the
  background) now also sets `border-color: transparent`. `--dk-btn-edge` stays as it is, since other dark buttons
  use it.
- Checked with a 3x headless Chromium render of a search bar (the markup nav/searchbar.js builds, holding text so
  Cancel shows), ios26 + dark + oled: main's ios26.css draws the grey box around Cancel, this branch's doesn't, and
  it shows only the blue text. Scratch pages deleted afterwards.
- Also rendered iOS 7 and iOS 13 dark the same way: no box there, so no follow-up filed.

## Tried and failed

none

## Not verified

- On the 15 Pro: not checked. The fix is CSS only and the Chromium render shows it; real-device checks go on the
  15, but this one did not need it (Chromium covers how the web bars look).
- The pressed (:active) Cancel in dark: not rendered; packages.css's :active rule changes only the background,
  which ios26.css's later rule of the same weight already clears.
