# B456 The A–Z index goes back to the top

Cause: not iOS-only. nav/vlist.js used el.offsetTop as the list's start. That includes the page's padding-top (the nav
bar, 105pt on the user's phone), but the visible window starts under that padding. So the index jumped one nav bar too
deep: the header and first rows went under the bar, and the pinned header was picked from what lay under it.
Screenshot arithmetic: a jump to A puts the A header at 0-23, one A row at 23-81 and the C header at 81-104, and
Captions starts at 104, just under the 105pt bar; the pinned header is A. That is an exact match. The first section's
top was also the list's start, so Browse's bar was out of reach.

Fix: vlist listTop() is offsetTop minus the scroller's padding-top, and is used for rows, the pinned header, idle icons
and headerTops. headerTops re-measures the cached offset at each jump. nav/sectionindex.js sends # and the first
section (and the letters before it) to scrollTop 0.

Ruled out: overflow hidden and the last-letter guard were not the cause, and both are unchanged. Row order against
indexLetter is fine.

Checks:
- web/app/nav/sectionindex.test.js: 5 tests, fake DOM.
- Chromium at 320x568 with F426d's capture.mjs and this folder's make.mjs (which takes B455's make.mjs fill), sideload
  fake bridge, iOS 6/7/13/26 dark. The index is dragged from Z to #, down to Z and back (80 letters), at rest and
  started during a smooth scroll, in Top 25, New and a list opened from Browse. Old code: 94 disagreements per run in
  each of Top 25 and New, ending at scrollTop 107. A list from Browse (its own scroller, no padding): 0. New code: 0
  everywhere, ending at 0.
- No iPhone 15 Pro run: Chromium reproduced the mismatch.

Not verified:
- Installed has no A–Z index (createSectionIndex is only called in screens/browse.js), so there was nothing to drag.
- A source's section list in Chromium (it uses the same packageList in a page body; covered by node tests only).
- Real touches and a real iOS fling: pointer events were synthetic, and a smooth scroll stood in for the fling. No
  real phone was used.
