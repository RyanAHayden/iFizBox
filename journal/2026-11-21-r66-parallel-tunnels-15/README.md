# R66: F359's parallel This iPhone installs on the 15 Pro

Goal: on the 15 Pro, have Lite install 3 apps on This iPhone over LocalDevVPN and check that they copy together
(3 RemotePairing tunnels at once through the shell's HereLane, each row with its own Copying/Installing).

## What I checked (2026-11-21, 21:00 UTC, read-only, no UI lock taken)

- `ios apps --list` (go-ios, run from the rig folder): the phone has `io.tailscale.ipn.ios` (Tailscale 1.104.7),
  `com.ryha.ifizbox.probe` and `com.ryha.ifizbox` 0.19.1. **No LocalDevVPN app.**
- iFizBox's own Tailscale node, read with
  `afcclient --container com.ryha.ifizbox -- get "Library/Application Support/tailscale/tailscaled.state"`: the
  file holds only `_machinekey`, so the app is **still signed out** (as R64 left it).
- The This iPhone route (`Sideload.installHere`) reaches installd only through LocalDevVPN or iFizBox's own
  Tailscale sign-in. The separate Tailscale app on the phone doesn't give the shell a route to its own installd, so
  it doesn't help here.

Neither route can run, so the check needs the owner: install LocalDevVPN on the 15 (needs their Apple ID), or sign
iFizBox in to Tailscale (only they can log in). Blocked with `BLOCKED:`.

## Once unblocked

Run F359's 15 Pro recipe again (journal/2026-11-21-f359-parallel-installs, "On the 15 Pro"), this time with the
route on This iPhone: three padded test IPAs (`com.ryha.ifizbox.f359a/b/c`) in My IPAs over AFC, `runAppRun` with
`phoneLanes` from Web Inspector, row words sampled every 250 ms, plus
`pymobiledevice3 syslog live -e "iFizBox install"` to see the three tunnels open. Run `idevice.verify` first (a
stale pairing fails with `early eof`). If the 2nd or 3rd row fails with a connect error while the 1st copies, iOS
refuses parallel tunnels: queue a B task to set `HereLane.width` (native/Sources/SignBridge.swift) and
`HERE_PARALLEL` (web/app/core/apprun.js) to 1.

## Not verified

- **The whole check** (3 apps copying together over LocalDevVPN, and whether iOS 27 takes 3 RemotePairing tunnels
  at once): the 15 has no LocalDevVPN and iFizBox there is signed out of Tailscale; both need the owner.
- I didn't try the Tailscale route either: it needs the same owner login, and the shell runs it one at a time by
  design, so it wouldn't show parallel tunnels anyway.
