# B359: Cellular Shortcuts' Add opened an empty Shortcut and said Added

Report (bug, critical, iPhone 18 Pro, iOS 26): Add on Cellular Shortcuts opened Shortcuts on an empty new Shortcut.
Back in the app the row said Added with no check, so there was no way to get the Shortcuts.

## What changed

- `tools/shortcuts/cellular-off.plist` and `cellular-on.plist`: our two Shortcuts as plists. Each is Receive Text input
  (continue if none); If Shortcut Input has any value, then nothing; Otherwise, Set Cellular Data Off/On; End If; and a
  final Nothing action.
- `tools/shortcuts/sign.sh` signs them on the MBA (`ssh mba`, `shortcuts sign --mode anyone`; plain ssh, no GUI session
  needed) and writes `web/app/shortcuts/Cellular Data Off.shortcut` and `Cellular Data On.shortcut` (signed AEA1 files,
  ~22 KB). Shortcuts names an imported Shortcut after the file name, so the file names must match `SHORTCUT_NAMES` and
  `LocalVPN.shortcutNames`. The site serves them (web/app is the Worker's static assets); the app bundles them at
  `web/shortcuts/`.
- Native, `native/sideload/vpn/App/LocalVPN.swift`:
  - `vpn.openShortcuts {which, url}` shows the bundled signed file in a share sheet (UIActivityViewController). Shortcuts
    is in its app row and opens the Add Shortcut sheet. Without the bundled file it opens `url`
    (`https://<DOMAIN>/shortcuts/<name>.shortcut`) in Safari.
  - New `vpn.checkShortcut {which}` runs the Shortcut through x-callback-url with input text "check". The Shortcut does
    nothing on that input, so data isn't turned off. It stores `added` = whether it ran. It retries up to 3 times (1.5,
    3, 5 s): right after Add Shortcut's Replace (a Shortcut of that name existed), Shortcuts answers "Could not find the
    shortcut" for some seconds.
  - Every `runShortcut` first waits up to 3 s for the app to be active. The page turns visible before iOS calls the app
    active, and the open was refused ("wasn't in front").
  - `vpn.testShortcuts` stores each Shortcut's `added` as whether it ran (before, it was only ever set true).
- Web:
  - `core/installroute.js`: `shortcutFileURL(k)`, `shortcutDidntRun(k, err)`.
  - `screens/installroute.js`: `addShortcut` runs open, then `backInApp` (page hidden, then visible), then
    `vpn.checkShortcut`. Added only when the check passes. `shortcutGroups` gains `checking` (the row spins "Checking…")
    and `failed` (the group footer turns red: "\"Cellular Data Off\" didn't run: <error>. Tap Add to try again.").
  - New footers. Turn Off: "Tap Shortcuts, then Add Shortcut, and come back. It turns data off for the moment an install
    connects." Turn On: "The same for the one that turns data back on once the install has connected."
- Tests: `web/app/screens/installroute-b359.test.js` (add → not Added until the run passes; a failed run keeps Add with
  the footer; a closed share sheet or still away runs nothing; `backInApp`; signed files exist under their names).

## Tried and failed (keep these)

- `shortcuts://import-shortcut?url=<our https file>&name=…` on the iPhone 15 Pro (iOS 27): "Import Failed: The shortcut URL
  provided was invalid." It takes only iCloud share links.
- Opening the https file link in Safari works, but needs Download, then Downloads, then tapping the file: three extra
  steps, so it is only the fallback.
- WFCondition 99 ("contains") with WFConditionalActionString lost its text on import (showed "contains", nothing else).
  WFCondition 100 ("has any value") imports correctly.
- Without the final Nothing action, a check run asked "Allow 'Cellular Data On' to output 1 text item?" (x-callback
  returns the last action's output).
- The first build marked the check failed: "iFizBox wasn't in front, so iOS wouldn't open Shortcuts". That is the
  active-wait fix above. A single 1.5 s retry after Replace passed once and failed once, hence 3 retries.

## Checked

On the iPhone 15 Pro (iOS 27, `tools/ui-15.sh`) with the built IPA:

- Add → share sheet → Shortcuts → Add Shortcut → back to the app → row "Checking…", then "Added" for Cellular Data On
  (fresh import) and Cellular Data Off (Replace path). No output prompt.
- A failed check left the row on Add with the red footer.
- Test Shortcuts then said "Shortcuts Work: Both ran", the path installs without input use.
- The signed files' actions were looked at in Shortcuts' editor: Receive Text, If Shortcut Input has any value,
  Otherwise, Turn Cellular Data Off/On, End If.
- `node --test` on the B359, F372 and B357 installroute tests passes.

## Not verified

- iOS 26 on the user's iPhone 18 Pro. Only the 15 Pro (iOS 27) is here, so the share sheet and import UI may differ.
- That Set Cellular Data really turns data off and on. The 15 Pro has no SIM ("SOS" in the status bar), so on Wi-Fi
  Test Shortcuts only proves both ran. On cellular, wentOff still needs a look on a real phone.
- The Safari fallback (no bundled file) was only seen as far as the download sheet, not through the app. Every build
  bundles the files.
- The files on ifizbox.com go live with the next site deploy. Only checked served from a local server through
  `tailscale serve`.
- The signature's lifetime. `--mode anyone` signs with the MBA's iCloud account. If Apple ever refuses old signatures,
  re-run `tools/shortcuts/sign.sh`.
