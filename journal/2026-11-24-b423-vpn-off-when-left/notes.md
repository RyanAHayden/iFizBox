# B423: built-in VPN off when the app is left

## Cause

No user ilog was available to read, so these causes come from the code:

- `waitOffCellular` held the VPN under KeepAlive for up to 5 minutes per row. Each row, and each reconnect, started it
  again, in the background or not, so it could come on over the user's own VPN after they left the app.
- `down()` was a bare `asyncAfter` 3 s. A suspended app never ran it, so the VPN stayed on.
- Nothing took down a killed app's tunnel.

## Did

- `native/sideload/vpn/App/LocalVPN.swift`:
  - Out of the app 30 s (`awayGrace`) with the path still on cellular, the airplane wait pauses (`pause`) and the VPN
    goes off. Airplane Mode on isn't cellular, so the VPN is never dropped then.
  - In the background the VPN starts only to finish an install already connected (`finishing`). An install not yet
    connected pauses (`waitForApp`, row "Waiting for iFizBox", event `appWait`) with its KeepAlive let go, and goes on
    when the app is opened. Checks wait for the app too (`awayLimit`, 5 min awake, then `vpn_failed`).
  - The off after the last connection runs under a `BackgroundHold` (`stopLater`), so a suspended app still takes it down.
  - `takeDownLeftOver` runs at launch and on coming back, and takes our tunnel down when nothing holds it.
  - `beat` sends one UDP byte to 10.7.0.1:9 every 15 s while anything holds the VPN.
- `native/sideload/vpn/Extension/PacketTunnelProvider.swift`: the extension stops itself after 60 s awake (`quietLimit`)
  with no packet for the peer.
- `native/sideload/idevice/IDevice.swift`: `appWait(Bool)` step for the page.
- `web/app/core/apprun.js`, `web/app/core/installroute.js`, `web/app/core/signing.js`, `web/app/signing/*`: the
  "Waiting for iFizBox" row and its handling.
- `docs/sideload.md`, "This iPhone with the built-in VPN": the current behaviour above; `appWait` added to Events.
- `GLOSSARY.md`: new term "App wait".

## Phone checks

iPhone 15 Pro, iOS 27, on Wi-Fi. "fake" means the build patched like
`journal/2026-11-23-f368-airplane-wait/fake-cellular.patch` (Wi-Fi counts as cellular). The patch was never committed.

- fake, leave mid-wait: left 09:27:00, paused 09:27:30, off 09:27:33. Opened 09:27:50: the VPN was on again and the
  wait went on.
- fake, wait 85 s in front: the VPN stayed on. A 15 s Home trip kept it on. The app was killed 09:44:16 and the VPN went
  off 09:45:06 ("Plugin initiated").
- clean, killed while installd was installing: killed 09:53:01, off 09:53:56. Relaunched the same way: taken down within
  1 s of the relaunch.
- clean, Home right after Done: left 09:57:18, off 09:57:21.
- clean, Home right after Confirm: no VPN start for 40 s, "Waiting for iFizBox" in the log. On opening, it connected and
  copied.
- clean, Home mid-copy of 900 MB: the install finished in the background (46.9 s), and the VPN went off 3 s after.
- pairing from iOS Settings: the test after pairing waited until iFizBox was opened, then passed.

## Failed first

- `sendProviderMessage` never reached the extension: with a nil handler, and with a handler the reply was nil even
  though the extension answers a byte. So the tunnel stopped itself at 60 s mid-wait. Replaced by the UDP packet.

## Rig

- `tools/ui-15.sh up` failed. `ios image list` says none while the personalised DDI is mounted as a cryptex
  (`pymobiledevice3` mounter list shows it), and the mount then fails. Started forward and runwda by hand.
- The RemotePairing record was stale after the rig's installs and reboot, and was paired again.
- Test apps and IPAs were removed. The unpatched build of this branch is left on the phone. The lock is released.
- Filed as a plan task: `ui-15.sh up` should treat the 'already mounted' error as mounted.

## Not verified

- Real cellular: the 15 has no SIM. Also not verified: that the UDP packet goes out on cellular.
- Another VPN app's On Demand coming back.
- Airplane Mode turned on from Settings within the 30 s, on the phone. Only the path rule in code covers it.
- A phone suspended mid-install for over 60 s. Then the tunnel stops itself, and the install reconnects when opened.
- Several rows waiting at once.

## After the review

Added after the phone checks (spec review), compiled and unit-tested only, not run on the phone: a row opened again with no network waits (`networkWait`) instead of failing; a session holds a background task so a check left midway still ends; a cancelled pause reports no step.
