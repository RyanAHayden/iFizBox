# B375: Install Switch installs fail on cellular

## Summary

On a user's own phone (0.24.x Lite, Install Switch added) an install on This iPhone failed with
`connect_failed: InternalError("connect: device socket io failed") (16)`, and the fix rows offered Open LocalDevVPN.
On Wi-Fi it didn't reproduce on the 15. The cause found is the order in the Install Switch on cellular: its start
turned cellular data off before Set VPN, and iOS starts no VPN without a network, so the built-in VPN never came up
(reproduced with Airplane Mode; the user's phone being on cellular is inferred, not confirmed). The Shortcut now starts the VPN first and turns cellular data off once the VPN is up. A failed
install through the built-in VPN no longer offers Open LocalDevVPN.

## What was found

- Report: the user's phone, 0.24.x Lite, Install Switch added. The Shortcut ran, the app came back with the VPN icon
  on, then "This iPhone's install failed: connect_failed: InternalError("connect: device socket io failed") (16)" and
  the fix rows offered Open LocalDevVPN. Screenshot `.runner/b-install-switch-fail.png` (main checkout, not committed).
- Reproduction on the iPhone 15 Pro (iOS 27, Wi-Fi, no SIM, Tailscale on and selected, Install Switch added, current
  0.24.1 build 4634 installed with `tools/ui-15.sh`): two real installs from My IPAs, small test IPAs made from the
  tiny fixture with bundle IDs `com.ryha.ifizbox.b375test` and `com.ryha.ifizbox.b375two`, placed in Documents with
  afcclient, both succeeded on Wi-Fi. Syslog showed the start's Set VPN failing with NEVPNErrorDomain error 2
  (WFActionIndex 15) when our configuration was not the enabled one (Tailscale was). nesessionmanager logged
  `enabled = 1` for our configuration right as it failed, and a second run right after succeeded. The app's own
  `up()` connected the VPN regardless ("vpn: on in 0.27 s"), so the install went on.
- Cause, found by simulating "no network" (Airplane Mode as the stand-in for Cellular Data Off on a phone without
  Wi-Fi): `vpn.test` failed with "iFizBox VPN didn't connect in 10 s". nesessionmanager logged "No network available",
  and the status went connecting -> disconnecting -> disconnected within about 10 ms. The Install Switch's start
  turned Cellular Data off before Set VPN, and the app's `waitOffCellular`, then `up()`, ran with data already off. So
  on cellular neither the Shortcut nor the app could start the VPN. `LocalVPN.begin` then threw, and
  `IDevice.Session.endpoint` fell back to the LocalDevVPN/Tailscale route, which connected to 10.7.0.1 with no tunnel
  and no network. That gives "device socket io failed". The install's log line still said "through iFizBox VPN",
  because that line is chosen before the connect.
- The fix rows came from `core/installroute.js` `serverFallback`, called by `signing/queue.js` without
  `idevice.status`. So it took the route for LocalDevVPN and offered Open LocalDevVPN.
- Counter-check: the VPN was connected first through the Shortcut's start (Wi-Fi on), then Airplane Mode went on.
  Settings still showed the VPN Connected, and `idevice.verify` through iFizBox VPN passed in 1.2 s (tunnel and RSD up
  in 0.22 s). So a VPN that is up keeps working without a network. This is the order SideStore's docs give ("start the
  VPN, enable Airplane Mode").

## What changed

- `tools/shortcuts/install-switch.plist`: start is now remember VPN, Set VPN, then Cellular Data Off only if
  `cellular` is set (older app builds). A new key `dataOff` (a new Get Dictionary Value "Data Off" and an If in the
  Otherwise of the End branch) runs Cellular Data Off.
- `native/sideload/vpn/App/LocalVPN.swift`: `begin()` runs the start without `cellular`, then `up()`. On cellular it
  then runs `{"dataOff":1}` and waits for the path to leave cellular. `up()` fails at once when `NWPathMonitor` says
  there is no network (`Path.online()`), with the text "iFizBox VPN can't start without a network: iOS starts a VPN
  only with Wi-Fi or cellular data on". `testSwitch` uses the same order.
- `web/app/signing/queue.js`: after a This iPhone row fails, reads `idevice.status` and passes it to
  `serverFallback(err, route, st)` in `web/app/core/installroute.js`.
- Tests: `native/sideload/vpn/test_vpn.py` (`test_install_switch` updated, new `test_install_switch_vpn_before_data_off`)
  and `web/app/install-server-fallback-b375.test.js` (new).
- Docs: `docs/sideload.md` (the Install Switch paragraph, its `vpn.testSwitch` line and a sentence on the queue's fix
  row), and `release-notes/B375.md`.

## Phone checks

With the fixed build (0.24.1 4634 plus this branch, rebuilt and installed with `tools/ui-15.sh`):

- A real install from My IPAs (B375 Three) through iFizBox VPN, with the Install Switch added, succeeded on Wi-Fi.
  Tailscale came back afterwards.
- Another `vpn.test` on Wi-Fi passed. The start's Set VPN gave error 2 again, and `up()` covered it.
- `vpn.test` in Airplane Mode now fails in 1.0 s with the new message (it took 11 s before).
- The phone was put back afterwards: Airplane off, Tailscale selected and connected, test apps uninstalled, test IPAs
  removed from Documents.

## What failed / was tried

- The MBA (the signing host for `tools/shortcuts/sign.sh`) was offline the whole time at first: ssh timed out, and
  Tailscale showed it offline. A poll loop found it back about 25 minutes later; `tools/shortcuts/sign.sh mba
  install-switch` then signed `web/app/shortcuts/Install Switch.shortcut` (AEA1 header checked), and the app was
  rebuilt so it bundles the new file (compared byte for byte in the IPA).
- New Shortcut on the 15: the old Install Switch was deleted in Shortcuts first (Replace leaves a duplicate name,
  T75), then added through the app's own share sheet (`vpn.openShortcuts`, Shortcuts, Add Shortcut). The editor
  showed the `dataOff` Get Value and the "If Data Off has any value / Turn Cellular Data Off" branch as written, and
  the start branch with Set VPN before its Cellular Data Off. `vpn.checkShortcut` passed. A real install from My
  IPAs (B375 Four) then succeeded with it: start ran (its Set VPN ended with error 2 again, `up()` connected the
  VPN), install done in 2.6 s, VPN off, end ran, Tailscale selected and connected after. `{"dataOff":1}` run by URL
  finished without an error (no SIM, so no data change to see); `{"end":1,"cellular":1}` put data back on.
- The suspects in the brief: Set VPN and `LocalVPN.up()` do overlap (Set VPN's error 2 while iOS enables our
  configuration), but it isn't harmful: `up()` always connects the tunnel itself and every run went through. A stale
  "previous VPN" didn't show: the end deletes it before Set VPN (T75) and the next start overwrites it.
- An Airplane Mode toggle tap missed once (Settings was still on the VPN page), which gave an extra Wi-Fi pass.
- Web Inspector evals hang while another app is in front.

## Not verified

- Anything on real cellular (the 15 has no SIM): the `dataOff` run, Cellular Data Off after the VPN, `waitOffCellular`,
  and the end's Cellular Data On. Airplane Mode stood in for "no network".
- The user's exact phone and build were not used.
- Old app builds with the new Shortcut were not run: `{"start":1,"cellular":1}` now turns data off after Set VPN.
- The queue's fix row (Check Again instead of Open LocalDevVPN) was checked only in node tests, not on the phone. A
  real failure on the phone needs no network.
- `IDevice.Session`'s fallback to 10.7.0.1 when the built-in VPN fails (it still gives "device socket io failed" when
  nothing else is on) was not changed, as it is outside this task's files. It is filed as B378.
- Whether Cellular Data Off from the new `dataOff` branch really turns data off: the 15 has no SIM, so the run only
  showed it ends without an error.
