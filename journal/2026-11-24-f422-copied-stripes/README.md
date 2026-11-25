# F422: striped bar while "Copied to iPhone, waiting for iOS"

Done: in `draw()` (web/app/screens/apprun.js) `waiting` is now true for state "signed" (not helper) or state
installing, phase copying, fraction >= 1; rowBar's existing `is-waiting` stripes do the rest. The fill returns at
installd's first percent (phase installing). Test added in apprun.test.js (off at 0.4 copying, on at 1, off at installing).
Release note added.

HUD / single-install bar: they do not draw through rowBar (only apprun.js and queuerun.js do; queuerun is the old
queue page with no copying phase), so skipped.

**Not verified**: the Chromium shot (the stripes use the existing F391 CSS, covered only by the class assertion in node).
