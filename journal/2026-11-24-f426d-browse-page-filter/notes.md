# F426d Browse page filter

Browse's New and Top 25 get a Filter button at the end of the Featured/New/Top 25 bar. Featured has none. `renderBrowseHome` in `web/app/screens/browse.js` builds the bar from `listfilter.js` `listScope` (with `withSegments` false) and puts the three segments in front of it. New and Top 25 keep their own filters and sort while the page lasts; a page pushed again starts clean.

The two lists live in the new `web/app/screens/browsescope.js`: `newRows`, `topRows` and `slideBar`.

- Top 25 filters over every package (popular with no limit, fetched only when a filter is on, once), takes the first 25 in Popular's order, then sorts them. Ranks and the "Ranked by" footer show only in its own order (Most Sources).
- Sort by name uses letters and the A-Z index, as F426c's lists do.
- `listScope` with rows null lists every section (`catalog.sections`), so opening the panel on Top 25 does not need the whole list.
- Show Incompatible, iOS version, architecture and device changes ask the list again.

The bar still scrolls with the page. It is not pinned as F426c's lists are: Featured's bar does not pin either, pinning two of three would jump, and iOS 26's native segments would change. So a Filter tap scrolls to the top first, and `packages.css` holds the page still while the panel is open.

The Filter button and the segments slide in and out and stretch, since nothing may teleport. The bar is `data-noslide`, so `nav/slide.js` leaves it alone. Reduce Motion turns the slide off.

Failed try: a scroll-to-top listener on the bar. Fake DOM clicks do not bubble, so the scroll moved to the button itself. The first iOS 26 Chromium run fell back to iOS 6, because the fake shell said iOS 15.8.8. `capture.mjs` now reports 27.0 with an iOS 27 user agent.

Checks:

- `node --test` in `web/app`.
- Chromium at 320x568 (`capture.mjs` and `make.mjs`, catalog made in the page: the real core catalog for Popular and refine), iOS 6, 7, 13 and 26, light and dark: no label cut, no sideways scroll, with and without the A-Z index. Narrowest segment 77 pt. The panel opens at the bar's bottom after a scroll. No page exceptions.

Shots: `shots-ios6.png`, `shots-ios7-13.png`, `shots-ios26.png`.

Not verified:

- 120 Hz on a real phone.
- A BigBoss-sized catalog through the worker when Top 25 is filtered.

Second attempt (2026-11-25): the first one's merge failed only on main's own date bug in `blocked.test.js` (fixed on
main since), so its commits were put back on main as they were. The spec review found one slip, fixed: Featured and
back within the slide took the leaving Filter button for the real one, which then did not slide in. Top 25's panel
lists every section on purpose, as it filters every package.

Also not verified: the Chromium shots are the first attempt's, not taken again on this main or after that selector
fix (only `node --test` and the gate were).
