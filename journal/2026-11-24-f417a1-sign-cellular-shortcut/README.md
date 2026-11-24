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

## Not signed
- `ssh mba` timed out, `tailscale status` says mbas-macbook-air is offline, `tailscale ping` got no reply, and no
  other Mac is reachable. The task says to block rather than ship an unsigned file, so nothing was signed and the
  signed Shortcut is not in the repo.

## Decisions
- A new file, not `LocalVPN.swift`: `CellularShortcut.swift` stays Foundation-only so Linux can test it, and
  `LocalVPN.swift` stays free of Shortcuts.
- The callback never decides. It only ends the wait, after a 3 s grace, because iOS 27 gives a run the previous
  run's error.
- The check's limit is 60 s, because the first run waits for the user's Allow.
- No automatic retry. Every retry is another hop to Shortcuts.
- A check that never opened Shortcuts (`not_opened`) leaves `added` as it was. Every other failure except `busy`
  clears it.
- No site fallback as `importShortcut` had: once signed, the file is always bundled.
- No release note: nothing on screen uses the bridge yet.

## Remaining
- Once `mba` is up: run `tools/shortcuts/sign.sh`, commit the signed file, then add a test that the bundled file
  exists and starts with `AEA1`.
- iPhone 15 Pro: add the Shortcut, tap Allow, run check, then check with the Shortcut missing. Delete the old one
  before adding again: Replace leaves two, and neither runs by name.

## Not verified
- Signing and import of the Shortcut.
- Everything on the phone, including the share sheet and the stale-callback timing.
- iOS 16 to 26.

## Gate
- The first gate run failed only in `native/test_bridge_contract.py`: every Swift handler needs a caller in `web/app`.
  So `web/app/core/cellularshortcut.js` holds the three calls; F417b's screens use them.
