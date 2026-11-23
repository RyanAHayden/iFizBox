# R78a: the shared piece (Connect VPN, Wait for Install): not measured

**Result: nothing measured.** The iPhone 15 Pro UI lock was held by T76 when this run tried it
(`tools/ui-15.sh lock R78a`: "locked by T76 (touched 11:15)", checked 11:16, so live, not stale). Every question
needs the phone, a probe build and hand-made Shortcuts, so the task is parked until the lock is free. Same outcome as
R78 (held by B381). This note adds what a read of the code shows, and a ready measurement script, so the next run
only has to build and measure.

## What reading the code shows

- `LocalVPN.up()` (`native/sideload/vpn/App/LocalVPN.swift:181`) already blocks until `.connected`, throws
  `vpn_failed` with a reason (no network, turned off as it started, not connected in `startLimit`), and returns at once
  when connected. So Connect VPN is `try LocalVPN.up()` plus a thrown error mapped to an intent error: no new logic.
  It does not need the app in front today: it only calls `NEVPNManager`.
- `metadata.py` (`action()`) refuses explicit `supportedModes` and writes `supportedModes` 1 (background) or 2
  (`openAppWhenRun`). Two plain intents with `openAppWhenRun = false` need no writer change. Only the
  `SIDELOAD_INTENTS` list in `build.sh` (and `mkipa.py check`) must name them. For the probe build only, one
  throwaway intent file is enough, but the sideload list must carry the probe intents or they never show.
- A long-running or background-continuation API (the iOS 27 question) would need `metadata.py` support (a new
  `supportedModes` value or a protocol it refuses today). Its name is still unknown: look it up in the iOS 27 SDK on
  the MBA first (`ssh mba`, the `AppIntents.swiftinterface`), not from memory.

## Measurement plan (for the run that gets the lock)

Probe build (throwaway, never merged, scratch worktree, sideload build, ad hoc identity as in
`iphone15-ui-rig`): two intents, `openAppWhenRun = false`.

1. `ProbeConnectVPN`: `try LocalVPN.up()`, return `.result(dialog:)` with the seconds taken; log with timestamps.
2. `ProbeWait(seconds: Int)`: sleep in 1 s steps, write a line `t=N` to a file in the app group each step, return at
   the end. A parameter without a default is allowed by `metadata.py`.

Shortcuts to make (signed on the MBA, `tools/shortcuts/sign.sh`, shared with the Add Shortcut sheet): one per wait of
20, 30, 60, 120 s, one running ProbeConnectVPN, one loop (Repeat 12, ProbeWait 10), then the stand-ins below.

Conditions for each: app in the background vs in front; screen on vs locked (`ui-15.sh ME lock-button`); Shortcut run
from the Shortcuts app vs from `shortcuts://run-shortcut` by x-callback (as the Install Switch is).

Read results from the app-group file (the last `t=N` shows how far it got before the kill) and from the syslog
(`ios syslog`) for the termination reason (RunningBoard, "background task", jetsam, or the Shortcuts timeout). Also
record: does ProbeConnectVPN work from the background with Tailscale on (the other-VPN stand-in), and with Airplane
Mode on it must fail with the B375 message, not hang.

Pass lines (hypotheses from R78, not results): Connect VPN works in the background, screen on or locked; Wait outlives
30 s only sometimes; the loop of short waits survives as long as the Shortcut run does.

## Not verified

Everything: no probe build, no phone run, no iOS 27 SDK lookup. The lock was taken by another task. Every "expect" is a
hypothesis. Follow-up: R78a stays open (reopened by its blocked note when the phone is free).
