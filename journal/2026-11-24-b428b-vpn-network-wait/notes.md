# B428b: VPN start waits for a network

## Did

- `LocalVPN.waitForNetwork`: up to 8 s (`networkWait`), counted while awake. A start that still has no network after the wait fails with "can't start without a network".
- Called in `up()` before `startLock` is taken, so `status()` and other starts are not held up.
- Called in `waitOffCellular` before it reads the path. An install's Cancel ends it; returning to cellular goes to the airplane wait.
- If the app was left during the wait, the install pauses (`waitForApp`) instead of failing. Found in the spec review.
- `test_vpn.py`: `test_no_network_waits_a_few_seconds` (source-text checks).

## Phone check

Device: iPhone 15 Pro, iOS 27.0.1, build of this branch. The phone was needed because VPN and Airplane Mode need the device.

- Airplane Mode on, Check Connection: log "no network: waiting up to 8 s", spinner shown, `vpn_failed` after 8.1 s, alert as before.
- Airplane on, Check tapped 13:41:11, Airplane turned off in Control Center during the wait: network after 3.5 s (Wi-Fi), VPN on in 0.16 s, verify done in 3.9 s, success, VPN off 3 s later.
- Airplane off, then Check about 5 s later: network already back, passed in 0.3 s.
- Phone restored: Airplane off, lock released, this branch's build left installed.

Problems met along the way:
- Closing Control Center by swiping up from the bottom switches to its music page. Tap empty space instead.
- Chaining several taps in one WDA actions request turned into swipes. Separate direct WDA posts were used instead (quick enough).

## Not verified

- Real cellular: the 15 has no SIM, so cellular data coming back was stood in for by Wi-Fi.
- Cancel during an install's wait, and leaving the app during it: checked in code and source only, not run on the phone.
- If the network drops after `waitOffCellular`'s wait, the session's own wait in `up()` (up to 8 s) cannot be cancelled, because `IDevice.swift` passes no cancel there. Same as the VPN start's 10 s before.
- The checks have no cancel.
