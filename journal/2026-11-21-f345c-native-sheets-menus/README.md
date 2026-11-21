# F345c: native action sheets and long-press menus (ui.actionSheet, ui.menu)

Plan: `journal/2026-11-21-f345-ios26-native-controls/README.md` ("Action sheets", "Long-press menus").

## What I did

- `web/app/nav/actionsheet.js`: `showActionSheet` asks `wantsNativeControls()` first (the bridge takes calls and
  `<html data-controls="native">` is on). Then it sends `ui.actionSheet` `{title, buttons, cancel, destructive: [..],
  rect?}` and answers the shell's index (anything out of range is -1, Cancel). `rect` comes from a new optional
  `anchor` option or, since no caller passes one, from the element the last touch went down on (a capture
  `pointerdown` listener, `tapRect()` takes its nearest button/row). A rejected call (an older shell, no window)
  shows the CSS sheet, which is the old body, now `cssSheet()`, unchanged.
- `web/app/nav/menu.js`: `showMenu` under the same rule sends `ui.menu` `{items, rect, x?}` at the anchor's rect,
  keeps the anchor's `is-held` look while it waits, and runs the chosen item's `onClick`. -1 (put away) runs
  nothing; the returned `close()` stops a later answer from running anything. A rejected call shows the CSS callout
  (`cssMenu()`, the old body, unchanged).
- `copyText` (menu.js): when WebKit refuses `navigator.clipboard.writeText`, it now tries the shell's new
  `clipboard.write` before the old `execCommand` path. **Needed for the native menu**: its Copy runs after the
  shell's answer, outside the touch WebKit wants for a clipboard write. On the phone the write was refused and
  `clipboard.write` put the URL on the pasteboard (below). Elsewhere nothing changes: the first write still wins
  when WebKit allows it.
- `native/Sources/NativeMenus.swift` (new): `ui.actionSheet` is a `UIAlertController(.actionSheet)`: buttons,
  `.destructive` for the red ones, a `.cancel` action unless `cancel` is ""; its popover (`sourceView` the web view,
  `sourceRect` the page's rect, else the bottom middle) and a popover delegate that answers -1 when it's put away.
  `ui.menu` lays an invisible `UIButton` over the rect with `menu` + `showsMenuAsPrimaryAction` and calls
  `performPrimaryAction()` (iOS 17.4+). A `UIButton` subclass overrides `contextMenuInteraction(_:willDisplayMenuFor:)`
  to know the menu showed; if not within 0.4 s it tries `UIEditMenuInteraction.presentEditMenu` at the finger
  (iOS 16+), and if that doesn't show either it answers an error (the page then draws its CSS callout). Put away
  with no choice, it answers -1 once the menu's dismissal finishes (+0.1 s, so a chosen item's `UIAction` answers
  first).
- `Bridge.swift`: registers `NativeMenus` and adds `clipboard.write {text}` (UIPasteboard).
- `web/app/nav/menus-native.test.js`: routing for both (params, answers, out-of-range, -1, close), the last-touch
  rect, the fallbacks (no hook, the site, an old shell), copyText's fallback, the Swift handlers' shape.

## Which way opened the menu: performPrimaryAction

On the iPhone 15 Pro (iOS 27) **`performPrimaryAction()` opened the button's UIMenu**: a glass UIMenu (vertical list)
over the held row, light and dark. The edit-menu path never ran (no "trying UIEditMenuInteraction" needed: the menu
was a vertical glass list, not the edit menu's horizontal callout). The edit-menu fallback stays for a 16.x–17.3
shell, where the native controls hook is never on anyway, and in case a later iOS stops opening it.

## Checked on the iPhone 15 Pro (iOS 27)

The Lite IPA from this branch (`native/build.sh ipa`), installed with `tools/ui-15.sh` under its lock. The phone is
on the iOS 6 style; I set `data-style="ios26"` and `data-controls="native"` on `<html>` over
`pymobiledevice3 webinspector cdp` (not saved: the app puts its own back on each screen), and wrapped
`ifizboxNative.call` to log `ui.*`/`clipboard.*` answers. Touches through WDA. Shots in the worktree's
`ref/15/screens/f345c-*.png` (gitignored: iOS's status bar).

- **Action sheet, no tap seen** (`f345c-sheet.png`): on iOS 26+ an iPhone action sheet with a source is a
  **popover** (glass bubble with an arrow), not a bottom sheet, and it **hides the Cancel action** (a tap outside is
  Cancel). It pointed at the fallback bottom-middle rect. A tap outside answered `-1`.
- **Action sheet from a tapped row** (`f345c-sheet-tap.png`): a click on Install IPAs opened it; the arrow points at
  that row (`tapRect()` gave `{x:16, y:376, width:361, height:48}`). Tapping Remove answered `1`.
- **Modify's real sheet** (`f345c-modify.png`): iFizBox's own app page (Sources > iFizBox > All Apps > iFizBox),
  Modify: a popover from the Modify button with Reinstall, Downgrade, Re-sign and a red Mark as Not Installed;
  rect `{x:311, y:62, width:77, height:38}`. A tap outside answered `-1` (nothing chosen).
- **Long-press menu on Sources** (`f345c-menu.png`): a 1.5 s hold on Chariz opened a glass UIMenu, "Copy URL",
  over the row, which stayed in its held look. The finger lifting after the menu showed chose nothing (no answer
  until the next tap). Tapping Copy URL answered `{index: 0}`; `navigator.clipboard.writeText` was refused, so
  `clipboard.write` ran, and `clipboard.read` then gave `https://repo.chariz.com/`.
- **Menu put away** (`f345c-menu2.png`): hold on Havoc, tap elsewhere: `{index: -1}`, no `.is-held` and no CSS
  `.menu` left.
- **Dark** (`f345c-menu-dark.png`): `app.theme` dark/OLED through the bridge, a two-item menu from script: a dark
  glass UIMenu. Put away: `-1`. The app was relaunched afterwards so it re-sent its own theme (iOS 6, light).

Chromium can't check this: the native sheet and menu exist only in the shell.

## Tried and failed

- My first test of the CSS-callout fallback ran into `innerWidth` missing in Node and then into the callout's
  next-turn listeners landing after the fake document was put back; the test now sets `innerWidth` and waits a turn.

## Not verified

- **The `UIEditMenuInteraction` fallback**: `performPrimaryAction()` worked, so it never ran on the phone; only
  compiled.
- **A shell without `ui.actionSheet`/`ui.menu`** on a real phone: no older build installed. Covered by the Node tests
  with a fake bridge that answers "unknown method".
- **iPad**: no iPad here. The popover gets a source rect either way, so it can't crash for lack of one.
- **iOS 26.0–26.x**: the only iOS 26+ phone here runs iOS 27.
- **The jailbreak build (.deb) on the iPhone 7**: iOS 15, where `data-controls="native"` is never set; the gate's
  native build compiles both builds.
- **The menu's place**: UIKit opens a button's menu over the button, so the menu covers the held row (the iOS 26
  pull-down look) rather than sitting above it as the iOS 6 callout does. Left as UIKit draws it.
- **The iOS 26 style itself through Settings**: the phone stayed on iOS 6; the hook was set by hand for the check,
  so the hook's own rules (F345a) weren't part of this check.
