# T80: AFC parallel writes on the phone

## What I did
- Added a debug-only switch to `native/sideload/idevice/IDevice.swift`. `IDevice.parallelWrites` reads the setting
  `afcParallel` (2 to 8). A release build always uses 1. `uploadParallel` copies a fresh IPA over N AFC connections at
  once. Each connection writes its own contiguous range of the same remote file, in 1 MB chunks. The first connection
  creates the file; the others open it r+ and seek. The resume path (after a drop) still uses one connection. `upload()`
  is wired to it.
- Built the app on this Linux desktop with a throwaway copy of `native/build.sh` that adds `-DDEBUG` to the swiftc line.
  The copy is deleted; nothing is committed.
- Installed the debug build on the iPhone 15 Pro with `tools/ui-15.sh` (UI lock held as T80). Variants were set with
  launch arguments: `ios launch com.ryha.ifizbox --kill-existing --arg=-afcParallel --arg=N`.
- Test IPA: a stub app `com.ryha.ifizbox.t80test` with a 330 MB random file (339.6 MB to send after signing), put into
  iFizBox's Documents with `ios file push`, so it shows under Install IPAs.
- Each run: Install IPAs > T80 Test > Install > Confirm (This iPhone). Speed came from the syslog line
  "AFC: copied ... (this run X MB/s ...)", read live with pymobiledevice3 syslog. The app was in front for every run.
- Cleanup: uninstalled the test app and removed `/Documents/T80Test.ipa` with afcclient
  (`--container com.ryha.ifizbox`). The UI lock is released. The debug build stays on the 15 Pro in place of the
  release build.

## Result
Speeds (MB/s) for the 339.6 MB copy:
- 1 connection (baseline, the existing path): 24.5
- 2 connections: 24.9
- 4 connections: 24.7, 23.8
- 8 connections: 13.1, 13.0 (about half the speed: 26 s against 14 s)

The R93 baseline on the same route was 24.3 MB/s. Adding connections does not help. The roughly 24.5 MB/s ceiling
comes from the route and the device, not from request serialization. Eight connections are clearly worse.
No speed-up is filed, and the switch stays debug-only.

## Not verified
- Background or locked copy speed with parallel connections (every run was in front).
- Other phones (iPhone 7 and others), and the Tailscale route.
- A failure or drop in the middle of a parallel copy. There is no resume for parallel copies, and a failed range fails
  the whole copy.
- Parallel separate files, as opposed to ranges of one file.
- 3 and 5 to 7 connections.
- The gate result from run by done.
- The signed copy of the test IPA that the app keeps may still sit in its storage on the 15 Pro.

The range split and the final byte-count check were tightened after the phone runs (review found that a total just over a multiple of the chunk could leave bytes unsent). The measured runs sent the whole 339.6 MB; the tightened code was only built by the gate, not run on the phone.
