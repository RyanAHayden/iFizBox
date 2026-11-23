# B351: iOS 26 sheets opened from a button pop out of it

## What was wrong
Every action sheet goes through `web/app/nav/actionsheet.js` `showActionSheet`. The CSS sheet always rose from
the bottom. In the app under the native controls hook (iOS 26+ WebKit), the shell's UIAlertController pointed its
popover at `tapRect()`: the element the last *pointerdown* landed on, any button/link/row, within 3 s. With no
fresh rect the shell falls back to the bottom middle. So the same button gave a popover one time and a bottom sheet
the next, depending on whether a pointerdown reached the page (the native glass bar buttons, F367, dispatch a
click with no pointerdown) and how long the caller took before opening the sheet.

## What changed
- `showActionSheet({ from })`: the source button, an element or a rect. Without it, `sourceRect()` uses the
  button the last recent tap *or click* landed on (buttons and `[role=button]` only, not rows). A tap on an open
  sheet's own button keeps the original source (Modify > Downgrade grows from Modify again).
- Native path: the popover rect is `sourceRect(from) ?? tapRect()`, so the source button wins when known.
- CSS path in the iOS 26 era with a source button: `menuSheet`, an anchored menu (`.action-menu`): covers the
  button with its corner pinned (grows down from the button's top, or up from its bottom when there is more room
  above; left- or right-aligned by which half the button is on), clamped into a measured room inside the safe
  areas. It animates from the button's rect (translate + scale, origin top left) with a slight spring and folds
  back into it on dismiss: transform and opacity only. No Cancel; a tap outside or Escape answers -1.
- Every other era, and an iOS 26 sheet with no source button (timers, rows), keeps the bottom sheet.
- Installed > Manage > Select… passes `from: view.wish` (its button) explicitly; Modify and the other
  button-opened sheets get their source from the click.
- Look in `ios26.css` (tokens `--i26-menu*`, the sheet's `--action-*` tokens re-pointed inside `.action-menu`);
  layout in `packages.css`. `theme-palette.test.js` now allows the menu as a fourth blurring rule (its glass sits
  over a still page).

## Checks
- `node --test` in web/app: pass (new `nav/actionsheet-menu.test.js`).
- Chromium at 402x874@3x, `probe.mjs` here (fake bridge, iOS 18 UA so the CSS path): Select… (installed.js
  `selectButton`, real CDP taps on Installed's top-left button) and a Modify-like sheet with no `from`, three opens
  each per era. iOS 26: `.action-menu` at the same rect all three times, frames at 0/60/140/380 ms show it growing
  out of the button. iOS 6, 7, 13: the bottom `.action-sheet` with Cancel, same rect each time. No page errors.

## Not verified
- The native path on a phone (UIAlertController popover with the source button's rect): the change only feeds it a
  steadier rect; checking it needs the iPhone 15 Pro and the app build, and AGENTS.md keeps web changes to Chromium.
- The real package page's Modify with real package data: the fake bridge has no packages; the probe drives the same
  `showActionSheet` call with no `from` from a nav bar button tap, which is the path browse.js's Modify takes.
- Safe-area insets in Chromium: the emulation has none, so the room probe's inset handling was seen only with zero
  insets (the menu clamps to 8px from the top there).
- The dark theme frames of the menu were not shot (the tokens are defined for dark; the unit and palette tests pass).
