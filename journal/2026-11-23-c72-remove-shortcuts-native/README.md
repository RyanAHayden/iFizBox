# C72: remove Shortcuts from This iPhone installs (native)

## What
- Native no longer runs Shortcuts for This iPhone installs. Removed: the Install Switch and Cellular Shortcuts code in
  `native/sideload/vpn/App/LocalVPN.swift` (start, dataOff, trip and end runs; switchNeeded; the pending and lost keys;
  the `vpn.openShortcuts`, `vpn.checkShortcut`, `vpn.testSwitch` and `vpn.leftOff` calls), `native/sign/SwitchOpens.swift`,
  `native/intents/App/InstallSwitch.swift` (Connect VPN, Open for Install and Wait for Install intents), the
  `ifizbox://vpn-shortcut` URL in `native/Sources/App.swift`, and the `quiet` switch_needed check in `idevice.verify`.
- `LocalVPN.begin` now only runs `up()`. The end takes our VPN down after the 3 s linger.
- `vpn.status` is now `{available, bundled, entitled, tested, on, cellular, wifi, otherVPN, name}`. iOS takes another
  app's VPN off while ours is on, and `otherVPN` says so.
- Old stored keys (`ifizbox.vpn.shortcut.*`, `switch.pending`, `vpn.lost`, `vpn.leftOff`) are cleared once at launch.
- Docs: `docs/sideload.md` and `docs/settings.md` describe the native side's current state. Web-screen text for the
  Install Switch stays, with a line that the native side no longer runs Shortcuts.
- Web code is untouched here. A separate task removes the web side, which tolerates the missing fields.

## Tried / failed
- None.

## Not verified
- The on-phone check on the 15 Pro was not run (unattended session, no phone access verified). It should show, on
  Wi-Fi: an install with no VPN on and one with Tailscale on both finish and never open Shortcuts, and ours is off
  after. It should also show whether Tailscale's On Demand brings it back by itself.
- The Swift code was not compiled here beyond what `tools/check.sh` does.
