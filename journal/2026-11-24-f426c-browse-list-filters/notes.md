# F426c Browse list filters

A list opened from Browse (collections, New, Popular, categories...) gets the same scope bar and Filter panel as Search, plus Sort. `renderSearchableList` in `web/app/screens/browse.js` pins the shared search bar and scope bar, as Search does. The list's logic is in `web/app/screens/listfilter.js`: a per-page filters object, Sort, the list's sections, and its note. `web/app/screens/filterpanel.js` takes optional `sorts`, `sectionRows` and `compatFooter`.

- Filters go through `catalog.refine` (F426b) only when something is picked. The typed query is filtered after, on the page.
- Clear Filters leaves Sort, because Sort is not a filter. Filter looks selected while Sort isn't the default.
- Sort labels: New = Newest, Recently Updated, Popular = Most Sources, Featured, and the rest Name. A catalog sort with the same label is left out. Newest uses the AltStore version dates; tweaks have none, so they go last, by name (from F426b).
- Scope bar segments are left out on categories, Free lists, and collections of one kind (Themes, Make It Yours, Play, Create, Connect, Tools).
- The A-Z index is made and removed as the order changes, hidden while the panel is open (`packages.css`), and not made for an empty list.
- Show Incompatible and the other switches fetch the list again.

Segments and filters moved to the leaf module `screens/searchscope.js`; `search.js` and `filterpanel.js` re-export them. A first try imported `search.js` and `filterpanel.js` statically from `browse.js`, which closed an import cycle: `onSourcesChanged` ran before initialization and many tests failed. `filterpanel.js` is now imported dynamically by `listfilter.js`.

Checks:

- `node --test` in `web/app`: all pass.
- Chromium (`capture.mjs`, fake bridge), jailbreak build (a `--native` phone dir with Havoc, Chariz, BigBoss): Free Tweaks, Lock Screen, Popular, Keyboard in all four eras, light and dark (iOS 26 with `app.info` ios 27.0 and an iOS 27 UA).
- Chromium, Lite (`--mode sideload`): New, Recently Updated, Popular, Utilities.
- Back keeps the chosen sort and filter; pushing the list again shows it clean; leaving closes the panel.
- Scrolling Free Tweaks' 278 rows: p50 16.6 ms, p95 17 ms, max 25 ms a frame (at 60 Hz).

Not verified:

- 120 Hz on a real phone.
- The native iOS 26 segmented control over these lists (`ui.segments`): Chromium has no shell.
- New with several days of real rows. Lite's New was empty in Chromium; the day headers are covered by the test and by Recently Updated.
- BigBoss-sized lists (thousands of rows) through the worker on a phone.

`shots-ios6.png` and `shots-eras.png` predate the rule that hides the A-Z index under the open panel; `shots-ios26.png` shows it.
