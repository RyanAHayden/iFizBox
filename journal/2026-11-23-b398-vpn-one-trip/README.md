# B398: the VPN comes back in one trip

## Summary

The Install Switch Shortcut now puts a connected VPN back at the end of its one trip, so a VPN whose own On Demand rule
doesn't reconnect it (Tailscale on Wi-Fi with Do Nothing) no longer needs the app's second trip to Shortcuts. The old
Shortcut's Connect only selected the VPN and ended with NEVPNErrorDomain error 2.

## What was built

- Shortcut (`web/app/shortcuts/Install Switch.shortcut`, source `tools/shortcuts/install-switch.plist`): 92 -> 104
  actions, only the trip changed. At the trip's start it finds the VPN that is connected and has On Demand on (Find
  VPNs, limit 1) and stores it as "on demand VPN" (deleted first). At the trip's end, before Connect of "previous VPN",
  it runs Set VPN > Set On Demand with the value it had (true if "on demand VPN" is stored, else false), which selects
  the VPN; then waits 2 s; then Connect. The start and end branches are unchanged: the end is the retry, and by then the
  VPN is selected.
- `native/sideload/vpn/LocalVPN.swift`: no change needed.
- `native/sideload/vpn/test_vpn.py`: updated for the 104-action Shortcut.
- The Shortcut was re-signed on the MBA into `web/app/shortcuts/Install Switch.shortcut`.

## Phone checks

iPhone 15 Pro, iOS 27.0.1, Wi-Fi, `vpn.testSwitch` driven through Web Inspector, installed build unchanged,
2026-11-23. Shortcuts and VPNs exist only on the phone, so Chromium could not check this.

- Old Install Switch, Tailscale connected, Wi-Fi Do Nothing: reproduced. "after the trip, not everything is" (11.3 s),
  then the end run, Set VPN error 2, test took 16.0 s.
- New Install Switch, Do Nothing, twice: one trip, "everything is back" in 6.7 s and 6.2 s, no end run.
- New, Tailscale On Demand off, connected, twice: back in 4.1 s and 4.3 s, one trip. On Demand still off in Tailscale
  afterwards.
- New, Tailscale On Demand Always, once: back in 4.1 s. On Demand still on, Wi-Fi Always.

## Gotchas

- A Safari download of the Shortcut gets a numbered name ("Install Switch 4"); rename it in Shortcuts (title menu >
  Rename) after Add. Delete the old one first.
- The check asked for Allow.
- The MBA was offline at first and came back within about 20 minutes.

## Not verified

- Cellular (no SIM on the test phone).
- A real install (only the test path, which runs the same trip).
- VPNs other than Tailscale, and two VPNs at once.
- The idle path (`shortcuts.idle`): its actions are unchanged, but it was not run again.
- iOS before 27.
- The Share Shortcut File add from the app with the new file.
- The iCloud link: `SHORTCUT_LINKS.switch` in `web/app/core/installroute.js` still holds the older 92-action Install
  Switch, so Add in the app gives the old one until the owner makes a new link (queued as F405).
- Phones with an older Install Switch keep the second trip and get no Update row, since nothing tells the two apart.

## Phone state

The iPhone 15 Pro has the new Install Switch (named Install Switch) added, Tailscale On Demand on, Wi-Fi Always, and
the VPN connected. The lock is freed.

## Spec review

- The On Demand state comes from any connected VPN with On Demand on, not matched to the remembered one. With two VPNs
  connected at once (a managed one beside the user's), the remembered one's On Demand could be set to the other's
  value. Not seen, not tested; iOS connects one personal VPN at a time, so it is left.
- Set On Demand and the 2 s run for every connected VPN, also one its own rule brings back: the Shortcut can't read the
  rules. With Always it is back in 4.1 s, as before.
- The app's waits (12 s in a test, 25 s after an install) leave room for the 2 s: back in 4.1 to 6.7 s.
