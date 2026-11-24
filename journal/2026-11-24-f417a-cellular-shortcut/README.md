# F417a: Cellular Installs shortcut

## What I did
- `tools/shortcuts/cellular-installs.plist`: one Shortcut with three inputs, read as a JSON dictionary with one key
  (`run`, `on`, `check`). `run` turns cellular data off, opens the app, runs up to 15 Wait for Install turns, turns
  data back on and finishes. `on` only turns data on and finishes. `check` touches no data. No input does nothing.
  The plist header says the same.
- `tools/shortcuts/sign.sh`: signs the plist on a Mac (`shortcuts sign --mode anyone`, over plain ssh to `mba` by
  default, or `local`) and writes `web/app/shortcuts/Cellular Installs.shortcut`. The name must match
  `CellularShortcut.shortcutName`, because Shortcuts names an added Shortcut after its file.
- `native/intents/App/CellularInstalls.swift`: the three App Intents the Shortcut calls, `OpenForInstallIntent`,
  `WaitForInstallIntent` and `FinishInstallsIntent`. They are in the sideload IPA's metadata only. They report to
  `native/sideload/vpn/App/CellularShortcut.swift`, which holds the state of the run and decides what counts as done.
- `native/build.sh`: `SIDELOAD_INTENTS` now lists the three new intents, so the sideload IPA's metadata carries them.
- `native/intents/README.md`: the three intents in the table (sideload only) and a bullet for the new file.
- `GLOSSARY.md`: a "Cellular Installs" entry.

## Split
- F417a1: sign the plist, add the Shortcut to the phone, check the three inputs, then the phone run.
- F417a2: run it during the cellular wait of an install, check that data goes off and comes back, and check the
  put-back run (`on`) after a run that was cut short.

## Decisions
- A run is judged by its own actions only: Open for Install, Wait for Install and Finish Cellular Installs. Shortcuts'
  callback can belong to an earlier run, so the app does not use it.
- No input does nothing. The Shortcut only does something when one of the three keys is set.
- An app killed mid-run has no state. With no run going on, each action does nothing and the waits end at once. The
  Shortcut's next actions still turn data on, unless iOS has already ended the Shortcut. R78a measured that iOS does
  end it, with an XPC error, so `on` is a separate run with `{"on":1}` in F417a2.
- 15 turns of 20 s is 5 minutes, the same as `LocalVPN.airplaneLimit`. Shortcuts cuts an action off at about 30 s, so
  each Wait for Install turn is shorter than that.
- `begin()` refuses a `run` unless the built-in VPN is up. iOS starts no VPN once cellular data is off, and it keeps
  one that is already up, so the VPN has to be up first.
- `on` also opens the app and runs Finish Cellular Installs, so the app can judge it by its own actions too.
- The old Connect VPN action is not in the Shortcut. The VPN is already up when a run starts, so it isn't needed.
- Review: a given-up Shortcut could report into the next run. `begin()` now refuses a run or a check for 10 s after one
  was given up (its waits end at once, so it is over by then). A Shortcut that hangs for longer before Open could still
  report into a later run: F417a2 gives a run up only after its own time limit.

## Not verified
- The plist's import into Shortcuts, and signing: there is no Mac to sign on. `ssh mba` timed out on 2026-11-24, so
  nothing was signed. This is F417a1.
- The actions on the iPhone 15 Pro: nothing can run them without the signed Shortcut. This is F417a1.
- Real cellular: no SIM was used.
- iOS 16 to 26: none of these versions was run. Only what R78a measured on the phone is taken as known.
