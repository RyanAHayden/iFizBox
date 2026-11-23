# B369 Free Apple ID: Cancel and Sign In side by side

Sign In and Cancel were two full-width rows stacked, and tapping Use a Free Apple ID left the sign-in group below the
fold. Now the buttons are one grouped table split in two halves, and the page scrolls the group to the top.

## What was done

- **free-apple-id.js**: `signInButtons` and `codeButtons` are pure specs (left to right, with the footer). `splitButtons`
  draws the group: Cancel left, Sign In right, as in Home's Settings | Theme pair. The password footer (or the wait
  footer) stays under the pair. The 2FA code view does the same with Cancel | Verify.
- **freeid.css** `.free-split`: a flex row of two equal halves. The line between them is the grouped divider turned
  upright: 1px divider plus 1px highlight in the iOS 6 style; a .5px hairline with no highlight in the iOS 7, 13 and 26
  styles.
- **free-apple-id.js** `bringToTop`: after the redraw, Use a Free Apple ID slides the page's scroller so the Sign In
  With a Free Apple ID group sits 8px (TOP_GAP) under the fixed nav bar. It uses its own requestAnimationFrame ease-out
  with the timing and easing of nav/tabbar.js (TOP_MS, easeOut), because smooth scrollTo jumped on iOS 15 WebKit (B57).
  Reduce Motion makes it instant; a touch stops it. The math is pure, in `scrollTarget`.
- The field focus uses `preventScroll: true`. For the on-screen keyboard, the page listens to visualViewport resize and
  scroll for 1.2 s after the tap and puts the group back if the page moved.
- **free-apple-id.js** spacer: when the page ends too soon to scroll that far, an empty `.free-room` spacer is appended
  to the scroller with just the missing height. render() removes it once the view is not sign-in or code, and the
  Signing page's own redraw replaces it too.

## Checks

- `node --test` in web/app: 3349 pass, 0 fail.
- New tests in `web/app/screens/free-apple-id.test.js`: button order, labels, classes and footer; the split group's DOM
  and taps (fake DOM); freeid.css's flex rules; `scrollTarget` math.
- Chromium shots at 390x844, DPR 3, with capture.mjs (copied from journal/2026-11-20-f317-remaining-hints, viewport
  changed; RELAY=1 fakes /apple/status; free.json is the script). Before was a scratch worktree of main, after this
  branch, each served by `python3 -m http.server`.
  - entry.png: the entry row before the tap.
  - before-signin.png: stacked Sign In, Cancel below the fold.
  - after-signin.png: the group at the top. Nav bar bottom 91px, group top 99px; fields at 128 and 172; Cancel at
    11,285 (184x43) and Sign In at 196,285 (184x43), both in view; Apple ID field focused.
  - after-signin-dark.png: dark theme.
- A 3x zoom of the divider was checked in both themes: it matches the horizontal grouped divider.

## What failed along the way

- The first after-shot stopped the group at 240px, not under the nav bar at 91px: the page ended too soon to scroll
  that far.
- The first fix gave the block a min-height. That left a blank gap in the middle of the page, because How Signing Works
  and Share Your Certificate follow the block. The final fix is the empty `.free-room` spacer at the end instead.

## Not verified

- The keyboard part: visualViewport putting the group back after the on-screen keyboard opens. Headless Chromium has no
  on-screen keyboard, and AGENTS.md says web changes are checked in Chromium, not on the phones.
- The 2FA code view's Cancel | Verify was not rendered (reaching it needs a real Apple sign-in); it is only unit-tested.
- The pressed look of the halves was not shot.
- The iOS 7, 13 and 26 hairline was only looked at roughly, in an ios26 shot taken after switching data-style live (not
  committed).
