# F389: Idle VPN brought back by the Install Switch

## Summary

A VPN that is selected in Settings > VPN but idle (Connect On Demand on, not connected) now counts as another VPN.
Before, an install over This iPhone left it off after, since the app only saw a connected VPN. Now the Install Switch
takes it in the trip and puts it back at the end: Set VPN > Set On Demand selects it again without connecting, so the
user's rules still decide. Checked on the iPhone 15 Pro (iOS 27.0.1) on Wi-Fi, all on 2026-11-23.

## What was built

- `native/sideload/vpn/App/LocalVPN.swift`:
  - `otherVPNSelected()` reads the saved configuration of ours: not enabled means another VPN is selected. It is
    in `vpn.status` as `otherVPNSelected`, and the Install Switch's `idle` flag as `shortcuts.idle`.
  - A start or trip with another VPN selected gets `"selected":1` and remembers the selected VPN's place.
  - The end turns its On Demand on again when the VPN was idle.
- `tools/shortcuts/install-switch.plist` (and `web/app/shortcuts/Install Switch.shortcut`): a second Wait for Install
  turn looks for an idle VPN (Find VPNs, filter "Is On Demand Enabled" {Bool:true}, limit 1), stores it, and the end
  runs Set VPN > Set On Demand on it. A VPN that is off without On Demand isn't turned on.
- `web/app/core/installroute.js`: `switchWanted` and `switchOld` count `otherVPNSelected` and `shortcuts.idle`; the
  alert `vpnIdle` ("Your VPN May Stay Off") when not added and selected but not up.
- `web/app/screens/installroute.js`: the Update footer says "To get an idle VPN back, delete Install Switch in
  Shortcuts, then tap Update." for an Install Switch that has trips but not `idle`.
- `docs/sideload.md` (Built-in VPN) and `release-notes/F389.md`.

## Design choices

- iOS gives no way to read another VPN's On Demand, so "selected" counts (our configuration not enabled), and the
  Shortcut finds the On Demand one itself.
- Set On Demand rather than Connect: Connect would bring the VPN up now; Set On Demand selects it and leaves the
  user's rules (Wi-Fi: Never, Always, and so on) in charge.
- The not-added alert is worded "If", because the app can't tell whether the VPN connects on demand.

## Reproduction and probes

- Tailscale On Demand on Wi-Fi: Never. Idle, with the switch on. Native detection alone did not bring it back:
  Shortcuts' Get Current VPN returns only a connected VPN, and the checkmark stayed on iFizBox VPN.
- Probe Shortcuts: Find VPNs with the filter "Is On Demand Enabled" {Bool:true} works. "Set On Demand" on it moved
  the checkmark to Tailscale, not connected.
- Turning the switch off in Settings turns Connect On Demand off.
- `otherVPNSelected` true with Tailscale connected, idle, or selected but off; false with ours selected. The read
  takes 2 to 4 ms.

## Phone checks (iPhone 15 Pro, iOS 27.0.1, Wi-Fi)

- Idle, through `vpn.test`: one Shortcuts run, and the app is back 1 s after the VPN went off.
- Idle with a real install (`signing.resign` of Probe, route idevice): done, back in 1 s, Tailscale selected and idle.
- Selected but off without On Demand: one run, "nothing to put back" after 9 s. Our VPN keeps the checkmark, and the
  next install does not open Shortcuts. A longer wait (nothingLimit 12 s) let a second Shortcuts run come at 11 s, so
  the limit is 9 s.
- Connected Tailscale with On Demand Always: one run, back 4 s after.
- Connected with the rule Do Nothing: the trip's Set VPN selected it but didn't connect. The end run 11 s later
  brought it back. Filed as a low follow-up, B398, not from this change.
- Old Install Switch (63 actions): check says trip true, idle false. It shows Update.
- New Install Switch, added through the app's share sheet after the old one was deleted: trip and idle true. Allow
  was asked.

## Review findings

- A spec review found that the 9 second wait skipped the retry when Set On Demand was slow or failed. `testTrip`
  failed with an older Install Switch, and an older one took a useless second trip. The wait is replaced: the trip
  ends with one more Wait for Install (a 46th) only when it stored no idle VPN. That tells the app there is nothing
  more to put back, so it runs no second trip. Without that signal, and with the VPN not back, the end runs as a
  retry. With an older Install Switch (idle false) the app stops waiting after 9 s (nothingLimit) and runs no end.
- An older added Install Switch doesn't bring an idle VPN back until it is Updated.
- Final retest on the iPhone 15 Pro (iOS 27.0.1, Wi-Fi), with the final build and the Install Switch re-signed (90+
  actions), added once after the old one was deleted:
  - Connected (On Demand Always): one run, back 4 s after.
  - Idle, twice: one run each, back 1 s after.
  - Selected but off, three times: one run each, "nothing to put back" 1 s after the VPN went off.
  - One further selected-but-off run stalled: Open for Install never ran for 25 s. The app fell back by itself, and
    the end run put nothing back. Cause unknown; not seen in the other 6 runs.
- The real install (`signing.resign`) was with the build before the review fixes.

## Gotchas

- Share sheet: taps by accessibility coordinates are relative to the sheet and miss.
- Safari: a second download of the same file gets a " 3" name.

## Not verified

- Cellular (no SIM on the phone).
- Two VPNs with On Demand on (Find takes the first).
- iOS 16 to 26, and iOS 15 runs of the new Shortcut.
- A kill during an idle trip.
- A first setup test before any saved configuration of ours: nothing can be told then, so an idle VPN loses its place
  there.
- The Update row and the alert were seen only by node tests.
- The older Install Switch with the final build's 9 second path.
- The cause of the stall above.
- A failed read of our VPN configuration counts as no other VPN.

## Phone state

- The new Install Switch is added; the probe Shortcuts are deleted.
- This branch's build is installed.
- Tailscale On Demand is back on Always and connected.
