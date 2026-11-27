# B488 scope bar swipe

Cause: F373 page swipe back (nav/swipe.js attachPageSwipe) pops on a rightward drag anywhere, incl. the list scope bar. Fix: ".list-scope" added to PAGE_SWIPE_SKIP; edge strip swipe unchanged. Test in pageswipe.test.js.

**Not verified**: not run in Chromium or on a phone (unattended); found by reading code. Search's own scope bar is not changed.
