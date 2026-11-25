# B443: a stalled start of the built-in VPN is done once more

## Cause

Not reproduced; by reading. `LocalVPN.start()` waited out `startLimit` once and threw, and the next row's `up()` started
the VPN again. Why the first start stalled is not known. The log now says what it sat in.

## Did

- `native/sideload/vpn/App/VPNStart.swift` (new, Foundation only): the wait on the status and the rule "once more".
- `LocalVPN.start()`: on a stall (never left off for 3 s, turned off as it started, not connected in 10 s) it logs the
  status and the path, reads the manager again and starts once more. The second start has the whole 10 s: the first
  one's 3 s is a guess, and a slow phone must not be worse off than before.
- A tunnel stuck on its way up is stopped first (`takeDown`, shared with `downIfIdle`): iOS ignores a start of one.
- No second start once the app was left (B423), unless it finishes an install; none without a network; a refused
  configuration throws out of `manager()` as before, and isn't asked again.
- `step` runs every second of the wait; Cancel ends it in `waitOffCellular`, and now also in a first connect on Wi-Fi:
  `IDevice.install` passes `cancelled` to its Session, whose start used to ignore it (only before the install is
  connected; a reconnect still isn't cancelled there). The session's watchdog (30 s of quiet) doesn't end two starts in a row.
- A tunnel that connects just as the first start is given up is kept (checked before takeDown).

## Spec review

Found the missing check (a tunnel that connects as the start is given up) and the Wi-Fi Cancel. Both fixed.

## Phone checks

iPhone 15 Pro, iOS 27, Wi-Fi, 2026-11-24 22:52-22:57. Driven by `library.install`, route idevice through Web Inspector,
three 30 MB test apps at once, not the page's queue. Chromium can't run the VPN.

- Branch build, Tailscale selected and connected (screenshot): one "enabling the configuration", on in 0.27 s, 3 of 3
  installed in 5.5-6.4 s.
- The rest with a temporary fault build (never committed), iFizBox VPN already the selected one. First start skipped:
  "never began: off (status 1) after 3.00 s". Second start on in 0.21 s, 3 of 3 installed (7.6-10.2 s).
- Extension never answers the first start: "didn't connect: starting (status 2) after 10.02 s", stopped, second start
  on in 0.16 s, 3 of 3 installed (14.6-17.3 s).
- `signing.cancel` 1.5 s into each of those two stalls (one install each): "Cancelled" at 2.2 s.
- Left: the branch's clean build installed, test apps and IPAs removed (probe.ipa was there before, kept), Tailscale
  selected and connected (screenshot), lock released.

## Not verified

- Why the user's first start stalled (not reproduced; the new log lines will say).
- The "turned off as it started" retry on a phone (only the Linux test).
- No-network and refused-configuration failures on a phone (paths unchanged).
- The page's own queue with Confirm, and 7 rows (only three concurrent `library.install` calls).
- App left or killed during a stall.
- Another VPN taking over in the middle of a start.
