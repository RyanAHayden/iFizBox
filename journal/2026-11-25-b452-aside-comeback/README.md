# B452: Aside comeback

Open Now on a run page while iFizBox's own update sat locked on Waiting for iOS or Closing iFizBox hid the page for
good. The run had already ended, and end()'s show had passed, so nothing brought the page back.

## What was done

- `web/app/screens/apprun.js`: `comeBack()` shows the page when it is hidden and not put away with Hide. `selfFinish`
  calls it on every finish that followSelf and followHere draw (Closing, the hint with Try Again and Return, close by
  hand, restart), and it also runs after the "Not Updated" finish (notStarted).
- `web/app/screens/apprun-aside.test.js` (new): 7 tests with a fake page.

## How it was checked

- The 7 tests pass; with the apprun.js change taken out, 6 fail (the seventh is the closed-page guard). All the
  apprun and incoming tests pass.

## Tried and failed

None.

## Not verified

- Not driven on a phone or in Chromium. It needs a real self-update held at iOS's prompt plus a link at the same time.
- page.show() and page.hide() are unchanged from the Hide work (F430).
