# F417: On Cellular, and the popup that closes by itself

## What I did
- This iPhone's page has an On Cellular group (after Restore My VPN, before Forget Pairing): Ask Each Time (the default)
  or Use Signing Server, kept in browser storage (`ifizbox.onCellular`, `web/app/core/cellular.js`). Its footer follows
  the pick. The status footer no longer carries the cellular line.
- While an install waits on cellular data, the page shows one popup per run, "You're on Cellular", with Use Signing
  Server and Cancel (`web/app/signing/cellular.js`). It closes by itself once the path leaves cellular: the shell emits
  `offCellular` (`native/sideload/idevice/IDevice.swift`, `native/Sources/Sideload.swift`), which the page reads as the
  end of the wait.
- The wait's row reads "Waiting to leave cellular data" (was "Join Wi-Fi or turn on Airplane Mode").
- Use Signing Server on the popup: `signing.cancel {tag, keep: true}` (`native/sign/SignJob.swift` keeps the signed copy),
  then the run's remaining rows go through the Signing Server, one iOS prompt at a time. Cancel: rows fail with "not
  installed, still on cellular"; Try Again asks anew.
- The setting Use Signing Server: `decideRoute` goes to the server at once on cellular, no popup.
- `ui.alertClose {id}` (`native/Sources/NativeAlerts.swift`) and the `signal` option of `showAlert` (`web/app/nav/alert.js`)
  close an alert from the page.
- Docs: docs/settings.md (This iPhone's footer and the On Cellular group), docs/sideload.md (the cellular paragraphs),
  docs/eras.md (the native alert row), release-notes/F417.md.
- Tests: `web/app/core/cellular.test.js`, `web/app/signing/cellular.test.js`; `web/app/module-graph.test.js` startup
  limit 118 to 120 for the two new modules (core/cellular.js, signing/cellular.js).

## Split
The whole was too big for one task, so it is split:
- **F417a**: native Shortcut Cellular Installs.
- **F417b**: the Use Shortcut option, the popup's button for it, and Check Connection checking the Shortcut.

Signing the Shortcut needs the MBA, which did not answer ssh on 2026-11-24 ("Connection timed out", tried twice), so
F417a's signing waits for it.

## Decisions made without asking
- The popup uses the user's own Signing Server, like the setting. The failure's "Use the Signing Server" still uses
  the default server.
- The startup module limit goes from 118 to 120 for the two new modules.
- A single install (not through the queue) downloads and signs again for the server, because `signing.install` keeps
  nothing on cancel. Only the queue keeps the signed copy (`signing.cancel {keep: true}`).
- The older `signing.resign` and `signing.resignAll` calls show no popup, only the line ("Join Wi-Fi or turn on Airplane Mode", AIRPLANE_ASK) and the log, but they follow the
  On Cellular setting.

## Tried and failed
- Nothing worth noting beyond the ssh to the MBA (timed out, see Split).

## Not verified
- Real cellular: the 15 Pro has no SIM. So the popup over a real wait, and its closing by itself, are untested on a phone.
- The native iOS 26 alert closing itself on a phone: it is compiled and tested only through a fake bridge.
- Done, not a gap: Chromium (fake bridge) drew the page's group and the popup in iOS 6, 7 and 26, light (shots.png: iOS 6 popup, the
  other option picked, iOS 7 popup, iOS 26 page); the CSS popup went by itself on iOS 6 and 7. The iOS 26 alert is native, so it
  wasn't drawn there. The sideload IPA builds.
- Dark themes and iOS 13 were not shot.
