# B370: fast taps on the Select button show the wrong menu

Quick repeat taps on the Select button in Manage mode no longer change what the menu shows. Rapid taps now
show the same four options every time.

## What it was

I read "mode select (the ... button)" as the Select… button in Manage mode. Manage mode is on the Installed Apps
page and on My IPAs. The button opens the preset sheet: All Apps, Expiring Soon (n), Not Signed Here (n) and
With Updates (n). When every row is picked, the button reads Deselect. Both pages go through `selectPreset` in
`web/app/nav/selection.js`. I searched `web/app` and `native/Sources` for other "..." buttons that open a mode
choice and found none.

Under Theme > Style iOS 26 the sheet is an Anchored menu (`menuSheet` in `web/app/nav/actionsheet.js`). It grows
out of the button with the button's top-left corner pinned, so it covers the button. A second tap at the same
spot then lands on the menu's first item, All Apps. Everything gets picked and the button turns into Deselect.
The next tap clears the selection with no sheet. The tap after that opens the menu again. The cycle repeats
every three taps.

Reproduced in Chromium before the fix, 12 taps 120 ms apart: tap 2 showed Deselect with 3 picked, tap 3 showed
Select… with 0, tap 4 opened the menu, and so on.

## What changed

- `web/app/nav/actionsheet.js` (`menuSheet`): a press on a menu item or on the dimmed area counts only if its
  touch went down at least 380 ms after the menu opened (the grow animation, `MENU_IN`). It also has to be at
  least 300 ms after the touch before it (`MENU_REPEAT`, now exported). The opening tap counts as the first.
  Other presses do nothing, and the menu stays open and unchanged. A click with no touch behind it (keyboard,
  `el.click()`) always counts. Escape still closes the menu.
- `web/app/nav/selection.js` (`selectPreset`): one sheet at a time. A tap while its sheet is open resolves to null
  and changes nothing, Deselect included. This covers the glass bar's button, which sits above the page, so the
  menu's dimmed area does not cover it. It also covers the shell's own native sheet (`ui.actionSheet`).
- `web/app/nav/select-rapid-taps.test.js` (new): fast presses during the grow and in a run pick nothing, and the
  menu keeps the same items. A press after the run stops does pick. A keyboard click picks. Re-entering
  `selectPreset` opens no second sheet.

## How it was checked

- `node --test` on `web/app/nav/select-rapid-taps.test.js`, plus the existing installed-manage, myipas-page and
  actionsheet tests. All pass.
- Chromium, headless, with the fake `ifizboxNative` in sideload mode. `app.info` answers iOS 18.1, so the CSS
  menu is used. The `ui.*` calls fail, so the page falls back to its CSS sheet. Everything else answers null.
  Theme > Style is iOS 26, three apps are in the install store, Manage is on, and the taps are CDP mouse events
  at the button's centre. The script is `probe.mjs` in this folder. Run it as
  `node probe.mjs <base url> [gap ms] [taps]` against `web/app` served over http. The output is in `after.txt`.
- After the fix, 12 taps at 120 ms and 20 taps at 60 ms each showed one menu with the same four items:
  All Apps | Expiring Soon (0) | Not Signed Here (3) | With Updates (0). The button stayed Select… and nothing
  was picked. One slow tap after a 1 s pause picked All Apps (Deselect, 3 picked).
- With taps 500 ms apart, each tap is a real pick: open, All Apps, Deselect, open. That is intended.

## Tried and failed

- The probe's Chromium profile in the session scratchpad never answered on its CDP port. The cause was a very
  long TMPDIR path. The default tmp dir works.

## Not verified

- The real iPhone, iOS 26 and later with glass bars and the native sheet. The task asks for a Chromium check,
  and phones are used only where Chromium cannot check. The native `ui.actionSheet` path is covered only by the
  `selectPreset` unit test.
- The bottom sheet in the other styles (iOS 6, 7 and 13) is unchanged. There the sheet rises from the bottom and
  does not cover the button, so a fast tap on the dimmed area still closes it. That is outside this task's iOS 26
  scope.
