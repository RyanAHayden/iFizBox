# F417a2: run Cellular Installs while installs wait

## What I did
- `native/sideload/vpn/App/CellularRun.swift` (new): the bridge `cellular.run` and `cellular.putBack`, the
  `ifizbox.cellular.owed` flag, and the put-back at launch.
- `native/sideload/vpn/App/CellularShortcut.swift`: `runVerdict`, `connects`/`connected` and `running`.
- `native/sideload/vpn/App/CellularShortcutBridge.swift`: `drive`, which runs the Shortcut for a run.
- `native/sideload/vpn/App/LocalVPN.swift`: `waitsOnCellular` and `offWaits`, so a run sees the waits.
- `native/sideload/idevice/IDevice.swift` `install()`: each install counts from before its wait until connected or ended.
- `web/app/core/cellularshortcut.js` and `web/app/signing/cellularrun.js` (new): `runCellular` and the put-back alert
  texts. `web/app/app.js`: the launch call.
- `docs/sideload.md`: a paragraph on the run after the bridge paragraph, and the "Nothing on screen" sentence now names
  the launch put-back.
- `GLOSSARY.md`: CellularRun and cellularrun.js under Cellular Installs.

## Decisions
- A new file, `CellularRun.swift`, instead of growing the bridge file.
- Web files are added beyond the task's files list: `native/test_bridge_contract.py` needs a web caller for every Swift
  handler, and the app says so.
- No release note, and no button calls the run until F417b.
- `IDeviceBridge.swift` needed no change.
- Only installs past the HereLane count (3 at once) are counted, not those queued behind them.

## Phone checks
iPhone 15 Pro (iOS 27.0.1), Wi-Fi, no cellular service (SOS). Chromium can't run Shortcuts or App Intents, so this
was on the phone. A stand-in build (scratch only, never committed) reported the path as cellular until Open for Install
ran, and had a "hold" flag keeping it cellular. A test call ran `IDevice.install` on two tiny signed IPAs, with calls
over webinspector.
- Nothing waiting: `not_waiting`; launch put-back `null`.
- Two installs waiting, `cellular.run`: `ok`. Both connected after Open (airplane off, connected), both installed. The
  Shortcut did all its turns at once and finished; `owed` false.
- Hold: a turn took about 20 s (turn 1 at 35 s, not released, `owed` true). The install was cancelled at 65 s, and the
  run answered `ok` 0.6 s or less after (57.6 s total).
- Hold, app killed mid-run (go-ios): Home Screen. The next launch went to Shortcuts and back by itself; the alert
  "Cellular Data Is Back On" came 9 s later, and `owed` cleared.
- Hold, Shortcuts app killed mid-run: `no_end` after 42 s, `putBack` "on", the run answered at 47.5 s.
- Shortcut missing (the stand-in used another name): `not_run` with "Could not find the shortcut", put-back also
  `not_run`, alert "Check Cellular Data". On real cellular data seen on, the put-back would be skipped.

Left on the phone: this branch's clean build installed; test apps and files removed; Cellular Installs Shortcut kept;
lock given back.

## Not verified
- Real cellular (no SIM): whether data goes off and on, whether the VPN stays up through it, and `dataOn()` true.
- `ran_out`, `vpn_off` and `busy` on the phone.
- Allow left unanswered.
- iOS 16 to 26.
- Self-update of the app during a run.

## Review
Fixed after the phone checks: a put-back that failed keeps the state for one more try at the next launch; data counts
as on after 10 s instead of 2 s (a given-up Shortcut could still turn it off); it is read again when the app comes back
to the front; a run whose last install ended as it began doesn't wait. Not verified on the phone: these four; the
tests and the build cover them. Phone checks above ran before them.
