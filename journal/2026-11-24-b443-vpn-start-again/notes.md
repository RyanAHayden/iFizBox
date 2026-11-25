# B443: a stalled start of the built-in VPN is done once more

## Cause

Not reproduced; by reading. `LocalVPN.start()` waited out `startLimit` once and threw, and the next row's `up()` started
the VPN again. Why the first start stalled is not known. The log now says what it sat in.

## Did

- `native/sideload/vpn/App/VPNStart.swift` (new, Foundation only): the wait on the status and the rule "once more".
- `LocalVPN.start()`: on a stall (never left off for 3 s, turned off as it started, not connected in 10 s) it logs the
  status and the path, reads the manager again and starts once more. The second start has the whole 10 s: the first
  one's 3 s is a guess, and a slow phone must not be worse off than before.
- A tunnel stuck on its way up is stopped first (`takeDown`, shared with `downIfIdle`): iOS ignores a start of one (not checked on a phone).
- No second start once the app was left (B423), unless it finishes an install; none without a network; a refused
  configuration throws out of `manager()` as before, and isn't asked again.
- `step` now runs every second of the wait, so Cancel ends it in `waitOffCellular`, and the session's watchdog (30 s of
  quiet) doesn't end two starts in a row.
