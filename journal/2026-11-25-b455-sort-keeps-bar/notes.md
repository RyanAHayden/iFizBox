# B455 Sort keeps the bar still

Cause confirmed: Name adds the A-Z index, and two packages.css rules on data-section-index padded the bars right by
24px. The rules are removed for Browse's page and narrowed to .installed-search/.installed-scope for pinned pages.
Installed is pinned, so it needed that rule; its look is unchanged.

Index position: on Browse's page it starts 50px under the nav bar (44px bar + 6). In lists opened from Browse it starts
94px under (search 44 + scope 44 + 6), and 30px more under the queue run's strip (body.qr-stripped, --strip-room).
It is a fixed top, CSS only, so it stays put when Browse's bar scrolls away (no layout per scroll frame).
nav/sectionindex.js needed no change.

Found in Chromium: on iOS 13 and 26 the Filter label turns semibold once a Sort is chosen, which made the button 3px
wider. The first run failed on it. Browse's bars (listfilter.js adds .list-scope) give
Filter, the selected Filter and Done one 56px width. Search's own Filter button is untouched.

Found at 874x402 (phone on its side): 27 letters did not fit below the bars and ran under the tab bar. Letters now
shrink (min-height 0), and are 7px when the screen is at most 460px high, only for these lists.

Checks:
- web/app/screens/browsescope.test.js: B455 test.
- Chromium with F426d's capture.mjs (size from env) and this folder's make.mjs, sideload fake bridge, 320x568, iOS
  6/7/13/26 dark. Bar, segments, Filter/Done and search field rects are identical under Most Sources, Name, Newest,
  panel open and closed, in Top 25, New and Popular lists (84 of 84 comparisons). Every index letter hit-tests to the
  index (32 of 32), also scrolled and with the strip class. No label cut.
- iOS 6 at 874x402: 21 of 21 and 8 of 8.
- Shot: shots-name.png (iOS 6 and 26).

Not verified: real phones (WebKit, real SF font, native iOS 26 segmented control).
