# B387 Scroll lock while a swipe back is under way

## What changed

- `web/app/nav/swipe.js` `lockScroll`: the class `scroll-held` on both pages; `web/app/style.css` gives their
  `.page-body` and `[data-scroller]` `overflow-y: hidden !important`. The touch listeners stay passive.
- `web/app/app.js`: `backSwipe.begin` locks (edge strip and page swipe share it); the end of the slide unlocks, at rest,
  committed or cancelled, and dispatches `ifizbox:scrollfree`.
- `web/app/nav/glass.js` (outside the task's files, needed): on `ifizbox:scrollfree` one update goes to the shell even
  when nothing changed, so it finds the page's scroller again (below).
- Tests: swipe.test.js, pageswipe.test.js, glass.test.js. `docs/native.md`, `release-notes/B387.md`.

## Checks

- Chromium, `probe.mjs`: ios6, ios7, ios13, ios26 pass (both swipes: down, up, a second finger, cancel keeps the place,
  scrolling works after, a diagonal commit). On the branch's base only the "held" checks fail: Chromium filters a
  sideways drag by `touch-action: pan-y` already, so it can't show the bug. Hence the phone.
- iPhone 15 Pro (iOS 27, style ios26), `phone.mjs`. Build 0.25.0: a 40-degree page swipe scrolled the page 400 -> 231.
  This branch's IPA: 400 throughout, every touchmove delivered, no touchcancel, no jump; also 0 throughout at the very
  top of the page; a vertical flick afterwards goes 400 -> 1645 (1641 without); frame median 8 ms as without.
  Other swipes (sideways first, then vertical) didn't scroll before either.
- `tabbar.mjs`: the native tab bar's shrink on scroll. Holding the scroller makes WebKit build a new UIScrollView; after
  a cancelled swipe the shell still followed the old one and the bar never shrank (4 of 4; 0 of 4 with the lock's rule
  neutralised). With the `scrollfree` update it shrinks after a cancelled and after a committed swipe, 3 of 3 each.

## Tried and failed

- Inline `overflow-y` on the scrollers: another hold's release (pull to refresh, the scroll indicator) could end it, and a
  scroller drawn mid-swipe was free. Now a class.
- The lock injected into the installed build by a MutationObserver: it passed the tab bar check once, which misled; only
  the real build, repeated, showed the bar's regression.
- A guard in nav/pullrefresh.js: reverted, its script pull never runs on iOS.

## Not verified

- phone.mjs on the final build (its run was cut off when WebDriverAgent dropped, as was a fourth tabbar.mjs round): those
  numbers are from the build before the `scrollfree` update, which doesn't change the lock.
- The base build at the very top of the page with the same gesture (the first try was a plain scroll).
- A second finger, and an edge swipe during a fling, on the phone: both ran, but the page didn't scroll without the lock
  either, so they prove nothing.
- The other styles on the phone (Chromium only), and the iPhone 7 / iOS 15.
- A list's inner scroller (`[data-scroller]`, the pinned search pages) on the phone or in the probe: the CSS rule only.
