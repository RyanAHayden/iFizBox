# B418: stale Built-in VPN configuration with several installs

## Cause

Several This iPhone installs at once each called `LocalVPN.up()` from `waitOffCellular`, off `IDevice.queue`.
Each one dropped the kept VPN manager, loaded it, and saved its own copy. iOS then refused a save that was called
later with a configuration it had already replaced: `configurationStale`. The user's screenshot shows 5 of 7 rows
failing this way. Not reproduced on a phone.

## Change (native/sideload/vpn/App/LocalVPN.swift)

- `startLock` around `up()`: one start at a time. A waiting caller polls each second and keeps the session
  watchdog alive.
- A caller that finds the VPN already connected saves nothing.
- `manager()` (now private) always loads fresh, and saves only when the manager is missing, disabled, or different.
- On `NEVPNError.configurationStale` from the save, or from the load after it, it loads again and retries once.
- `lock` is never held while waiting on iOS. `status()` takes it.
- The 60 s failure memory (`failedNow`) used to fail every other row after one failed start. It is now kept only
  for iOS refusing the first save, the one it asks the user about (Don't Allow, or no answer in 90 s), so the queue is not asked again and again.
  Callers already waiting get that same refusal. Any other failed start fails only its own install.
- An install waiting on another's start can be cancelled.

## Tests

`native/sideload/vpn/test_vpn.py` holds source checks only. The sideload IPA built, with the F368 fake-cellular
patch applied and then reverted (not committed).

## Phone (iPhone 15 Pro, 08:44)

Lock taken. `ui-15.sh up` exited 1. WDA did not answer. The image mounter returned `InvalidHostID`. The screen was
black. B415's test passcode is still on; its request is open. The lock was released.

## Not verified

- Two or more app installs on the 15 Pro with Tailscale selected.
- The stale retry on a real stale error.
- Don't Allow with several installs waiting.
- Real cellular.

Follow-up: R90 (after B415).
