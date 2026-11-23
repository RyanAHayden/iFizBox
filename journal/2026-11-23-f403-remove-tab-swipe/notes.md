# F403 remove swiping between Details, Reviews and Related

Done: removed attachTabSwipe, tabSwipeTakesBack, tabPagers, tabSwipeDecide, TAB_SWIPE_SKIP and F390's extras in
attachPageSwipe / pageSwipeBlocked (decide, clamp, ends, point, cancelled) from nav/swipe.js; the app.js wiring;
the finger half of nav/tabswipe.js (begin/move/end, rubber). `storeTabs().swipeOn` is now `attach` (it only marks the
page the panes slide in). Tap slide unchanged. Tests: tabswipe.test.js keeps tap, shorter-pane, rapid-tap,
reduced-motion cases; storepage.test.js adjusted. node --test: 3516 pass. Release note F403.md added (F390's shipped in v0.26.0).

**Not verified**: Chromium sideways drags on each tab of both pages (no browser run in this session; the touch code is
gone and app.js's only page swipe is the pre-F390 one, so swipe back is unchanged by construction).
