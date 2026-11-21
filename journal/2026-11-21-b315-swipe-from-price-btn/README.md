# B315 Swipe from the SIGN/INSTALL button shows Delete

## What I did
- `web/app/screens/myipas.js` attachLibraryGestures: pointerdown on `.price-btn` now starts a swipe (only
  `.del-confirm` is excluded), and the click capture swallows the click after a swipe before it lets a `.price-btn`
  click through, so a swipe's lift never signs/installs. A plain tap on the button still reaches `on.price`.
- The other swipeable rows:
  - `sources.js` attachRowGestures: same bug class. The pointerdown doesn't skip `.del-toggle` (the minus while
    editing), but the click capture returned early for it before the `swiped` check, so a swipe started on the minus
    armed the row and the minus's own click then disarmed it. The click after a swipe that lands on the minus is
    now swallowed.
  - `installed.js` attachRowGestures: not affected. Its rows have no button but the minus and Delete; swipes are off
    while editing (when the minus shows), and Delete can't start one. Left as is. (The brief says "app.js
    attachRowGestures": `web/app/app.js` has none; Installed's is this one.)
  - `signed-apps.js`: its rows' only button is Delete, which can't start a swipe. Not affected.
  - `nav/rowswipe.js` (Search/package rows): no button is excluded from starting a swipe, and its click eating
    doesn't return early for any button. Not affected.
- The click capture is registered with `true` (capture phase), so swallowing it stops the button's own listener.
  In the node test the fake DOM doesn't carry a click from the list to the button, so "on.price not called after a
  swipe" is shown there as the click being stopped; the Chromium check counts on.price calls directly.
- `b136-swipe.test.js`: new case: a tap on the button goes through to `on.price`; a swipe from the button arms
  Delete and the click that ends it is swallowed.
- Chromium check (`check.mjs`): the app's own `libraryGroup` and CSS in headless Chromium, real CDP mouse events.
  Result: click on SIGN reaches on.price; a left drag from SIGN shows Delete (`swiped-from-sign.png`) and doesn't
  reach on.price.

## Tried and failed
- Running the same Chromium check against a scratch worktree of main (to see it fail before the fix): its
  http.server died with the shell that started it and the check timed out on a dead port. Not retried; the node test
  covers the pre-fix path (pointerdown on `.price-btn` set no start, so no arm).

## Not verified
- On a real phone (touch, not mouse): the gesture code is pointer-event based and the same on both; AGENTS.md says
  Chromium is the check for web/app changes.
- Sources' minus-swipe fix only by reading the code (no test added; sources.js isn't in this task's test file).
- The screenshot's SIGN button is unstyled because the list is drawn straight into the body, outside the page that
  scopes its CSS; the look isn't what this check is about.
