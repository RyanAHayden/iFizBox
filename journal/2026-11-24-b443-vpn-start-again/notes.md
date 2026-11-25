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

## Not verified

- The phone check: three installs queued right after another VPN took ours' place. iPhone 15 was locked by B439 at writing.
- The retry on a real stall.
- Stopping a tunnel stuck connecting on a phone.
- Cancel during a start on a phone.
- Why the user's first start stalled.
