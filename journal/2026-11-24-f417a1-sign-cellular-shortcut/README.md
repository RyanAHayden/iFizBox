# F417a1: sign the Cellular Installs shortcut

## What I did
- `native/sideload/vpn/App/CellularShortcutBridge.swift`: the bridge `cellular.status`, `cellular.add` and
  `cellular.check`, and the `ifizbox://cellular-installs` callback. It is registered from `LocalVPN.swift`, and
  `App.swift` routes the callback URL to it.
- `native/sideload/vpn/App/CellularShortcut.swift`: `verdict()` decides a check from its own actions (ok, not_run,
  no_end, no_return, busy), and `runURL()` builds the Shortcuts link that opens a run.
- `native/sideload/vpn/App/LocalVPN.swift` and `native/Sources/App.swift`: the wiring for the bridge and the callback.
- `native/sideload/vpn/tests/main.swift` and `native/sideload/vpn/test_vpn.py`: tests for the verdict and the run URL.
- `docs/sideload.md`: a paragraph on the bridge after the built-in VPN bullet.

## Signed
- The main checkout's `ref/shortcuts-signed/Cellular Installs.shortcut` (signed on the MBA 2026-11-24, 22641 bytes,
  starts `AEA1`) is copied to `web/app/shortcuts/Cellular Installs.shortcut`. The plist beside it is byte-identical
  to `tools/shortcuts/cellular-installs.plist`. `sign.sh` was not run again in this session.
- `test_signed` in `native/sideload/vpn/test_vpn.py` checks that the file exists under `CellularShortcut.shortcutName`
  and starts with `AEA1`. The built IPA contains it.

## Decisions
- A new file, not `LocalVPN.swift`: `CellularShortcut.swift` stays Foundation-only so Linux can test it, and
  `LocalVPN.swift` stays free of Shortcuts.
- The callback never decides. At most it starts the count of time back in front (see Review).
- The check's limit is 60 s, because the first run waits for the user's Allow.
- No automatic retry. Every retry is another hop to Shortcuts.
- A check that never opened Shortcuts (`not_opened`) leaves `added` as it was. Every other failure except `busy`
  clears it.
- No site fallback as `importShortcut` had: once signed, the file is always bundled.
- No release note: nothing on screen uses the bridge yet.

## Phone checks
iPhone 15 Pro (iOS 27.0.1), Wi-Fi, no cellular service (status bar says SOS), this branch's build. Bridge calls went
over webinspector, since Chromium can't run Shortcuts or App Intents.
1. Before adding: status {available true, bundled true, added false}; check -> not_run, text 'Could not find the
   shortcut "Cellular Installs."', returns to the app.
2. add: the share sheet shows Cellular Installs, Shortcuts is in the app row -> Add Shortcut sheet; the bridge
   answers {opened: true}.
3. First check: prompt 'Allow "Cellular Installs" to run actions from "iFizBox"?' -> Allow -> ok, added true. This
   ran right after an earlier failed run, so a stale error did not break it.
4. Two more checks: ok, no prompt.
5. Deleted in Shortcuts: check -> not_run, added false.
6. Added again: prompt -> Don't Allow -> not_run, text 'This shortcut can't access "iFizBox". You can change this in
   the shortcut's privacy settings.', added false. The next check asks again -> Allow -> ok, added true.

Left on the phone: Cellular Installs added once and allowed, this branch's build, lock given back. Other Shortcuts
untouched.

## Not verified
- That a check leaves cellular data alone, by measurement (the phone has no service; `test_plist` only checks that the
  check branch has no data action).
- The `run` and `on` inputs (not this task).
- The Allow prompt left unanswered to the 60 s limit.
- `no_end`, `not_opened` and `busy` on the phone.
- iOS 16 to 26.
- Replace on add.
- Another bundle ID.

## Gate
- The first gate run failed only in `native/test_bridge_contract.py`: every Swift handler needs a caller in `web/app`.
  So `web/app/core/cellularshortcut.js` holds the three calls; F417b's screens use them.

## Review
- Fixed: Shortcuts' callback no longer ends a check (a stale one during Allow would have failed it). Only the time back
  in front does, counted in the time the process ran (suspended time doesn't count); the last callback's error is kept
  as text only. This replaces the 3 s callback grace above.
- Kept: `cellular.status` and its `added`, which F417b's "adds the Shortcut first if it is not added yet" needs.
