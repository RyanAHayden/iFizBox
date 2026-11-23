# B388: Concept check follows the era's Sources delete

The concept check (`tools/concept/check.mjs`) failed its Sources swipe and hold checks under the iOS 7, 13 and 26
themes. The app was right. The check still expected iOS 6's red Delete in every era.

## What changed

- `tools/concept/check.mjs`: imports `FULL_SWIPE_ERAS` from `web/app/nav/rowswipe.js`, and picks a check by era:
  - `redDeleteChecks` (iOS 6, unchanged): the red Delete button.
  - `fullSwipeChecks` (new): drags 80% of the row from near its right edge. It expects the row-swipe strip shown,
    kind `remove`, armed, and the content past half. Then it drags back to the start and releases. It expects a
    spring-back and no navigation. The swipe is never released armed, because that would remove the source the
    later runs use.
- The hold check after either path is unchanged.

## Cause

Since B356 (commit `350d0182`), iOS 7, 13 and 26 delete a source with a full-row swipe
(`web/app/nav/rowswipe.js`: `fullSwipeEra` and `FULL_SWIPE_ERAS`; `web/app/screens/sources.js`:
`attachDeleteSwipe`). iOS 6 keeps the red Delete. The check did not know this, so three failures came from one cause:

- The 120 px drag stayed below the half-row arm point, so the row sprang back.
- The follow-up tap then opened row 2's page, which has no Delete to put away.
- The hold check failed on that page.

## Checks

- Concept `check.mjs` in Chromium, jailbreak mode, on `iphone-se` and `iphone-17-pro-max`, with themes
  `light:classic`, `ios7:light:white`, `ios13:light:white` and `ios26:light:white`: all clean.
- Before the fix, `ios7:light:white` on `iphone-17-pro-max` reproduced the same 3 failures.

## Not verified

- The committed swipe (released armed, source removed) is not exercised by `check.mjs`.
- Dark era themes and sideload mode were not run.
- The attribution of failures two and three to the first one comes from reading the code. It was not traced in a run.

## Tried and failed

- None.
