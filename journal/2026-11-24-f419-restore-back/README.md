# F419: Restore My VPN's back run from the app

## Did

- `native/sideload/vpn/App/LocalVPN.swift`: the removal code is gone (`giveBack` and the removal it ran). Our configuration is never removed; `LocalVPN.restore` and `vpn.setRestore` stay.
- `native/sideload/vpn/App/RestoreBack.swift`: the owed flag (`ifizbox.vpn.backOwed`), the looks, and the back run under `startLock`.
- `native/sideload/vpn/App/RestoreDue.swift`: when a back run is due (`step`) and when a failed one is tried again (`stillDue`).
- `native/sideload/vpn/test_restoredue.py` and `native/sideload/vpn/test_vpn.py`: the removal cases are replaced by the back-run cases.
- `web/app/screens/installroute-b357.test.js`: the Quiet Pairing Check skip with the switch on.

## Decisions

- R100b says go.
- Gate on `remembered`: a phone with the switch on but no Shortcut is not sent to Shortcuts after every queue.
- `remembered` is in `idevice.status` for F420, so the page can show it.
- The back run runs under `startLock`, so Set VPN can't take our tunnel down mid-start.
- Owed is cleared before Shortcuts opens, so an app killed meanwhile doesn't open it again.
- `SignJob.anyGoing` counts as a queue going on, so an app being signed holds the back run.

## Tried

- The first build looked too early between two installs and lost 7 s. Fixed: the look waits for the queue to end.
- On return the app isn't active yet, so the look wait was shortened from 5 s to 2 s.

## Measured (iPhone 15 Pro, iOS 27.0, Tailscale, test app via `library.install`, final signed Shortcut)

- The store run asked Allow once. The first store answered `not_run` "canceled" while the Allow prompt was still over the app; after Always Allow, the second store passed.
- Two installs back to back: one queue, one back run, Tailscale on, no Add VPN prompt (two iOS installs).
- Two separate installs: each had its own back run about 4 s after ours went off, Tailscale on after each, no prompt.
- Home pressed in the linger: nothing ran until the app returned, then the back run ran and Tailscale came on.
- App killed after Home: at the next launch the back run ran and Tailscale came on.
- Tailscale off before the install: nothing ran.
- Add VPN prompt is judged by the log line "enabling the configuration", never "saving a new configuration", not by watching the phone.

## Put back

- Phone: switch off, Tailscale on, test app removed, this branch's build left, lock released.

## Not verified

- The 2 s wait on return after the change (only the launch case ran with the final build).
- An install starting during the back run.
- Airplane Mode and cellular.
- A paused install (B423).
- A VPN other than Tailscale.
- iOS 16 to 26.
- Signing Server installs.
- Failed back runs from a queue (Shortcut deleted).
- Another VPN picking up meanwhile dropping the run: checked by the Linux rules only.

## Spec review

- Fixed: a back run looks at everything again under startLock, just before Shortcuts opens. This came after the phone
  checks and was not run on the phone again (builds and tests only).
- Kept: `remembered` in the status (the gate's own state, which the page needs), and dropping the run when another VPN
  was picked since (an owed run can be hours old).
- Until F420 lands, no page stores a VPN, and the switch's footer still tells of Settings > VPN.
